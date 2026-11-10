import com.sun.jdi.*;

import com.sun.jdi.connect.*;

import com.sun.jdi.event.*;

import com.sun.jdi.request.*;



import java.util.*;
import java.nio.file.*;
import javax.tools.*;



public class Watcher {

    static int step = 0;

    static boolean steppingStarted = false;
    static EventRequestManager eventManager;

    static final List<String> snapshots = new ArrayList<>();



    static final Map<Long, ObjectReference> knownHeap = new LinkedHashMap<>();

    static final Map<String, LinkedHashSet<String>> variableOrder = new LinkedHashMap<>();

    static final Map<Long, String> pendingConstructors = new LinkedHashMap<>();


    static final List<EventRequest> temporarilyDisabled = new ArrayList<>();

    static int steppingSuppressionDepth = 0;

    // Latest highlight state is applied when each snapshot is serialized.

    static final Map<Long, String> objectColors = new LinkedHashMap<>();

    static final Map<Long, Map<String, String>> elementColors = new LinkedHashMap<>();



    static String targetClass = "Main";
    static String targetSourcePath = null;



    public static void main(String[] args) throws Exception {

        targetClass = args.length > 0 && args[0] != null && !args[0].isBlank()

                ? args[0] : "Main";
        targetSourcePath = args.length > 1 ? args[1] : null;



VirtualMachine vm = launchMain(targetClass);

EventRequestManager erm = vm.eventRequestManager();

        eventManager = erm;



MethodEntryRequest methodEntry = erm.createMethodEntryRequest();

        methodEntry.addClassFilter(targetClass);

        methodEntry.enable();



        vm.resume();

EventQueue queue = vm.eventQueue();



        while (true) {

EventSet events = queue.remove();

boolean stop = false;



            for (Event event : events) {

                if (event instanceof MethodEntryEvent e) {

String method = e.method().name();

                    if (method.equals("main") && !steppingStarted) {

StepRequest request = erm.createStepRequest(

                                e.thread(), StepRequest.STEP_LINE, StepRequest.STEP_INTO);

                        request.addClassExclusionFilter("java.*");

                        request.addClassExclusionFilter("javax.*");

                        request.addClassExclusionFilter("jdk.*");

                        request.addClassExclusionFilter("sun.*");

                        request.addClassExclusionFilter("com.sun.*");

                        request.enable();

                        steppingStarted = true;

                    } else if (method.equals("point")) {

                        capturePoint(e.thread(), e.method());

                    }

                }



                if (event instanceof StepEvent e) {

                    // Use the event location instead of querying frames on a thread

                    // that may already have resumed during another event in this set.

                    if (e.location().method().name().equals("point")) continue;

                    handleStep(e.thread());

                }



                if (event instanceof VMDeathEvent || event instanceof VMDisconnectEvent) stop = true;

            }



            if (stop) break;

            events.resume();

        }



        snapshots.addAll(pendingConstructors.values());

        System.out.println("[" + String.join(",", snapshots) + "]");

    }



    static void handleStep(ThreadReference thread) throws Exception {

        // Do not expose implementation-level iterator calls as user execution steps.

        // The next snapshot is taken when control returns to the user's code.

        if (insideIteratorExecution(thread)) return;



        // Point annotations are consumed after this snapshot is serialized.

List<StackFrame> frames = thread.frames();

Set<Long> activeConstructors = new HashSet<>();



        for (StackFrame frame : frames) {

            if (!frame.location().method().name().equals("<init>")) continue;

ObjectReference object = frame.thisObject();

            if (object != null) activeConstructors.add(object.uniqueID());

        }



Iterator<Map.Entry<Long, String>> iterator = pendingConstructors.entrySet().iterator();

        while (iterator.hasNext()) {

Map.Entry<Long, String> entry = iterator.next();

            if (!activeConstructors.contains(entry.getKey())) {

                snapshots.add(entry.getValue());

                iterator.remove();

            }

        }



        if (!frames.isEmpty() && frames.get(0).location().method().name().equals("<init>")) {

ObjectReference object = frames.get(0).thisObject();

            if (object != null) {
                pendingConstructors.put(object.uniqueID(), buildSnapshot(thread));
                clearPointColors();
            }

            return;

        }



        step++;

        snapshots.add(buildSnapshot(thread));
        clearPointColors();

    }



    // Read point() arguments directly from the method signature. This does not
    // depend on local-variable debug names or -g:vars metadata.
    static void capturePoint(ThreadReference thread, Method method) throws Exception {
        List<Value> args = thread.frame(0).getArgumentValues();
        List<String> types = method.argumentTypeNames();
        if (args.size() < 2 || types.size() != args.size()) return;

        ObjectReference target = args.get(0) instanceof ObjectReference ref ? ref : null;
        if (target == null) return;

        String color = null;
        List<Integer> indices = new ArrayList<>();
        for (int i = 1; i < args.size(); i++) {
            Value value = args.get(i);
            if (value instanceof StringReference string) color = string.value();
            else {
                Integer index = readIndexValue(value, thread);
                if (index != null) indices.add(index);
            }
        }
        if (color == null || !Set.of("red", "green", "blue", "purple", "orange").contains(color.toLowerCase(Locale.ROOT))) return;
        setPointColor(target, color.toLowerCase(Locale.ROOT), indices.stream().mapToInt(Integer::intValue).toArray());
    }

    static Integer readIndexValue(Value value, ThreadReference thread) {

        if (value instanceof IntegerValue integer) return integer.value();

        if (value instanceof ObjectReference ref

                && ref.referenceType().name().equals("java.lang.Integer")) {

            try {

Value unboxed = invokeZeroArg(ref, "intValue", thread);

                if (unboxed instanceof IntegerValue integer) return integer.value();

            } catch (Exception ignored) { }

        }

        return null;

    }



    static void clearPointColors() {

        objectColors.clear();

        elementColors.clear();

    }



    static void setPointColor(ObjectReference target, String color, int[] indices) throws Exception {

        ensureKnown(target);

long id = target.uniqueID();



        // Indices are reserved for actual Java arrays (1D and 2D).

        // Linear, tree, and graph highlights are reference-based: point(curr, "red")

        // colors that exact object, never an iterator's temporary traversal index.

        if (!(target instanceof ArrayReference) || indices == null || indices.length == 0) {

            objectColors.put(id, color);

            return;

        }



String key;

        if (indices.length == 1) {

            key = Integer.toString(indices[0]);

        } else {

            key = indices[0] + "," + indices[1];

        }

        elementColors.computeIfAbsent(id, ignored -> new LinkedHashMap<>()).put(key, color);

    }



    static void ensureKnown(ObjectReference target) throws Exception {

        if (!knownHeap.containsKey(target.uniqueID())) {

            collectObject(target, knownHeap, new HashSet<>());

        }

    }



    static String resolveVisualName(ObjectReference target, ThreadReference thread) {

        try {

            for (StackFrame candidate : thread.frames()) {

String method = candidate.location().method().name();

                if (method.equals("point")) continue;

List<LocalVariable> locals;

                try { locals = candidate.visibleVariables(); }

                catch (AbsentInformationException ignored) { continue; }

Map<LocalVariable, Value> values = candidate.getValues(locals);

                for (Map.Entry<LocalVariable, Value> entry : values.entrySet()) {

                    if (entry.getKey().name().equals("args")) continue;

                    if (entry.getValue() instanceof ObjectReference ref

                            && ref.uniqueID() == target.uniqueID()) {

                        return entry.getKey().name();

                    }

                }

            }

        } catch (Exception ignored) { }

        return simpleName(target.referenceType().name());

    }



    static String simpleName(String name) {

        return name.substring(name.lastIndexOf('.') + 1);

    }



    static int[] readIntArray(ArrayReference array) throws Exception {

int[] result = new int[array.length()];

        for (int i = 0; i < array.length(); i++) {

Value value = array.getValue(i);

            if (value instanceof IntegerValue integer) result[i] = integer.value();

        }

        return result;

    }



    static String buildSnapshot(ThreadReference thread) throws Exception {
        List<StackFrame> frames = thread.frames();
        Set<Long> visited = new HashSet<>();

        // Keep the existing live heap walk: inspect every non-infrastructure
        // frame on every snapshot and recursively discover reachable objects.
        for (StackFrame frame : frames) {
            if (!isInfrastructureFrame(frame)) {
                collectFrameObjects(frame, knownHeap, visited);
            }
        }

        List<StackFrame> userFrames = new ArrayList<>();
        Location location = null;
        for (StackFrame frame : frames) {
            if (!isInfrastructureFrame(frame)) {
                userFrames.add(frame);
                if (location == null) location = frame.location();
            }
        }
        int line = location == null ? -1 : location.lineNumber();

        StringBuilder out = new StringBuilder();
        out.append("{\"l\":").append(line).append(",\"s\":{");

        // Match the C++ tracer's function-keyed scope map. Frames are ordered
        // innermost-first; suffixes keep recursive invocations distinct.
        boolean firstScope = true;
        int totalFrames = userFrames.size();
        for (int i = 0; i < totalFrames; i++) {
            StackFrame frame = userFrames.get(i);
            int level = totalFrames - 1 - i;
            String scopeName = frame.location().method().name();
            if (level > 0) scopeName += "#" + level;

            if (!firstScope) out.append(',');
            firstScope = false;
            appendJsonString(out, scopeName);
            out.append(':');
            appendScope(out, frame, scopeName);
        }

        out.append("},\"h\":[");
        boolean firstHeap = true;
        for (ObjectReference object : knownHeap.values()) {
            if (!firstHeap) out.append(',');
            firstHeap = false;
            appendHeapObject(out, object);
        }

        // Generic directed heap-reference graph is captured on every snapshot.
        out.append("],\"v\":");
        appendVisualGraph(out);
        out.append('}');
        return out.toString();
    }


    /**
     * Serialize the discovered heap as a directed object-reference graph.
     *
     * Each graph node is independent from heap serialization:
     * { n: objectId, e: [{ n: targetObjectId, r: relationship }] }
     *
     * Type, color, and attributes are resolved from the heap by object ID.
     * Edges point from the owning object to the referenced object.
     * Array element references use [index] as their relationship label.
     */

    /**
     * Serialize the discovered heap as a directed object-reference graph.
     * Each heap object becomes {name, type, color, edges:[{name, relationship}]}.
     */
    static void appendVisualGraph(StringBuilder out) throws Exception {
        out.append('[');
        boolean firstNode = true;

        for (ObjectReference object : knownHeap.values()) {
            if (object == null) continue;
            if (!firstNode) out.append(',');
            firstNode = false;

            out.append("{\"n\":");
            appendJsonString(out, nodeId(object));
            out.append(",\"c\":");
            appendJsonString(out, objectColors.getOrDefault(object.uniqueID(), "None"));
            out.append(",\"e\":[");

            boolean firstEdge = true;

            if (object instanceof ArrayReference array) {
                for (int i = 0; i < array.length(); i++) {
                    Value value = array.getValue(i);
                    if (!(value instanceof ObjectReference target)) continue;
                    if (target instanceof StringReference) continue;
                    if (!knownHeap.containsKey(target.uniqueID())) continue;

                    if (!firstEdge) out.append(',');
                    firstEdge = false;
                    out.append("{\"n\":");
                    appendJsonString(out, nodeId(target));
                    out.append(",\"r\":");
                    appendJsonString(out, "[" + i + "]");
                    out.append(",\"c\":");
                    appendJsonString(out, itemColor(object.uniqueID(), Integer.toString(i)));
                    out.append('}');
                }
            } else {
                for (Field field : object.referenceType().allFields()) {
                    if (field.isStatic()) continue;
                    Value value = object.getValue(field);
                    if (!(value instanceof ObjectReference target)) continue;
                    if (target instanceof StringReference) continue;
                    if (isIteratorObject(target)) continue;
                    if (!knownHeap.containsKey(target.uniqueID())) continue;

                    if (!firstEdge) out.append(',');
                    firstEdge = false;
                    out.append("{\"n\":");
                    appendJsonString(out, nodeId(target));
                    out.append(",\"r\":");
                    appendJsonString(out, field.name());
                    out.append('}');
                }
            }

            out.append("]}");
        }

        out.append(']');
    }

    static String resolveGraphComponent(ObjectReference graph) throws Exception {

String[] preferred = {"adjList", "adjacencyList", "adjacency", "adj", "edges", "neighbors"};

        for (String candidate : preferred) {

Field field = findField(graph.referenceType(), candidate);

            if (field != null && !field.isStatic()) return field.name();

        }

        for (Field field : graph.referenceType().allFields()) {

            if (field.isStatic()) continue;

Value value = graph.getValue(field);

            if (value instanceof ArrayReference) return field.name();

            if (value instanceof ObjectReference ref && isIterable(ref)) return field.name();

        }

        return null;

    }



    static String invokeToString(ObjectReference target, ThreadReference thread) throws Exception {

        try {

            disableStepping();

Value value = invokeZeroArg(target, "toString", thread);

            return value instanceof StringReference string ? string.value() : String.valueOf(value);

        } catch (Exception ignored) {

            return target.referenceType().name() + "@" + target.uniqueID();

        } finally {

            enableStepping();

        }

    }



    static String itemColor(long targetId, String key) {

        return elementColors.getOrDefault(targetId, Collections.emptyMap())

                .getOrDefault(key, "none");

    }



    static List<Value> readSequence(Value value, ThreadReference thread) throws Exception {

        if (value instanceof ArrayReference array) return array.getValues();

        if (!(value instanceof ObjectReference ref) || value instanceof StringReference) return null;



        // Read ArrayList directly even if JDI does not expose its Iterable interface.

        if (ref.referenceType().name().equals("java.util.ArrayList")) {

Field sizeField = findField(ref.referenceType(), "size");

Field dataField = findField(ref.referenceType(), "elementData");

            if (sizeField != null && dataField != null) {

Value sizeValue = ref.getValue(sizeField);

Value dataValue = ref.getValue(dataField);

                if (sizeValue instanceof IntegerValue size && dataValue instanceof ArrayReference data) {

List<Value> direct = new ArrayList<>();

int count = Math.min(size.value(), data.length());

                    for (int i = 0; i < count; i++) direct.add(data.getValue(i));

                    return direct;

                }

            }

        }

        if (!isIterable(ref)) return null;

List<Value> values = new ArrayList<>();

        disableStepping();

        try {

Value iv = invokeZeroArg(ref, "iterator", thread);

            if (!(iv instanceof ObjectReference iterator)) return null;

            while (values.size() < 10000) {

Value hasNext = invokeZeroArg(iterator, "hasNext", thread);

                if (!(hasNext instanceof BooleanValue b) || !b.value()) break;

                values.add(invokeZeroArg(iterator, "next", thread));

            }

        } finally { enableStepping(); }

        return values;

    }



    static void appendStructuredValue(StringBuilder out, Value value,

ThreadReference thread, int depth) throws Exception {

        if (depth > 8) { appendJsonString(out, "<max-depth>"); return; }

        if (value instanceof ArrayReference array) {

            out.append('[');

            for (int i = 0; i < array.length(); i++) {

                if (i > 0) out.append(',');

                appendStructuredValue(out, array.getValue(i), thread, depth + 1);

            }

            out.append(']');

            return;

        }

        if (value instanceof ObjectReference ref && !(value instanceof StringReference)

                && isIterable(ref)) {

            disableStepping();

            try {

Value iv = invokeZeroArg(ref, "iterator", thread);

                if (iv instanceof ObjectReference iterator) {

                    out.append('[');

boolean first = true;

int count = 0;

                    while (count++ < 10000) {

Value hasNext = invokeZeroArg(iterator, "hasNext", thread);

                        if (!(hasNext instanceof BooleanValue b) || !b.value()) break;

Value next = invokeZeroArg(iterator, "next", thread);

                        if (!first) out.append(',');

                        first = false;

                        appendStructuredValue(out, next, thread, depth + 1);

                    }

                    out.append(']');

                    return;

                }

            } finally {

                enableStepping();

            }

        }

        appendJsonValue(out, value);

    }



    static boolean isIterable(ObjectReference object) {

        try {

ReferenceType referenceType = object.referenceType();

            while (referenceType instanceof ClassType type) {

                for (InterfaceType it : type.interfaces()) {

                    if (interfaceExtendsIterable(it)) return true;

                }

                referenceType = type.superclass();

            }

            if (referenceType instanceof InterfaceType it && interfaceExtendsIterable(it)) return true;

            // JDI interface traversal can be incomplete for some collection implementations.

            // A zero-argument iterator() is a fallback for generic collection traversal.

            return object.referenceType().allMethods().stream().anyMatch(m ->

                    m.name().equals("iterator") && m.argumentTypeNames().isEmpty());

        } catch (Exception ignored) { }

        return false;

    }



    static boolean interfaceExtendsIterable(InterfaceType type) {

        if (type.name().equals("java.lang.Iterable")) return true;

        for (InterfaceType parent : type.superinterfaces()) {

            if (interfaceExtendsIterable(parent)) return true;

        }

        return false;

    }



    static Value selectedField(ObjectReference object, String fieldName) throws Exception {

Field field = findField(object.referenceType(), fieldName);

        return field == null || field.isStatic() ? null : object.getValue(field);

    }



    static Field findField(ReferenceType type, String name) {

        if (type == null || name == null) return null;

        for (Field field : type.allFields()) if (field.name().equals(name)) return field;

        return null;

    }



    static String nodeId(ObjectReference node) {

        return node.referenceType().name() + "@" + node.uniqueID();

    }



    static void appendNodeRef(StringBuilder out, Value value) {

        if (value instanceof ObjectReference ref) appendJsonString(out, nodeId(ref));

        else out.append("null");

    }



    static Value invokeZeroArg(ObjectReference object, String methodName,

ThreadReference thread) throws Exception {

Method method = null;

        for (Method candidate : object.referenceType().allMethods()) {

            if (candidate.name().equals(methodName) && candidate.argumentTypeNames().isEmpty()) {

                // Prefer the most-specific override returned by JDI.

                method = candidate;

                break;

            }

        }

        if (method == null) throw new IllegalStateException("No zero-argument method: " + methodName);

        return object.invokeMethod(thread, method, Collections.emptyList(),

                ObjectReference.INVOKE_SINGLE_THREADED);

    }



    static void disableStepping() {

        if (steppingSuppressionDepth++ > 0) return;

        temporarilyDisabled.clear();

        if (eventManager == null) return;

        for (StepRequest request : eventManager.stepRequests()) {

            if (request.isEnabled()) { request.disable(); temporarilyDisabled.add(request); }

        }

        for (MethodEntryRequest request : eventManager.methodEntryRequests()) {

            if (request.isEnabled()) { request.disable(); temporarilyDisabled.add(request); }

        }

    }



    static void enableStepping() {

        if (steppingSuppressionDepth == 0 || --steppingSuppressionDepth > 0) return;

        for (EventRequest request : temporarilyDisabled) {

            try { request.enable(); } catch (Exception ignored) { }

        }

        temporarilyDisabled.clear();

    }



    // Iterator implementation frames are execution machinery, not user code.

    static boolean isInfrastructureFrame(StackFrame frame) {

String method = frame.location().method().name();

        return method.equals("point") || isIteratorSupportFrame(frame);

    }



    static boolean insideIteratorExecution(ThreadReference thread) {

        try {

            for (StackFrame frame : thread.frames()) {

                if (isIteratorSupportFrame(frame)) return true;

            }

        } catch (Exception ignored) { }

        return false;

    }



    static boolean isIteratorSupportFrame(StackFrame frame) {

        try {

String method = frame.location().method().name();

ReferenceType type = frame.location().declaringType();

            if ((method.equals("hasNext") || method.equals("next") || method.equals("remove"))

                    && implementsNamedInterface(type, "java.util.Iterator")) return true;

            return method.equals("iterator") && implementsNamedInterface(type, "java.lang.Iterable");

        } catch (Exception ignored) { return false; }

    }



    static boolean isIteratorObject(ObjectReference object) {

        try { return implementsNamedInterface(object.referenceType(), "java.util.Iterator"); }

        catch (Exception ignored) { return false; }

    }



    static boolean implementsNamedInterface(ReferenceType type, String wanted) {

        if (type == null) return false;

        if (type.name().equals(wanted)) return true;

        try {

            if (type instanceof ClassType cls) {

                for (InterfaceType iface : cls.interfaces()) {

                    if (implementsNamedInterface(iface, wanted)) return true;

                }

                return implementsNamedInterface(cls.superclass(), wanted);

            }

            if (type instanceof InterfaceType iface) {

                for (InterfaceType parent : iface.superinterfaces()) {

                    if (implementsNamedInterface(parent, wanted)) return true;

                }

            }

        } catch (Exception ignored) { }

        return false;

    }



    static void collectFrameObjects(StackFrame frame, Map<Long, ObjectReference> heap,

Set<Long> visited) throws Exception {

List<LocalVariable> variables;

        try { variables = frame.visibleVariables(); }

        catch (AbsentInformationException e) { return; }

Map<LocalVariable, Value> values = frame.getValues(variables);

        for (Map.Entry<LocalVariable, Value> entry : values.entrySet()) {

            if (entry.getKey().name().equals("args")) continue;

            if (entry.getValue() instanceof ObjectReference object) {

                if (isIteratorObject(object)) continue;

                collectObject(object, heap, visited);

            }

        }

    }



    static void collectObject(ObjectReference object, Map<Long, ObjectReference> heap,

Set<Long> visited) throws Exception {

        if (object instanceof StringReference || isIteratorObject(object) || isJdkObject(object)) return;

long id = object.uniqueID();

        if (!heap.containsKey(id)) {

            heap.put(id, object);

            try { object.disableCollection(); } catch (Exception ignored) { }

        }

        if (!visited.add(id)) return;



        if (object instanceof ArrayReference array) {

            for (Value value : array.getValues()) {

                if (value instanceof ObjectReference ref && !isIteratorObject(ref)) {

                    collectObject(ref, heap, visited);

                }

            }

            return;

        }

        for (Field field : object.referenceType().allFields()) {

            if (field.isStatic()) continue;

Value value = object.getValue(field);

            if (value instanceof ObjectReference ref && !isIteratorObject(ref)) {

                collectObject(ref, heap, visited);

            }

        }

    }



    static boolean isJdkObject(ObjectReference object) {

        if (object instanceof StringReference) return true;

String type = object.referenceType().name();

        return type.startsWith("javax.") || type.startsWith("jdk.")

                || type.startsWith("sun.") || type.startsWith("com.sun.");

    }



    static void appendScope(StringBuilder out, StackFrame frame, String scopeName) throws Exception {
        List<LocalVariable> variables;
        try {
            variables = frame.visibleVariables();
        } catch (AbsentInformationException e) {
            out.append("[]");
            return;
        }

        Map<LocalVariable, Value> values = frame.getValues(variables);
        Map<String, Value> currentValues = new LinkedHashMap<>();
        Map<String, LocalVariable> currentVariables = new LinkedHashMap<>();
        for (Map.Entry<LocalVariable, Value> entry : values.entrySet()) {
            LocalVariable variable = entry.getKey();
            Value value = entry.getValue();
            if (variable.name().equals("args")) continue;
            if (value instanceof ObjectReference ref && isIteratorObject(ref)) continue;
            currentVariables.put(variable.name(), variable);
            currentValues.put(variable.name(), value);
        }

        LinkedHashSet<String> order = variableOrder.computeIfAbsent(scopeName, k -> new LinkedHashSet<>());
        order.addAll(currentVariables.keySet());
        out.append('[');
        boolean first = true;
        for (String name : order) {
            LocalVariable variable = currentVariables.get(name);
            if (variable == null) continue;
            if (!first) out.append(',');
            first = false;
            appendVariable(out, variable, currentValues.get(name));
        }
        out.append(']');
    }

    static void appendVariable(StringBuilder out, LocalVariable variable, Value value) throws Exception {
        out.append("{\"n\":");
        appendJsonString(out, variable.name());
        out.append(",\"t\":");
        appendJsonString(out, variable.typeName());
        out.append(",\"c\":");
        String color = value instanceof ObjectReference ref
                ? objectColors.getOrDefault(ref.uniqueID(), "None") : "None";
        appendJsonString(out, color);
        out.append(",\"value\":");
        appendJsonValue(out, value);
        if (value instanceof ArrayReference array) {
            out.append(",\"a\":");
            appendArrayAttributes(out, array, 1, array.uniqueID(), "");
        }
        out.append('}');
    }

    static void appendHeapObject(StringBuilder out, ObjectReference object) throws Exception {
        String typeName = object.referenceType().name();
        String id = typeName + "@" + object.uniqueID();
        out.append("{\"n\":");
        appendJsonString(out, id);
        out.append(",\"t\":");
        appendJsonString(out, typeName);
        out.append(",\"c\":");
        appendJsonString(out, objectColors.getOrDefault(object.uniqueID(), "None"));

        if (object instanceof ArrayReference array) {
            out.append(",\"a\":");
            appendArrayAttributes(out, array, 1, array.uniqueID(), "");
            out.append('}');
            return;
        }

        out.append(",\"a\":[");
        boolean first = true;
        for (Field field : object.referenceType().allFields()) {
            if (field.isStatic()) continue;
            Value value = object.getValue(field);
            if (value instanceof ObjectReference ref && isIteratorObject(ref)) continue;
            if (value instanceof ObjectReference ref && isJdkObject(ref)
                    && !(ref instanceof StringReference)) continue;

            if (!first) out.append(',');
            first = false;
            out.append("{\"n\":");
            appendJsonString(out, field.name());
            out.append(",\"t\":");
            appendJsonString(out, field.typeName());
            out.append(",\"c\":");
            String color = value instanceof ObjectReference ref
                    ? objectColors.getOrDefault(ref.uniqueID(), "None") : "None";
            appendJsonString(out, color);
            out.append(",\"value\":");
            appendJsonValue(out, value);
            out.append('}');
        }
        out.append("]}");
    }

    static int arrayDimensions(ArrayReference array) {
        String type = array.referenceType().name();
        int dimensions = 0;
        for (int i = 0; i < type.length() - 1; i++)
            if (type.charAt(i) == '[' && type.charAt(i + 1) == ']') dimensions++;
        return Math.max(1, dimensions);
    }

    static void appendArrayAttributes(StringBuilder out, ArrayReference array, int depth, long rootId, String prefix) throws Exception {
        if (arrayDimensions(array) > 2) {
            out.append("[{\"n\":\"More than 2 dimensions\",\"t\":\"warning\",\"c\":\"orange\"}]");
            return;
        }
        out.append('[');
        for (int i = 0; i < array.length(); i++) {
            if (i > 0) out.append(',');
            Value value = array.getValue(i);
            out.append("{\"n\":\"\",\"t\":");
            appendJsonString(out, value == null ? "null" : value.type() == null ? "unknown" : value.type().name());
            out.append(",\"c\":");
            String key = prefix.isEmpty() ? Integer.toString(i) : prefix + "," + i;
            String color = itemColor(rootId, key);
            if ("none".equals(color)) color = itemColor(array.uniqueID(), Integer.toString(i));
            if ("none".equals(color) && value instanceof ObjectReference ref) {
                color = objectColors.getOrDefault(ref.uniqueID(), "none");
            }
            appendJsonString(out, color);
            if (value instanceof ArrayReference nested) {
                out.append(",\"a\":");
                appendArrayAttributes(out, nested, depth + 1, rootId, key);
            } else {
                out.append(",\"value\":");
                appendJsonValue(out, value);
            }
            out.append('}');
        }
        out.append(']');
    }

    static String displayValue(Value value) {

        if (value == null) return "null";

        if (value instanceof StringReference string) return string.value();

        if (value instanceof ObjectReference ref) return ref.referenceType().name() + "@" + ref.uniqueID();

        return value.toString();

    }



    static void appendJsonValue(StringBuilder out, Value value) throws Exception {

        if (value == null) out.append("null");

        else if (value instanceof StringReference string) appendJsonString(out, string.value());

        else if (value instanceof ArrayReference array) {

            out.append('[');

            for (int i = 0; i < array.length(); i++) {

                if (i > 0) out.append(',');

                appendJsonValue(out, array.getValue(i));

            }

            out.append(']');

        } else if (value instanceof ObjectReference ref) {

            appendJsonString(out, ref.referenceType().name() + "@" + ref.uniqueID());

        } else if (value instanceof ByteValue || value instanceof ShortValue

                || value instanceof IntegerValue || value instanceof LongValue

                || value instanceof FloatValue || value instanceof DoubleValue

                || value instanceof BooleanValue) out.append(value.toString());

        else if (value instanceof CharValue character) appendJsonString(out, String.valueOf(character.value()));

        else appendJsonString(out, value.toString());

    }



    static void appendJsonString(StringBuilder out, String value) {

        out.append('"'); appendJsonStringContent(out, value); out.append('"');

    }



    static void appendJsonStringContent(StringBuilder out, String value) {

        for (int i = 0; i < value.length(); i++) {

char c = value.charAt(i);

            switch (c) {

                case '"' -> out.append("\"");

                case '\\' -> out.append("\\\\");

                case '\n' -> out.append("\\n");

                case '\r' -> out.append("\\r");

                case '\t' -> out.append("\\t");

                default -> {

                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));

                    else out.append(c);

                }

            }

        }

    }



    static VirtualMachine launchMain(String mainClass) throws Exception {
        Path source = locateSource(mainClass);
        if (source == null) {
            throw new IllegalStateException("Cannot inject point(): source file not found. Run Watcher with the target .java file in the working directory or pass its path as the second argument.");
        }
        Path output = null;
        if (source != null) {
            output = Files.createTempDirectory("traceviewer-java-");
            String code = Files.readString(source);
            if (!code.contains("static void point(") && !code.contains("static void point (")) {
                int insertAt = code.lastIndexOf('}');
                if (insertAt < 0) throw new IllegalArgumentException("Cannot locate class closing brace in " + source);
                String helpers = "\n    // Injected by TraceViewer: intercepted by the Java watcher.\n"
                    + "    static void point(Object object, String color) {}\n"
                    + "    static void point(Object array, int index, String color) {}\n"
                    + "    static void point(Object matrix, int row, int column, String color) {}\n";
                code = code.substring(0, insertAt) + helpers + code.substring(insertAt);
            }
            JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
            if (compiler == null) throw new IllegalStateException("A JDK is required to inject point(); no system Java compiler found.");
            // Compile a generated copy, not the original source.
            int result;
            Path generated = output.resolve(source.getFileName());
            Files.writeString(generated, code);
            result = compiler.run(null, System.err, System.err, "-g", "-d", output.toString(), generated.toString());
            if (result != 0) throw new IllegalStateException("Target compilation failed; point() injection was not completed.");
        }

        VirtualMachineManager manager = Bootstrap.virtualMachineManager();
        LaunchingConnector connector = manager.defaultConnector();
        Map<String, Connector.Argument> arguments = connector.defaultArguments();
        arguments.get("main").setValue(mainClass);
        if (output != null && arguments.containsKey("options")) {
            String current = System.getProperty("java.class.path", ".");
            arguments.get("options").setValue("-cp \"" + output + java.io.File.pathSeparator + current + "\"");
        }
        return connector.launch(arguments);
    }

    static Path locateSource(String mainClass) {
        if (targetSourcePath != null) {
            Path supplied = Path.of(targetSourcePath).toAbsolutePath();
            if (Files.isRegularFile(supplied)) return supplied;
            throw new IllegalArgumentException("Target source file does not exist: " + supplied);
        }
        String relative = mainClass.replace('.', java.io.File.separatorChar) + ".java";
        Path direct = Path.of(relative).toAbsolutePath();
        if (Files.isRegularFile(direct)) return direct;
        Path cwd = Path.of(mainClass.substring(mainClass.lastIndexOf('.') + 1) + ".java").toAbsolutePath();
        return Files.isRegularFile(cwd) ? cwd : null;
    }

}
