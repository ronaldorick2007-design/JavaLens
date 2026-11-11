import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import { useTheme } from "./ThemeProvider";

/* ═══════════════════════════════════════════════════════════════
   GLOBAL STYLE KNOBS
   ───────────────────────────────────────────────────────────────
   BORDER_RADIUS → every <div>, <button> and <select> inside the viewer.
                   "0px" = sharp corners (default). Try "10px" to match appTheme.
   BUTTON_SHADOW → box-shadow shown when a button / select is hovered or
                   keyboard-focused. Replaces appTheme's 10px shadow.
                   Any CSS box-shadow value. On the dark theme "#000" is invisible
                   on black, so use e.g. "3px 3px var(--accent)" there.
   BUTTON_SCALE  → size of a hovered button / select. Replaces appTheme's
                   hover:scale-95. 0.9 = shrink to 90%.
   The overrides keep hover behavior consistent across the viewer.
   ═══════════════════════════════════════════════════════════════ */
const BORDER_RADIUS = "1px";
const BUTTON_SHADOW = "3px 3px #000";
const BUTTON_SCALE = 0.96;

// Full class names must be literal strings so Tailwind can see them.
// Scale is overridden through --tw-scale-x/y, which works in Tailwind v3 and v4
// (v3 builds `transform` from them, v4 builds `scale` from them).
const GLOBAL_OVERRIDES = [
  "[&_div]:!rounded-[var(--tv-radius)]",
  "[&_select]:!rounded-[var(--tv-radius)]",
  "[&_button]:!rounded-[var(--tv-radius)]",
  "[&_button:hover]:!rounded-[var(--tv-radius)]",
  "[&_button:hover]:!bg-red-500",
  "[&_button:hover]:!text-white",
  "[&_button:hover]:!border-black",
  "[&_button:hover]:![box-shadow:var(--tv-shadow)]",
  "[&_button:focus-visible]:![box-shadow:var(--tv-shadow)]",
  "[&_button:hover]:![--tw-scale-x:var(--tv-scale)]",
  "[&_button:hover]:![--tw-scale-y:var(--tv-scale)]",
  "[&_select:hover]:!bg-red-500",
  "[&_select:hover]:!text-white",
  "[&_select:hover]:!border-black",
  "[&_select:hover]:![box-shadow:var(--tv-shadow)]",
  "[&_select:hover]:![--tw-scale-x:var(--tv-scale)]",
  "[&_select:hover]:![--tw-scale-y:var(--tv-scale)]",
  "[&_input:hover]:!bg-red-500",
  "[&_input:hover]:!text-white",
  "[&_input:hover]:!border-black",
  "[&_input:hover]:![box-shadow:var(--tv-shadow)]",
  "[&_input:hover]:![--tw-scale-x:var(--tv-scale)]",
  "[&_input:hover]:![--tw-scale-y:var(--tv-scale)]",
  "[&_input[type=range]:hover]:!accent-red-500",
  "[&_textarea:hover]:!bg-red-500",
  "[&_textarea:hover]:!text-white",
  "[&_textarea:hover]:!border-black",
  "[&_textarea:hover]:![box-shadow:var(--tv-shadow)]",
  "[&_textarea:hover]:![--tw-scale-x:var(--tv-scale)]",
  "[&_textarea:hover]:![--tw-scale-y:var(--tv-scale)]",
  "[&_[data-hoverable]]:transition-transform",
  "[&_[data-hoverable]:hover]:![--tw-scale-x:var(--tv-scale)]",
  "[&_[data-hoverable]:hover]:![--tw-scale-y:var(--tv-scale)]",
  "[&_[role=option]:hover]:!bg-red-500",
  "[&_[role=option]:hover]:!text-white",
  "[&_[role=option]:hover]:![box-shadow:var(--tv-shadow)]",
  "[&_[role=option]:hover]:![--tw-scale-x:var(--tv-scale)]",
  "[&_[role=option]:hover]:![--tw-scale-y:var(--tv-scale)]",
  "[&_[role=button]:hover]:!bg-red-500",
  "[&_[role=button]:hover]:!text-white",
  "[&_[role=button]:hover]:![box-shadow:var(--tv-shadow)]",
  "[&_[role=button]:hover]:![--tw-scale-x:var(--tv-scale)]",
  "[&_[role=button]:hover]:![--tw-scale-y:var(--tv-scale)]",
  "[&_[data-hoverable]:hover]:!bg-red-500",
  "[&_[data-hoverable]:hover]:!text-white",
  "[&_[data-hoverable]:hover]:![box-shadow:var(--tv-shadow)]",
  "[&_[data-hoverable]:hover]:![--tw-scale-x:var(--tv-scale)]",
  "[&_[data-hoverable]:hover]:![--tw-scale-y:var(--tv-scale)]",
  "[&_button]:transition-all [&_button]:duration-150",
  "[&_select]:transition-all [&_select]:duration-150 [&_select]:cursor-pointer",
  "[&_input]:transition-all [&_input]:duration-150",
  "[&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed",
  "[&_button:active]:!translate-y-px",
  "[&_[role=option]]:transition-transform",
  "[&_[role=button]]:transition-transform",
].join(" ");

// Shared accent used by graph hover and selected-object styling.
const ACCENT = "#ef4444";

// Shared across VisualGraph instances and snapshot changes.
let selectedObjectId = "";
let persistedGraphView = "all";
let persistedGraphDepth = "1";
let persistedGraphDirection = "outgoing";
let persistedHeapCollapse = "no";
let persistedScopeCollapse = "no";

/* ═══════════════════════════════════════════════════════════════
   PASTE YOUR JSON BETWEEN THE BACKTICKS
   Accepts one snapshot {l,s,h,v} or the whole trace array [ {...}, ... ]
   (or pass it as the `snapshots` prop instead).
   ═══════════════════════════════════════════════════════════════ */
const content = ``;

/* ---------------- helpers ---------------- */
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

function colorClass(color) {
  // Important utilities ensure the highlight wins over alternating card surfaces.
  const colors = {
    red: "!border-red-700 !bg-red-600 !text-white [&_*]:!text-white",
    green: "!border-green-700 !bg-green-600 !text-white [&_*]:!text-white",
    blue: "!border-blue-700 !bg-blue-600 !text-white [&_*]:!text-white",
    purple: "!border-purple-700 !bg-purple-600 !text-white [&_*]:!text-white",
    orange: "!border-orange-700 !bg-orange-600 !text-white [&_*]:!text-white",
  };
  return colors[String(color || "").toLowerCase()] || "";
}

const GRAPH_PALETTE = {
  red: "#dc2626", blue: "#2563eb", green: "#16a34a", orange: "#ea580c",
  purple: "#9333ea", yellow: "#ca8a04", pink: "#db2777", cyan: "#0891b2",
};

function normalizeSnapshots(input) {
  let data = input;
  if (typeof data === "string") {
    if (data.trim() === "I WILL PASTE HERE") return { snapshots: [], error: "Paste your JSON into `content` at the top of this file, or pass a `snapshots` prop." };
    try {
      data = JSON.parse(data);
    } catch (e) {
      return { snapshots: [], error: "Snapshot data is not valid JSON: " + e.message };
    }
  }
  if (isObj(data) && Array.isArray(data.snapshots)) data = data.snapshots;
  else if (isObj(data)) data = [data];
  if (!Array.isArray(data) || !data.length) return { snapshots: [], error: "No snapshots provided." };
  return {
    snapshots: data.filter(isObj).map((item, i) => ({
      l: Number.isFinite(item.l) ? item.l : i + 1,
      s: isObj(item.s) ? Object.entries(item.s) : [],
      h: Array.isArray(item.h) ? item.h : [],
      v: Array.isArray(item.v) ? item.v : [],
    })),
    error: null,
  };
}

/* ---------------- VALUES (recursive) ---------------- */
function Scalar({ value, type }) {
  let text;
  if (value === null || value === undefined) text = "null";
  else if (type === "char" && typeof value === "string") text = `'${value}'`;
  else text = String(value);
  return <span className="break-all font-mono">{text}</span>;
}

// Array → grid of boxes. Elements may be scalars, nested arrays, or full entries.
function ArrayRow({ items, type, dark, depth, path = "", collapsedOverrides, setCollapsedOverrides, defaultCollapsed = false, inheritedColor = "" }) {
  const muted = inheritedColor ? "!text-white" : (dark ? "text-gray-400" : "text-gray-500");
  const cell = inheritedColor ? `${colorClass(inheritedColor)} border px-2 py-1 text-center` : (dark ? "border-white bg-black text-white" : "border-black bg-white text-black");
  const elemType = type ? type.replace(/\[\d*\]$/, "") : undefined;
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      {items.map((el, i) => (
        <div key={i} className={`min-w-[76px] max-w-full border px-2 py-1.5 text-center [overflow-wrap:anywhere] ${cell} ${inheritedColor ? "[&_*]:!text-white" : ""}`}>
          <div className={`mb-0.5 font-mono text-[10px] tracking-wide ${muted}`}>[{i}]</div>
          {isObj(el) ? (
            <div className="text-left"><Entry e={el} dark={dark} depth={depth + 1} path={`${path}[${i}]`} collapsedOverrides={collapsedOverrides} setCollapsedOverrides={setCollapsedOverrides} defaultCollapsed={defaultCollapsed} inheritedColor={inheritedColor} /></div>
          ) : Array.isArray(el) ? (
            <ArrayRow items={el} type={elemType} dark={dark} depth={depth + 1} path={`${path}[${i}]`} collapsedOverrides={collapsedOverrides} setCollapsedOverrides={setCollapsedOverrides} defaultCollapsed={defaultCollapsed} inheritedColor={inheritedColor} />
          ) : (
            <div className="text-sm leading-5"><Scalar value={el} type={elemType} /></div>
          )}
        </div>
      ))}
    </div>
  );
}

// One {n, t, c, value | a}. Recurses through `a` (attributes) to any depth.
// Surfaces alternate white/gray with depth so nesting stays readable.
function Entry({ e, dark, depth = 0, full = false, path = "", defaultCollapsed = false, forceCollapsed = false, forceExpanded = false, collapsedOverrides = {}, setCollapsedOverrides = () => {}, inheritedColor = "" }) {
  const ownColor = e.c && e.c !== "None" ? String(e.c).toLowerCase() : "";
  const effectiveColor = ownColor || inheritedColor;
  const muted = effectiveColor ? "!text-white" : (dark ? "text-gray-400" : "text-gray-500");
  const even = dark ? "border-white bg-black text-white" : "border-black bg-white text-black";
  const odd = dark ? "border-white bg-zinc-900 text-white" : "border-black bg-gray-50 text-black";
  const tint = effectiveColor ? colorClass(effectiveColor) : "";
  const hasAttrs = Array.isArray(e.a);
  const collapsible = hasAttrs && e.a.length > 0;
  // Explicit per-entry toggles take priority over the global collapse preset.
  const isCollapsed = Object.prototype.hasOwnProperty.call(collapsedOverrides, path)
    ? collapsedOverrides[path]
    : forceCollapsed ? true : forceExpanded ? false : defaultCollapsed;
  const toggle = () => setCollapsedOverrides(old => ({ ...old, [path]: !isCollapsed }));

  return (
    <div className={`min-w-0 max-w-full border p-2.5 ${full ? "w-full" : "w-fit"} ${depth % 2 ? odd : even} ${tint}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="break-words font-bold">{e.n}</span>
          <span className={`font-mono text-xs tracking-tight opacity-80 ${muted}`}>{e.t}</span>
        </div>
        {collapsible && <button type="button" onClick={toggle} className={`min-w-[28px] border px-2 py-0.5 text-xs font-bold leading-5 ${dark ? "border-white" : "border-black"}`}>{isCollapsed ? "+" : "−"}</button>}
      </div>
      {!isCollapsed && <div className="mt-1.5 min-w-0">
        {hasAttrs ? (
          e.a.length ? (
            <div className="flex flex-wrap items-start gap-2">
              {e.a.map((a, i) => (
                <Entry key={i} e={a} dark={dark} depth={depth + 1} path={`${path}/${a.n}:${i}`} defaultCollapsed={defaultCollapsed} collapsedOverrides={collapsedOverrides} setCollapsedOverrides={setCollapsedOverrides} inheritedColor={effectiveColor} />
              ))}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>empty</span>
          )
        ) : Array.isArray(e.value) ? (
          <ArrayRow items={e.value} type={e.t} dark={dark} depth={depth} path={path} collapsedOverrides={collapsedOverrides} setCollapsedOverrides={setCollapsedOverrides} defaultCollapsed={defaultCollapsed} inheritedColor={effectiveColor} />
        ) : (
          <Scalar value={e.value} type={e.t} />
        )}
      </div>}
    </div>
  );
}

/* ---------------- VISUAL GRAPH (cytoscape) ---------------- */
function bfsDirectional(root, links, depth, direction) {
  // Traverse only the selected edge direction:
  // outgoing: root -> targets; incoming: sources -> root.
  const adj = new Map();
  for (const link of links) {
    const from = direction === "incoming" ? link.target : link.source;
    const to = direction === "incoming" ? link.source : link.target;
    if (!adj.has(from)) adj.set(from, new Set());
    adj.get(from).add(to);
  }

  const seen = new Set([root]);
  let frontier = [root];
  // "all" (UI label: None) walks every reachable neighbour in the
  // selected direction until no new connected nodes remain.
  const limit = depth === "all" ? Infinity : Math.max(0, Number(depth) || 0);
  for (let level = 0; level < limit && frontier.length; level++) {
    const next = [];
    for (const id of frontier) {
      for (const neighbour of adj.get(id) || []) {
        if (!seen.has(neighbour)) {
          seen.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

// A v-node's type is never hard-coded: v[].t → type of the h[] entry with the same name → text before "@".
function buildTypeOf(heaps) {
  const fromHeap = new Map();
  for (const h of heaps) {
    if (isObj(h) && typeof h.n === "string" && typeof h.t === "string" && h.t.trim()) fromHeap.set(h.n, h.t.trim());
  }
  return (node) => {
    if (typeof node.t === "string" && node.t.trim()) return node.t.trim();
    const name = String(node.n);
    if (fromHeap.has(name)) return fromHeap.get(name);
    const at = name.indexOf("@");
    return at > 0 ? name.slice(0, at) : "object";
  };
}

// Long addresses make blocks huge and overlap. Show a short label; the full id stays in the tooltip.
//   "Node@0x55555556b060" -> "Node@…b060"     "Node@61" stays as is
function shortLabel(id) {
  if (id.length <= 14) return id;
  const at = id.indexOf("@");
  if (at > 0 && id.startsWith("0x", at + 1)) {
    const head = at > 9 ? id.slice(0, 8) + "…" : id.slice(0, at);
    return `${head}@…${id.slice(-4)}`;
  }
  return id.slice(0, 13) + "…";
}

// Layouts place node CENTRES; wide blocks can still overlap. Push overlapping boxes apart
// along the axis with the smaller overlap until none touch.
function separateOverlaps(cy, pad = 28, rounds = 80) {
  const boxes = cy.nodes().toArray().map((n) => ({ n, p: { ...n.position() }, w: n.width() + pad, h: n.height() + pad }));
  if (boxes.length < 2) return;
  for (let r = 0; r < rounds; r++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y;
        const ox = (a.w + b.w) / 2 - Math.abs(dx), oy = (a.h + b.h) / 2 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) { const m = ((dx >= 0 ? 1 : -1) * ox) / 2; a.p.x -= m; b.p.x += m; }
        else { const m = ((dy >= 0 ? 1 : -1) * oy) / 2; a.p.y -= m; b.p.y += m; }
      }
    }
    if (!moved) break;
  }
  cy.batch(() => boxes.forEach(({ n, p }) => n.position(p)));
}

function VisualGraph({ nodes, heaps, dark, selectedObject, onSelectedObjectChange, view, setView, depth, setDepth, direction, setDirection }) {
  const hostRef = useRef(null);
  const [focusMenuOpen, setFocusMenuOpen] = useState(false);
  const focusMenuRef = useRef(null);
  const [hover, setHover] = useState(null);

  const muted = dark ? "text-gray-400" : "text-gray-500";
  const inner = dark ? "border-white bg-black text-white" : "border-black bg-white text-black";
  const surface = dark ? "bg-zinc-900" : "bg-gray-50";
  const accent = dark ? "border-red-500 bg-red-500 text-white" : "border-red-600 bg-red-100 text-red-950";
  const menuSurface = dark ? "border-white bg-zinc-950 text-white" : "border-black bg-white text-black";
  const menuHover = dark ? "bg-black text-white" : "bg-white text-black";
  const menuSelected = dark ? "bg-red-950 text-red-100" : "bg-red-100 text-red-950";

  const graph = useMemo(() => {
    const typeOf = buildTypeOf(heaps);
    const source = nodes.filter((n) => isObj(n) && typeof n.n === "string");
    const gNodes = source.map((n) => ({ id: n.n, type: typeOf(n), color: n.c && n.c !== "None" ? n.c : null }));
    const ids = new Set(gNodes.map((n) => n.id));
    const links = source.flatMap((n) =>
      (Array.isArray(n.e) ? n.e : [])
        .filter((e) => e && ids.has(String(e.n)))
        .map((e, i) => ({ id: `${n.n}->${e.n}:${e.r ?? "ref"}:${i}`, source: n.n, target: String(e.n), relation: String(e.r ?? "ref") }))
    );
    return { nodes: gNodes, links };
  }, [nodes, heaps]);

  const typeCounts = useMemo(() => {
    const m = new Map();
    for (const n of graph.nodes) m.set(n.type, (m.get(n.type) || 0) + 1);
    return m;
  }, [graph.nodes]);
  const types = useMemo(() => [...typeCounts.keys()].sort((a, b) => a.localeCompare(b)), [typeCounts]);

  // keep selections valid when the step changes
  useEffect(() => {
    if (view.startsWith("type:") && !types.includes(view.slice(5))) setView("all");
  }, [types, view]);
  useEffect(() => {
    if (!graph.nodes.length) return;
    if (!selectedObject || !graph.nodes.some((n) => n.id === selectedObject)) onSelectedObjectChange(graph.nodes[0].id);
  }, [graph.nodes, selectedObject, onSelectedObjectChange]);

  const visible = useMemo(() => {
    let keep = null;
    if (view.startsWith("type:")) {
      const t = view.slice(5);
      keep = new Set(graph.nodes.filter((n) => n.type === t).map((n) => n.id));
    } else if (view === "focus" && selectedObject) {
      keep = bfsDirectional(selectedObject, graph.links, depth, direction);
    }
    if (!keep) return graph;
    return {
      nodes: graph.nodes.filter((n) => keep.has(n.id)),
      links: graph.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
    };
  }, [graph, view, selectedObject, depth, direction]);

  const elements = useMemo(
    () => [
      ...visible.nodes.map((n) => ({
        data: {
          id: n.id, label: shortLabel(n.id), type: n.type,
          // block width from the text (monospace 11px ≈ 7px per char + 10px padding each side)
          w: Math.max(64, Math.ceil(shortLabel(n.id).length * 7) + 20),
          // `fill` only exists when the JSON gives a colour; otherwise the node stays plain
          ...(n.color ? { fill: GRAPH_PALETTE[String(n.color).toLowerCase()] || n.color } : {}),
        },
        classes: view === "focus" && n.id === selectedObject ? "root-node" : "",
      })),
      ...visible.links.map((l) => ({ data: { id: l.id, source: l.source, target: l.target, relation: l.relation } })),
    ],
    [visible, view, selectedObject]
  );

  useEffect(() => {
    if (!hostRef.current || !elements.length) return undefined;
    // Graph nodes use the same neutral base styling as the controls, with a custom hover accent:
    //   light  base: white bg, black border, black text   hover: accent bg, white text, black border
    //   dark   base: black bg, white border, white text   hover: black bg, accent text, accent border
    const c = dark
      ? { bg: "#000000", border: "#ffffff", text: "#ffffff", edge: "#a1a1aa", hBg: "#000000", hText: ACCENT, hBorder: ACCENT }
      : { bg: "#ffffff", border: "#000000", text: "#000000", edge: "#000000", hBg: ACCENT, hText: "#ffffff", hBorder: "#000000" };

    const cy = cytoscape({
      container: hostRef.current,
      elements,
      minZoom: 0.2,
      maxZoom: 3,
      boxSelectionEnabled: false,
      style: [
        { selector: "node", style: {
            label: "data(label)", shape: "rectangle", width: "data(w)", height: 38,
            "background-color": c.bg, "border-color": c.border, "border-width": 1.5,
            color: c.text, "font-size": 11.5, "font-weight": 700, "font-family": "ui-monospace, monospace",
            "text-valign": "center", "text-halign": "center", "text-wrap": "none" } },
        // only present when the JSON supplies a colour
        { selector: "node[fill]", style: { "background-color": "data(fill)", color: "#ffffff" } },
        { selector: "node.root-node", style: { "border-width": 3, "border-color": ACCENT, "z-index": 10 } },
        { selector: "node.hl", style: { "background-color": c.hBg, color: c.hText, "border-color": c.hBorder, "border-width": 1.5 } },
        { selector: "edge", style: {
            width: 1.5, "line-color": c.edge, "target-arrow-color": c.edge, "target-arrow-shape": "triangle",
            "arrow-scale": 0.9, "curve-style": "bezier", opacity: 0.65 } },
        { selector: "edge.hl", style: { width: 3, opacity: 1, "line-color": ACCENT, "target-arrow-color": ACCENT } },
      ],
    });

    // animate:false → nothing keeps running after destroy (that was the "renderer is null" crash)
    const layout = cy.layout({
      name: "cose", animate: false, fit: true, padding: 35,
      nodeRepulsion: () => 12000, idealEdgeLength: () => 170, edgeElasticity: () => 100,
      gravity: 0.25, numIter: 700, componentSpacing: 80, nodeOverlap: 18, randomize: false,
    });
    layout.run();
    separateOverlaps(cy);
    cy.fit(undefined, 35);

    const show = (event, text) => {
      event.target.addClass("hl");
      const p = event.renderedPosition;
      setHover({ x: p.x + 14, y: p.y + 14, text });
    };
    cy.on("mouseover", "node", (e) => show(e, `${e.target.id()} · ${e.target.data("type")}`));
    cy.on("mouseover", "edge", (e) => show(e, e.target.data("relation")));
    cy.on("mousemove", "node, edge", (e) => {
      const p = e.renderedPosition;
      setHover((old) => (old ? { ...old, x: p.x + 14, y: p.y + 14 } : old));
    });
    cy.on("mouseout", "node, edge", (e) => { e.target.removeClass("hl"); setHover(null); });
    cy.on("pan zoom", () => setHover(null));

    return () => {
      try { layout.stop(); cy.stop(); cy.removeAllListeners(); } catch (_) { /* already gone */ }
      cy.destroy();
    };
  }, [elements, dark]);

  const field = `w-full border px-2 py-1 text-xs font-normal transition-all duration-150 ${inner}`;

  useEffect(() => {
    if (!focusMenuOpen) return undefined;
    const closeOnOutside = (event) => {
      if (focusMenuRef.current && !focusMenuRef.current.contains(event.target)) setFocusMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setFocusMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [focusMenuOpen]);

  if (!graph.nodes.length) {
    return <div className={`border border-dashed px-3 py-6 text-center text-sm ${inner} ${muted}`}>No visual graph in this snapshot.</div>;
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] items-end gap-2">
        <label className="grid gap-1.5 text-xs font-bold">
          <select value={view} onChange={(e) => setView(e.target.value)} className={field} style={{ colorScheme: dark ? "dark" : "light" }}>
            <option value="all">All objects ({graph.nodes.length})</option>
            {types.map((t) => (
              <option key={t} value={`type:${t}`}>{t} only ({typeCounts.get(t)})</option>
            ))}
            <option value="focus">Focus (object and neighbours)</option>
          </select>
        </label>
        {view === "focus" && (
          <>
            <div className="grid gap-1.5 text-xs font-bold">
              <span>Neighbour direction</span>
              <div className={`flex w-full overflow-hidden border ${inner}`}>
                <button
                  type="button"
                  aria-pressed={direction === "outgoing"}
                  onClick={() => setDirection("outgoing")}
                  className={`min-w-0 flex-1 border-r px-2 py-1 text-xs ${direction === "outgoing" ? accent : inner}`}
                >
                  Outgoing neighbours →
                </button>
                <button
                  type="button"
                  aria-pressed={direction === "incoming"}
                  onClick={() => setDirection("incoming")}
                  className={`min-w-0 flex-1 px-2 py-1 text-xs ${direction === "incoming" ? accent : inner}`}
                >
                  ← Incoming neighbours
                </button>
              </div>
            </div>
            <div className="relative grid min-w-0 gap-1.5 text-xs font-bold" ref={focusMenuRef}>
              <span>Focus object</span>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={focusMenuOpen}
                onClick={() => setFocusMenuOpen((open) => !open)}
                className={`flex w-full min-w-0 items-center justify-between gap-2 border px-2 py-1 text-left text-xs font-normal ${inner}`}
              >
                <span className="min-w-0 truncate">{(() => { const selected = graph.nodes.find((n) => n.id === selectedObject); return selected ? `${selected.id} (${selected.type})` : "Select object"; })()}</span>
                <span aria-hidden="true" className="shrink-0">{focusMenuOpen ? "▴" : "▾"}</span>
              </button>
              {focusMenuOpen && (
                <div role="listbox" aria-label="Focus object" className={`absolute left-0 right-0 top-full z-50 mt-1.5 max-h-64 overflow-y-auto border shadow-xl ${menuSurface}`}>
                  {graph.nodes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      role="option"
                      aria-selected={selectedObject === n.id}
                      onClick={() => { onSelectedObjectChange(n.id); setFocusMenuOpen(false); }}
                      className={`block w-full min-w-0 px-2 py-1 text-left text-xs font-normal transition-transform duration-150 ${selectedObject === n.id ? menuSelected : menuHover}`}
                      title={`${n.id} (${n.type})`}
                    >
                      <span className="block break-all">{n.id}</span>
                      <span className={`mt-0.5 block text-[10px] font-normal ${muted}`}>{n.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <label className="grid gap-1.5 text-xs font-bold">
              <span>Neighbour level</span>
              <select value={depth} onChange={(e) => setDepth(e.target.value)} className={field} style={{ colorScheme: dark ? "dark" : "light" }}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="all">None (unlimited)</option>
              </select>
            </label>
          </>
        )}
      </div>

      {/* Cytoscape owns the host div's DOM, so React renders NO children inside it. */}
      <div className="relative w-full">
        <div ref={hostRef} className={`h-[420px] min-h-[260px] w-full overflow-hidden border ${dark ? "border-white" : "border-black"} ${surface}`}
          style={{ backgroundImage: `radial-gradient(${dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)"} 1px, transparent 1px)`, backgroundSize: "18px 18px" }} />
        {hover && (
          <div
            className={`pointer-events-none absolute z-20 max-w-64 break-all border px-2.5 py-1.5 font-mono text-xs ${inner}`}
            style={{ left: `clamp(4px, ${hover.x}px, calc(100% - 260px))`, top: `clamp(4px, ${hover.y}px, calc(100% - 42px))` }}
          >
            {hover.text}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- MAIN ---------------- */
export default function JavaVisual({ setLine, snapshots: snapshotsProp }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [selectedObject, setSelectedObjectState] = useState(selectedObjectId);
  const setSelectedObject = useCallback((id) => { selectedObjectId = id; setSelectedObjectState(id); }, []);
  const interactiveHover = "transition-transform duration-150";

  const panel = dark ? "border-white bg-[##0b0b0b] text-white" : "border-black bg-white text-black";
  const surface = dark ? "border-white bg-zinc-900 text-white" : "border-black bg-gray-50 text-black";
  const inner = dark ? "border-white bg-black text-white" : "border-black bg-white text-black";
  const muted = dark ? "text-gray-400" : "text-gray-500";
  const accent = dark ? "border-red-500 bg-red-500 text-white" : "border-red-600 bg-red-100 text-red-950";
  const currentLine = dark ? "border-red-500 bg-red-950 text-red-50" : "border-red-600 bg-red-50 text-red-950";

  const input = snapshotsProp ?? content;
  const normalized = useMemo(() => normalizeSnapshots(input), [input]);
  const snapshots = normalized.snapshots;

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [size, setSize] = useState(14);
  const [activeTab, setActiveTab] = useState("visual");
  const [scopeCollapse, setScopeCollapseState] = useState(persistedScopeCollapse);
  const setScopeCollapse = useCallback((value) => { persistedScopeCollapse = value; setScopeCollapseState(value); }, []);
  const [heapCollapse, setHeapCollapseState] = useState(persistedHeapCollapse);
  const setHeapCollapse = useCallback((value) => { persistedHeapCollapse = value; setHeapCollapseState(value); }, []);
  const [graphView, setGraphViewState] = useState(persistedGraphView);
  const setGraphView = useCallback((value) => { persistedGraphView = value; setGraphViewState(value); }, []);
  const [graphDepth, setGraphDepthState] = useState(persistedGraphDepth);
  const setGraphDepth = useCallback((value) => { persistedGraphDepth = value; setGraphDepthState(value); }, []);
  const [graphDirection, setGraphDirectionState] = useState(persistedGraphDirection);
  const setGraphDirection = useCallback((value) => { persistedGraphDirection = value; setGraphDirectionState(value); }, []);
  const [collapsedOverrides, setCollapsedOverrides] = useState({});
  const snap = snapshots[Math.min(step, snapshots.length - 1)];

  useEffect(() => {
    setStep(0);
    setPlaying(false);
    setActiveTab("visual");
  }, [input]);

  useEffect(() => {
    if (typeof setLine === "function" && snap) setLine(snap.l);
  }, [snap, setLine]);

  useEffect(() => {
    if (!playing || snapshots.length <= 1) return undefined;
    const timer = setInterval(() => {
      setStep((cur) => {
        if (cur >= snapshots.length - 1) { setPlaying(false); return cur; }
        return cur + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [playing, snapshots.length]);

  if (!snap) {
    return (
      <div className={`border p-4 ${dark ? "border-red-500 bg-black text-red-100" : "border-red-600 bg-red-50 text-red-950"}`}>
        {normalized.error ?? "No snapshots available."}
      </div>
    );
  }

  const tabs = [
    { id: "visual", label: "Visual", count: snap.v.length },
    { id: "scopes", label: "Scopes", count: snap.s.length },
    { id: "heap", label: "Heap", count: snap.h.length },
  ];
  const btn = `border px-2.5 py-1 text-xs font-bold ${interactiveHover} disabled:opacity-40`;

  return (
    <div
      className={`min-w-0 border p-5 ${panel} ${GLOBAL_OVERRIDES}`}
      style={{ fontSize: `${size}px`, "--accent": ACCENT, "--tv-radius": BORDER_RADIUS, "--tv-shadow": BUTTON_SHADOW, "--tv-scale": BUTTON_SCALE }}
    >
      {/* Playback controls */}
      <div className={`mb-3 flex flex-wrap items-center justify-center gap-1.5 border p-2 ${inner}`}>
        <button
          onClick={() => setPlaying((p) => !p)}
          disabled={snapshots.length < 2 || (playing && step === snapshots.length - 1)}
          className={`${btn} ${accent}`}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button onClick={() => setStep((c) => Math.max(0, c - 1))} disabled={step === 0} className={`${btn} ${inner}`}>← Prev</button>
        <button onClick={() => setStep((c) => Math.min(snapshots.length - 1, c + 1))} disabled={step >= snapshots.length - 1} className={`${btn} ${inner}`}>Next →</button>
        <button onClick={() => { setPlaying(false); setStep(0); }} className={`${btn} ${inner}`}>Stop / Reset</button>
        <div className={`border px-2 py-1 text-xs font-bold tabular-nums ${surface}`}>{step + 1} / {snapshots.length}</div>
        <div className="flex w-full items-center gap-2">
          <label htmlFor="trace-viewer-step" className={`whitespace-nowrap text-xs ${muted}`}>Snapshot</label>
          <input
            id="trace-viewer-step" type="range" min="0" max={Math.max(0, snapshots.length - 1)} step="1" value={step}
            disabled={snapshots.length < 2}
            onChange={(e) => setStep(Number(e.target.value))}
            className="h-4 w-full accent-red-500"
          />
        </div>
        <div className="flex min-w-32 items-center gap-2">
          <label htmlFor="trace-viewer-size" className={`whitespace-nowrap text-xs ${muted}`}>Size {size}px</label>
          <input
            id="trace-viewer-size" type="range" min="12" max="20" step="1" value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="h-4 w-full accent-red-500"
          />
        </div>
        <label className={`flex items-center gap-2 text-xs font-semibold ${muted}`}>
          Scopes collapse
          <select value={scopeCollapse} onChange={e => { setScopeCollapse(e.target.value); setCollapsedOverrides({}); }} className={`border px-1.5 py-0.5 text-xs ${inner}`}>
            <option value="no">No</option><option value="all">All</option>
          </select>
        </label>
        <label className={`flex items-center gap-2 text-xs font-semibold ${muted}`}>
          Heap collapse
          <select value={heapCollapse} onChange={e => { setHeapCollapse(e.target.value); setCollapsedOverrides({}); }} className={`border px-1.5 py-0.5 text-xs ${inner}`}>
            <option value="no">No</option>
            <option value="all">All</option>
            {[...new Set(snapshots.flatMap(x => x.h.map(h => h.t || String(h.n).split("@")[0])))].sort().map(t => <option key={t} value={`type:${t}`}>{t}</option>)}
          </select>
        </label>
      </div>

      {/* Current line */}
      <div className={`mb-3 flex items-center justify-between border px-3 py-1.5 ${currentLine}`}>
        <span className="text-xs font-bold uppercase tracking-widest opacity-80">Current Line</span>
        <span className="font-mono text-sm font-bold tabular-nums">{snap.l}</span>
      </div>

      {/* Switchable views */}
      <div className="mb-3 grid grid-cols-3 gap-2" role="tablist" aria-label="Execution views">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`trace-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`trace-panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`min-w-0 border px-2 py-1.5 text-xs font-bold ${interactiveHover} ${activeTab === tab.id ? "border-red-500 bg-red-500 text-white" : inner}`}
          >
            <span>{tab.label}</span>
            <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${activeTab === tab.id ? "bg-white/25 text-white" : dark ? "bg-zinc-800 text-gray-300" : "bg-gray-100 text-gray-600"}`}>{tab.count}</span>
          </button>
        ))}
      </div>

      <section hidden={activeTab !== "visual"} role="tabpanel" id="trace-panel-visual" aria-labelledby="trace-tab-visual" className={`border p-4 ${panel}`}>
        <VisualGraph nodes={snap.v} heaps={snap.h} dark={dark} selectedObject={selectedObject} onSelectedObjectChange={setSelectedObject} view={graphView} setView={setGraphView} depth={graphDepth} setDepth={setGraphDepth} direction={graphDirection} setDirection={setGraphDirection} />
      </section>

      {activeTab === "scopes" && (
        <section role="tabpanel" id="trace-panel-scopes" aria-labelledby="trace-tab-scopes" className={`border p-4 ${panel}`}>
          <div className="mb-3 flex items-center gap-2 font-bold"><span className="inline-block h-4 w-1 bg-red-500" />Scopes</div>
          {snap.s.length === 0 ? (
            <div className={`border border-dashed px-3 py-6 text-center text-sm ${inner} ${muted}`}>No active frames</div>
          ) : (
            <div className="flex w-full min-w-0 flex-col gap-3">
              {snap.s.map(([name, vars], index) => (
                <div key={name} className={`min-w-0 border p-3 ${index === 0 ? currentLine : surface}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="break-words font-mono font-bold">{name}</span>
                    <button type="button" onClick={() => setCollapsedOverrides(old => ({...old, [`scope:${name}`]: !(Object.prototype.hasOwnProperty.call(old, `scope:${name}`) ? old[`scope:${name}`] : scopeCollapse === "all")}))} className="min-w-[28px] border px-2 py-0.5 text-xs font-bold leading-5">{(Object.prototype.hasOwnProperty.call(collapsedOverrides, `scope:${name}`) ? collapsedOverrides[`scope:${name}`] : scopeCollapse === "all") ? "+" : "−"}</button>
                  </div>
                  {!(Object.prototype.hasOwnProperty.call(collapsedOverrides, `scope:${name}`) ? collapsedOverrides[`scope:${name}`] : scopeCollapse === "all") && (!Array.isArray(vars) || vars.length === 0) ? (
                    <div className={`text-sm ${muted}`}>No variables</div>
                  ) : !(Object.prototype.hasOwnProperty.call(collapsedOverrides, `scope:${name}`) ? collapsedOverrides[`scope:${name}`] : scopeCollapse === "all") ? (
                    <div className="flex flex-col items-stretch gap-2">
                      {vars.map((v, i) => (
                        <Entry key={i} e={v} dark={dark} path={`scope:${name}/${v.n}:${i}`} collapsedOverrides={collapsedOverrides} setCollapsedOverrides={setCollapsedOverrides} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "heap" && (
        <section role="tabpanel" id="trace-panel-heap" aria-labelledby="trace-tab-heap" className={`border p-4 ${panel}`}>
          <div className="mb-3 flex items-center gap-2 font-bold"><span className="inline-block h-4 w-1 bg-red-500" />Heap</div>
          {snap.h.length === 0 ? (
            <div className={`border border-dashed px-3 py-6 text-center text-sm ${inner} ${muted}`}>No live objects</div>
          ) : (
            <div className="grid w-full min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] items-start gap-3">
              {snap.h.map((h, i) => (
                <Entry key={i} e={h} dark={dark} depth={1} full path={`heap:${h.n}`} forceCollapsed={heapCollapse === "all" || (heapCollapse.startsWith("type:") && (h.t || String(h.n).split("@")[0]) !== heapCollapse.slice(5))} forceExpanded={heapCollapse === "no" || (heapCollapse.startsWith("type:") && (h.t || String(h.n).split("@")[0]) === heapCollapse.slice(5))} collapsedOverrides={collapsedOverrides} setCollapsedOverrides={setCollapsedOverrides} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
