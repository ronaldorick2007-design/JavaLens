#include <lldb/API/LLDB.h>

#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <system_error>
#include <unordered_set>
#include <unordered_map>
#include <vector>
#include <utility>

using namespace lldb;
namespace fs = std::filesystem;

static constexpr bool kHideProgramOutput = true;
static constexpr bool kShowUnresolved = true;     // emit heap blocks whose type is unknown
static constexpr int kMaxDepth = 8;               // nesting limit for structs / arrays
static constexpr uint32_t kMaxChildren = 64;      // fields per struct
static constexpr uint32_t kMaxElems = 256;        // elements per array
static constexpr uint32_t kMaxFrames = 64;        // innermost frames emitted
static constexpr uint64_t kMaxIterations = 2000000;

static std::string safe(const char *s) { return s ? s : "<unavailable>"; }

static std::string hex(uint64_t a) {
    char b[32];
    snprintf(b, sizeof(b), "0x%llx", (unsigned long long)a);
    return b;
}

static std::string canon(const std::string &p) {
    std::error_code ec;
    fs::path c = fs::weakly_canonical(p, ec);
    return ec ? p : c.string();
}
static std::string specPath(SBFileSpec s) {
    char buf[4096];
    if (!s.IsValid() || s.GetPath(buf, sizeof(buf)) == 0) return {};
    return canon(buf);
}
static std::string frameSource(SBFrame f) {
    SBLineEntry le = f.GetLineEntry();
    return le.IsValid() ? specPath(le.GetFileSpec()) : std::string();
}
static std::string frameModule(SBFrame f) {
    SBModule m = f.GetModule();
    return m.IsValid() ? specPath(m.GetFileSpec()) : std::string();
}
static std::string frameFn(SBFrame f) {
    const char *n = f.GetFunctionName();
    if (!n) { SBSymbol s = f.GetSymbol(); n = s.GetName(); }
    return n ? n : "<unknown>";
}

// ---------------------------------------------------------------- JSON helpers
static std::string jstr(const std::string &s) {
    std::string o = "\"";
    for (unsigned char c : s) {
        switch (c) {
            case '"':  o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n"; break;
            case '\r': o += "\\r"; break;
            case '\t': o += "\\t"; break;
            default:
                if (c < 0x20) { char b[8]; snprintf(b, sizeof(b), "\\u%04x", c); o += b; }
                else o += (char)c;
        }
    }
    return o + "\"";
}

// ---------------------------------------------------------------- tracker
struct Rec {
    uint64_t seq = 0, addr = 0, size = 0, count = 1;
    bool typed = false;
    SBType type;
    std::string typeName;
};

struct Tracker {
    SBTarget target;
    std::string exe, src;
    uint64_t hookAddr = 0;
    std::vector<Rec> recs;
    uint64_t nextSeq = 1;
    std::unordered_map<uint64_t, std::string> pointColors;
    uint64_t pointAddr = 0;

    Rec *find(uint64_t a) {
        for (auto &r : recs) if (r.addr == a) return &r;
        return nullptr;
    }
    void erase(uint64_t a) {
        for (auto it = recs.begin(); it != recs.end(); ++it)
            if (it->addr == a) { recs.erase(it); return; }
    }
};
static Tracker *gTracker = nullptr;


static bool isUserFrame(SBFrame f, const Tracker &t) {
    return f.IsValid() && frameModule(f) == t.exe && frameSource(f) == t.src;
}

static bool stackHasUserFrame(SBThread th, const Tracker &t) {
    uint32_t n = th.GetNumFrames();
    for (uint32_t i = 0; i < n; ++i)
        if (isUserFrame(th.GetFrameAtIndex(i), t)) return true;
    return false;
}

static SBValue objectValue(Tracker &t, const Rec &r) {
    SBType elem = r.type;
    SBType ty = (r.count > 1) ? elem.GetArrayType(r.count) : elem;
    return t.target.CreateValueFromAddress("obj", SBAddress(r.addr, t.target), ty);
}

// ---------------------------------------------------------------- type recovery
static void walk(Tracker &t, SBValue v, int depth, std::unordered_set<uint64_t> &seen) {
    if (!v.IsValid() || depth > kMaxDepth) return;
    SBType ty = v.GetType();
    if (!ty.IsValid()) return;

    if (ty.IsReferenceType()) { walk(t, v.Dereference(), depth + 1, seen); return; }

    if (ty.IsPointerType()) {
        uint64_t a = v.GetValueAsUnsigned(0);
        Rec *r = t.find(a);
        if (!r || seen.count(a)) return;
        seen.insert(a);

        if (!r->typed) {
            SBValue dv = v.GetDynamicValue(eDynamicCanRunTarget);
            SBType pt = (dv.IsValid() ? dv.GetType() : ty).GetPointeeType();
            uint64_t es = pt.IsValid() ? pt.GetByteSize() : 0;
            if (es > 0 && r->size >= es) {
                r->typed = true;
                r->type = pt;
                r->count = (r->size % es == 0) ? r->size / es : 1;
                r->typeName = safe(pt.GetDisplayTypeName());
            }
        }
        if (r->typed) walk(t, objectValue(t, *r), depth + 1, seen);
        return;
    }

    SBValue nv = v.GetNonSyntheticValue();
    if (!nv.IsValid()) nv = v;
    uint32_t n = nv.GetNumChildren();
    for (uint32_t i = 0; i < n && i < kMaxChildren; ++i)
        walk(t, nv.GetChildAtIndex(i), depth + 1, seen);
}

static void resolve(Tracker &t, SBThread th) {
    std::unordered_set<uint64_t> seen;
    uint32_t n = th.GetNumFrames();
    for (uint32_t i = 0; i < n; ++i) {
        SBFrame f = th.GetFrameAtIndex(i);
        if (!isUserFrame(f, t)) continue;
        SBValueList vars = f.GetVariables(true, true, true, true);
        for (uint32_t j = 0; j < vars.GetSize(); ++j)
            walk(t, vars.GetValueAtIndex(j), 0, seen);
    }
}

// ---------------------------------------------------------------- value -> JSON
//
// entry():  {"n":..,"t":..,"c":"None","value":..} primitives, pointers, arrays
//           {"n":..,"t":..,"c":"None","a":[..]} structs / classes / unions
// Pointers and references: "value" is the target address ("0x..."), which matches the
// "@0x..." part of a heap entry's name.

struct Body { bool attrs = false; std::string json; };

static std::string entry(SBValue v, const std::string &name, const std::string &type, int depth);

static int arrayDimensions(SBType type) {
    int dimensions = 0;
    while (type.IsValid() && type.IsArrayType()) {
        ++dimensions;
        type = type.GetArrayElementType();
    }
    return dimensions;
}

static std::string numberOrString(const char *s) {
    if (!s) return jstr("<unavailable>");
    char *end = nullptr;
    double d = std::strtod(s, &end);
    if (end && *end == '\0' && end != s && std::isfinite(d)) return s;
    return jstr(s);
}

static Body body(SBValue v, int depth) {
    Body b;
    if (!v.IsValid()) { b.json = jstr("<unavailable>"); return b; }
    if (depth > kMaxDepth) { b.json = jstr("<max depth>"); return b; }

    SBType ty = v.GetType();
    if (!ty.IsValid()) { b.json = jstr("<unavailable>"); return b; }
    SBType ct = ty.GetCanonicalType();

    // references behave like pointers: value = address of the referent
    if (ty.IsReferenceType()) {
        SBValue d = v.Dereference();
        b.json = jstr(hex(d.IsValid() ? d.GetLoadAddress() : 0));
        return b;
    }
    if (ty.IsPointerType()) {
        b.json = jstr(hex(v.GetValueAsUnsigned(0)));
        return b;
    }

    // Arrays use the same recursive attribute representation as object fields.
    // The first two dimensions are expanded; deeper arrays produce a warning.
    if (ty.IsArrayType()) {
        b.attrs = true;
        if (arrayDimensions(ty) > 2) {
            b.json = "[{\"n\":" + jstr("More than 2 dimensions") +
                     ",\"t\":\"warning\",\"c\":\"orange\"}]";
            return b;
        }
        uint32_t n = v.GetNumChildren();
        std::string out = "[";
        for (uint32_t i = 0; i < n && i < kMaxElems; ++i) {
            SBValue child = v.GetChildAtIndex(i);
            SBType childType = child.GetType();
            if (i) out += ",";
            out += entry(child, "", childType.IsValid() ? safe(childType.GetDisplayTypeName()) : "<unknown>", depth + 1);
        }
        if (n > kMaxElems) {
            if (n) out += ",";
            out += "{\"n\":\"...\",\"t\":\"warning\",\"c\":\"orange\"}";
        }
        b.json = out + "]";
        return b;
    }

    uint32_t cls = ct.GetTypeClass();

    // struct / class / union
    if (cls & (eTypeClassStruct | eTypeClassClass | eTypeClassUnion)) {
        // formatter summary (std::string, containers...): placeholder until std support
        if (const char *s = v.GetSummary()) { b.json = jstr(s); return b; }
        std::string out = "[";
        uint32_t n = v.GetNumChildren(), shown = 0;
        for (uint32_t i = 0; i < n && shown < kMaxChildren; ++i) {
            SBValue c = v.GetChildAtIndex(i);
            if (!c.IsValid()) continue;
            std::string cn = safe(c.GetName());
            if (cn.rfind("_vptr", 0) == 0) continue;           // hide vtable pointer
            SBType cty = c.GetType();
            if (shown++) out += ",";
            out += entry(c, cn, cty.IsValid() ? safe(cty.GetDisplayTypeName()) : "<unknown>", depth + 1);
        }
        b.attrs = true;
        b.json = out + "]";
        return b;
    }

    // enums: enumerator name
    if (cls & eTypeClassEnumeration) {
        const char *s = v.GetValue();
        b.json = s ? jstr(s) : std::to_string(v.GetValueAsSigned(0));
        return b;
    }

    // scalars
    switch (ct.GetBasicType()) {
        case eBasicTypeBool:
            b.json = v.GetValueAsUnsigned(0) ? "true" : "false";
            return b;
        case eBasicTypeChar: {
            int64_t c = v.GetValueAsSigned(0);
            if (c >= 32 && c < 127) b.json = jstr(std::string(1, (char)c));
            else b.json = std::to_string(c);
            return b;
        }
        case eBasicTypeSignedChar:
        case eBasicTypeShort:
        case eBasicTypeInt:
        case eBasicTypeLong:
        case eBasicTypeLongLong:
            b.json = std::to_string(v.GetValueAsSigned(0));
            return b;
        case eBasicTypeUnsignedChar:
        case eBasicTypeUnsignedShort:
        case eBasicTypeUnsignedInt:
        case eBasicTypeUnsignedLong:
        case eBasicTypeUnsignedLongLong:
            b.json = std::to_string((unsigned long long)v.GetValueAsUnsigned(0));
            return b;
        case eBasicTypeFloat:
        case eBasicTypeDouble:
        case eBasicTypeLongDouble:
            b.json = numberOrString(v.GetValue());
            return b;
        default: break;
    }

    const char *val = v.GetValue();
    const char *sum = v.GetSummary();
    b.json = jstr(val ? val : (sum ? sum : "<unavailable>"));
    return b;
}

// LLDB prints "Node *"; we want "Node*"
static std::string tidyType(std::string s) {
    for (const char *pat : {" *", " &"}) {
        size_t p;
        while ((p = s.find(pat)) != std::string::npos) s.erase(p, 1);
    }
    return s;
}

// "fact(int)" -> "fact", "Node::insert(int) const" -> "Node::insert"
static std::string shortFn(const std::string &n) {
    size_t from = 0, op = n.find("operator()");
    if (op != std::string::npos) from = op + 10;
    size_t p = n.find('(', from);
    return p == std::string::npos ? n : n.substr(0, p);
}

static std::string entry(SBValue v, const std::string &name, const std::string &type, int depth) {
    Body b = body(v, depth);
    uint64_t address = v.GetLoadAddress();
    if (address == LLDB_INVALID_ADDRESS) address = 0;
    if (v.GetType().IsPointerType()) address = v.GetValueAsUnsigned(0);
    std::string color = "None";
    if (gTracker && address) {
        auto it = gTracker->pointColors.find(address);
        if (it != gTracker->pointColors.end()) color = it->second;
    }
    return "{\"n\":" + jstr(name) + ",\"t\":" + jstr(tidyType(type)) + ",\"c\":" + jstr(color) + "," +
           (b.attrs ? "\"a\":" : "\"value\":") + b.json + "}";
}

// ---------------------------------------------------------------- scopes / heaps
// scopes: { "main": [entry,...], "fact#1": [...], ... }, innermost frame first.
// Key = function name; every frame above the bottom one gets "#<level>" so recursive
// calls stay unique and keep the same key for as long as the frame lives.
static std::string scopesJson(SBThread th, const Tracker &t, int &line) {
    std::vector<SBFrame> frames;
    uint32_t n = th.GetNumFrames();
    for (uint32_t i = 0; i < n; ++i) {
        SBFrame f = th.GetFrameAtIndex(i);
        if (isUserFrame(f, t)) frames.push_back(f);
    }
    line = frames.empty() ? 0 : (int)frames[0].GetLineEntry().GetLine();

    std::string out = "{";
    size_t total = frames.size();
    size_t shown = std::min<size_t>(total, kMaxFrames);
    for (size_t k = 0; k < shown; ++k) {
        SBFrame f = frames[k];
        size_t level = total - 1 - k;
        std::string key = shortFn(frameFn(f));
        if (level > 0) key += "#" + std::to_string(level);

        if (k) out += ",";
        out += jstr(key) + ":[";
        SBValueList vars = f.GetVariables(true, true, false, true);
        bool first = true;
        for (uint32_t i = 0; i < vars.GetSize(); ++i) {
            SBValue v = vars.GetValueAtIndex(i);
            if (!v.IsValid()) continue;
            SBType ty = v.GetType();
            if (!first) out += ",";
            first = false;
            out += entry(v, safe(v.GetName()), ty.IsValid() ? safe(ty.GetDisplayTypeName()) : "<unknown>", 0);
        }
        out += "]";
    }
    return out + "}";
}

static std::string heapsJson(Tracker &t) {
    std::string out = "[";
    bool first = true;
    for (const auto &r : t.recs) {
        std::string e;
        if (!r.typed) {
            if (!kShowUnresolved) continue;
            e = "{\"n\":" + jstr("<unresolved>@" + hex(r.addr)) +
                ",\"t\":\"<unresolved>\",\"c\":\"None\",\"value\":" +
                jstr("<" + std::to_string(r.size) + " bytes>") + "}";
        } else {
            std::string type = r.typeName;
            if (r.count > 1) type += "[" + std::to_string(r.count) + "]";
            e = entry(objectValue(t, r), type + "@" + hex(r.addr), type, 0);
        }
        if (!first) out += ",";
        first = false;
        out += e;
    }
    return out + "]";
}


static std::string heapObjectId(const Rec &r) {
    std::string type = r.typeName;
    if (r.count > 1) type += "[" + std::to_string(r.count) + "]";
    return (r.typed ? type : std::string("<unresolved>")) + "@" + hex(r.addr);
}

static void collectVisualEdges(Tracker &t, SBValue value, const std::string &path,
                               int depth, std::vector<std::pair<std::string, std::string>> &edges) {
    if (!value.IsValid() || depth > kMaxDepth) return;
    SBType type = value.GetType();
    if (!type.IsValid()) return;

    if (type.IsReferenceType()) {
        SBValue target = value.Dereference();
        uint64_t address = target.IsValid() ? target.GetLoadAddress() : 0;
        Rec *rec = t.find(address);
        if (rec && rec->typed) edges.emplace_back(heapObjectId(*rec), path);
        return;
    }
    if (type.IsPointerType()) {
        uint64_t address = value.GetValueAsUnsigned(0);
        Rec *rec = t.find(address);
        if (rec && rec->typed) edges.emplace_back(heapObjectId(*rec), path);
        return;
    }

    SBType canonical = type.GetCanonicalType();
    if (type.IsArrayType()) {
        uint32_t count = std::min<uint32_t>(value.GetNumChildren(), kMaxElems);
        for (uint32_t i = 0; i < count; ++i) {
            std::string childPath = path + "[" + std::to_string(i) + "]";
            collectVisualEdges(t, value.GetChildAtIndex(i), childPath, depth + 1, edges);
        }
        return;
    }

    uint32_t cls = canonical.GetTypeClass();
    if (cls & (eTypeClassStruct | eTypeClassClass | eTypeClassUnion)) {
        SBValue aggregate = value.GetNonSyntheticValue();
        if (!aggregate.IsValid()) aggregate = value;
        uint32_t count = std::min<uint32_t>(aggregate.GetNumChildren(), kMaxChildren);
        for (uint32_t i = 0; i < count; ++i) {
            SBValue child = aggregate.GetChildAtIndex(i);
            if (!child.IsValid()) continue;
            std::string field = safe(child.GetName());
            if (field.rfind("_vptr", 0) == 0) continue;
            std::string childPath = path.empty() ? field : path + "." + field;
            collectVisualEdges(t, child, childPath, depth + 1, edges);
        }
    }
}

static std::string visualJson(Tracker &t) {
    std::string out = "[";
    bool firstNode = true;
    for (const auto &rec : t.recs) {
        if (!rec.typed) continue;
        if (!firstNode) out += ",";
        firstNode = false;
        std::string nodeColor = "None";
        auto colorIt = t.pointColors.find(rec.addr);
        if (colorIt != t.pointColors.end()) nodeColor = colorIt->second;
        out += "{\"n\":" + jstr(heapObjectId(rec)) + ",\"t\":" + jstr(rec.typeName) +
               ",\"c\":" + jstr(nodeColor) + ",\"e\":[";
        std::vector<std::pair<std::string, std::string>> edges;
        collectVisualEdges(t, objectValue(t, rec), "", 0, edges);
        bool firstEdge = true;
        for (const auto &edge : edges) {
            if (!firstEdge) out += ",";
            firstEdge = false;
            out += "{\"n\":" + jstr(edge.first) + ",\"r\":" + jstr(edge.second) + "}";
        }
        out += "]}";
    }
    return out + "]";
}

static std::string snapshot(Tracker &t, SBThread th) {
    int line = 0;
    std::string scopes = scopesJson(th, t, line);
    std::string heaps = heapsJson(t);
    return "{\"l\":" + std::to_string(line) + ",\"s\":" + scopes +
           ",\"h\":" + heaps + ",\"v\":" + visualJson(t) + "}";
}

// ---------------------------------------------------------------- hook events
struct Event { int kind = 0; uint64_t addr = 0, size = 0; bool ok = false; };

static uint64_t hookAddress(SBTarget &tg) {
    SBSymbolContextList l = tg.FindFunctions("memtrack_event");
    for (uint32_t i = 0; i < l.GetSize(); ++i) {
        SBSymbolContext sc = l.GetContextAtIndex(i);
        SBAddress a;
        if (sc.GetFunction().IsValid()) a = sc.GetFunction().GetStartAddress();
        else if (sc.GetSymbol().IsValid()) a = sc.GetSymbol().GetStartAddress();
        if (!a.IsValid()) continue;
        lldb::addr_t la = a.GetLoadAddress(tg);
        if (la != LLDB_INVALID_ADDRESS) return la;
    }
    return 0;
}

static bool atHook(const Tracker &t, SBThread th) {
    if (!th.IsValid() || th.GetNumFrames() == 0) return false;
    return th.GetFrameAtIndex(0).GetPC() == t.hookAddr;
}

static bool atPoint(const Tracker &t, SBThread th) {
    return t.pointAddr && th.IsValid() && th.GetNumFrames() > 0 &&
           th.GetFrameAtIndex(0).GetPC() == t.pointAddr;
}

static void capturePoint(Tracker &t, SBProcess &process, SBThread th) {
    SBFrame frame = th.GetFrameAtIndex(0);
    SBValue address = frame.FindVariable("address");
    if (!address.IsValid()) address = frame.FindVariable("object");
    SBValue color = frame.FindVariable("color");
    if (!address.IsValid() || !color.IsValid()) return;

    uint64_t target = address.GetValueAsUnsigned(0);
    uint64_t colorAddress = color.GetValueAsUnsigned(0);
    if (!target || !colorAddress) return;

    char buffer[128] = {};
    SBError error;
    size_t copied = process.ReadCStringFromMemory(colorAddress, buffer, sizeof(buffer) - 1, error);
    if (error.Fail() || copied == 0) return;
    t.pointColors[target] = std::string(buffer);
}

static Event readEvent(SBFrame f) {
    Event e;
    SBValue r0 = f.FindRegister("rdi"), r1, r2;
    if (r0.IsValid()) { r1 = f.FindRegister("rsi"); r2 = f.FindRegister("rdx"); }
    else { r0 = f.FindRegister("x0"); r1 = f.FindRegister("x1"); r2 = f.FindRegister("x2"); }
    if (!r0.IsValid() || !r1.IsValid() || !r2.IsValid()) return e;
    e.kind = (int)(r0.GetValueAsUnsigned(0) & 0xffffffffu);
    e.addr = r1.GetValueAsUnsigned(0);
    e.size = r2.GetValueAsUnsigned(0);
    e.ok = true;
    return e;
}

static bool findEvent(Tracker &t, SBProcess &p, SBThread &out, Event &ev) {
    for (uint32_t i = 0; i < p.GetNumThreads(); ++i) {
        SBThread th = p.GetThreadAtIndex(i);
        if (!atHook(t, th)) continue;
        ev = readEvent(th.GetFrameAtIndex(0));
        if (ev.ok) { out = th; p.SetSelectedThread(th); return true; }
    }
    return false;
}

static void explainStop(SBProcess &p) {
    std::cerr << "Stopped unexpectedly. State=" << (int)p.GetState() << "\n";
    for (uint32_t i = 0; i < p.GetNumThreads(); ++i) {
        SBThread th = p.GetThreadAtIndex(i);
        char desc[256] = "";
        th.GetStopDescription(desc, sizeof(desc));
        std::cerr << "  thread " << i << " stop: " << desc << "\n";
        for (uint32_t j = 0; j < 6 && j < th.GetNumFrames(); ++j)
            std::cerr << "    #" << j << " " << frameFn(th.GetFrameAtIndex(j)) << "\n";
    }
}

// ---------------------------------------------------------------- main loop
static int run(const fs::path &exePath, const std::string &outPath) {
    Tracker t;
    gTracker = &t;
    t.exe = canon(exePath.string());

    SBDebugger debugger = SBDebugger::Create(false);
    if (!debugger.IsValid()) { std::cerr << "SBDebugger::Create failed.\n"; return 1; }
    debugger.SetAsync(false);

    SBError err;
    t.target = debugger.CreateTarget(t.exe.c_str(), nullptr, nullptr, true, err);
    if (!t.target.IsValid() || err.Fail()) {
        std::cerr << "CreateTarget failed: " << safe(err.GetCString()) << '\n';
        return 1;
    }

    SBBreakpoint mainBp = t.target.BreakpointCreateByName("main");
    if (!mainBp.IsValid() || mainBp.GetNumLocations() == 0) {
        std::cerr << "Could not set breakpoint on main().\n";
        return 1;
    }

    SBLaunchInfo launch(nullptr);
    if (kHideProgramOutput) launch.AddOpenFileAction(1, "/dev/null", false, true);
    SBProcess process = t.target.Launch(launch, err);
    if (err.Fail() || !process.IsValid() || process.GetState() != eStateStopped) {
        std::cerr << "Launch failed: " << safe(err.GetCString()) << '\n';
        return 1;
    }

    SBThread thread = process.GetSelectedThread();
    t.src = frameSource(thread.GetSelectedFrame());
    if (t.src.empty()) {
        std::cerr << "No debug info for main(). Compile with -g -O0.\n";
        process.Kill();
        return 1;
    }
    t.target.BreakpointDelete(mainBp.GetID());

    t.hookAddr = hookAddress(t.target);
    if (!t.hookAddr) {
        std::cerr << "memtrack_event not found. #include \"memtrack.h\" in the program.\n";
        process.Kill();
        return 1;
    }
    SBBreakpoint hook = t.target.BreakpointCreateByAddress(t.hookAddr);
    SBBreakpoint pointBp = t.target.BreakpointCreateByName("point");
    if (pointBp.IsValid() && pointBp.GetNumLocations() > 0) {
        SBAddress pointLocation = pointBp.GetLocationAtIndex(0).GetAddress();
        t.pointAddr = pointLocation.GetLoadAddress(t.target);
    }
    if (!hook.IsValid()) {
        std::cerr << "Could not set breakpoint on memtrack_event.\n";
        process.Kill();
        return 1;
    }

    std::vector<std::string> trace;      // every emitted snapshot
    std::string last;

    for (uint64_t it = 0; it < kMaxIterations; ++it) {
        if (process.GetState() != eStateStopped) break;

        // point() instrumentation: capture target/color and step over the helper.
        thread = process.GetSelectedThread();
        if (atPoint(t, thread)) {
            capturePoint(t, process, thread);
            thread.StepOut();
            continue;
        }

        // allocation / free event
        Event ev;
        if (findEvent(t, process, thread, ev)) {
            if (ev.kind == 1 || ev.kind == 2) {
                Rec r;
                r.seq = t.nextSeq++;
                r.addr = ev.addr;
                r.size = ev.size;
                t.recs.push_back(r);
            } else {
                resolve(t, thread);                   // pointer is still visible
                t.erase(ev.addr);
            }
            thread.StepOut();                         // leave the hook
            continue;
        }

        thread = process.GetSelectedThread();
        if (!thread.IsValid()) break;

        // 2) crash / signal
        StopReason sr = thread.GetStopReason();
        if (sr == eStopReasonSignal || sr == eStopReasonException) {
            explainStop(process);
            break;
        }

        // 3) main returned
        if (!stackHasUserFrame(thread, t)) break;

        // 4) library / header code: get back out silently
        SBFrame frame = thread.GetFrameAtIndex(0);
        if (!isUserFrame(frame, t)) { thread.StepOut(); continue; }

        // 5) user code: snapshot stack + heap
        resolve(t, thread);
        std::string js = snapshot(t, thread);
        // point() annotations are consumed by exactly this snapshot.
        t.pointColors.clear();
        if (js != last) {
            trace.push_back(js);
            last = js;
        }

        thread.StepInto();
    }

    if (!t.recs.empty()) {
        std::cerr << "never freed: " << t.recs.size() << " object(s)\n";
        for (const auto &r : t.recs)
            std::cerr << "  #" << r.seq << "  " << hex(r.addr) << "  " << r.size << " bytes  "
                      << (r.typed ? r.typeName : std::string("<unresolved>")) << '\n';
    }

    if (process.IsValid() && process.GetState() != eStateExited &&
        process.GetState() != eStateDetached)
        process.Kill();

    SBDebugger::Destroy(debugger);

    std::ofstream f(outPath);
    if (!f) { std::cerr << "Cannot write " << outPath << '\n'; return 1; }
    f << "[\n";
    for (size_t i = 0; i < trace.size(); ++i) f << trace[i] << (i + 1 < trace.size() ? ",\n" : "\n");
    f << "]\n";
    std::cerr << trace.size() << " step(s) written to " << outPath << '\n';
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 2 || argc > 3) {
        std::cerr << "Usage: " << argv[0] << " <executable> [trace.json]\n";
        return 1;
    }
    std::error_code ec;
    fs::path exe = fs::absolute(argv[1], ec);
    if (ec || !fs::is_regular_file(exe)) { std::cerr << "Not a file: " << exe << '\n'; return 1; }

    SBDebugger::Initialize();
    int rc = run(exe, argc == 3 ? argv[2] : "trace.json");
    SBDebugger::Terminate();
    return rc;
}
