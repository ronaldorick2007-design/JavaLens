import com.sun.jdi.*;

import com.sun.jdi.connect.*;

import com.sun.jdi.event.*;

import com.sun.jdi.request.*;



import java.util.*;



public class Watcher {

    static int step = 0;

    static boolean steppingStarted = false;

    static EventRequestManager eventManager;

    static final List<String> snapshots = new ArrayList<>();



    static final Map<Long, ObjectReference> knownHeap = new LinkedHashMap<>();

    static final Map<String, LinkedHashSet<String>> variableOrder = new LinkedHashMap<>();

    static final Map<Long, String> pendingConstructors = new LinkedHashMap<>();

    static final Map<Long, VisualRegistration> visuals = new LinkedHashMap<>();

    static final List<EventRequest> temporarilyDisabled = new ArrayList<>();

    static int steppingSuppressionDepth = 0;

    // Latest highlight state is applied when each snapshot is serialized.

    static final Map<Long, String> objectColors = new LinkedHashMap<>();

    static final Map<Long, Map<String, String>> elementColors = new LinkedHashMap<>();



    static class VisualRegistration {

        final long targetId;

        final String name;

        final String type;

        final String component;



        VisualRegistration(long targetId, String name, String type, String component) {

this.targetId = targetId;

this.name = name;

this.type = type;

this.component = component;

        }

    }



    static String targetClass = "Main";



    public static void main(String[] args) throws Exception {

        targetClass = args.length > 0 && args[0] != null && !args[0].isBlank()

                ? args[0] : "Main";



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

                        capturePoint(e.thread());

                    } else if (method.equals("visual")) {

                        captureVisual(e.thread());

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



        // point() highlights belong only to the point() snapshot, never later steps.

        clearPointColors();

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

            if (object != null) pendingConstructors.put(object.uniqueID(), buildSnapshot(thread));

            return;

        }



        step++;

        snapshots.add(buildSnapshot(thread));

    }



    // Supports point(object, color, indices...) and point(new Object[]{...}, ...).

    static void capturePoint(ThreadReference thread) throws Exception {

        // Each point() call starts a fresh, stateless highlight set.

        clearPointColors();

StackFrame frame = thread.frame(0);

List<LocalVariable> variables;

        try {

            variables = frame.visibleVariables();

        } catch (AbsentInformationException e) {

            return;

        }



Map<LocalVariable, Value> values = frame.getValues(variables);

Value pointsValue = null, objectValue = null, colorValue = null, indicesValue = null;

        for (Map.Entry<LocalVariable, Value> entry : values.entrySet()) {

            switch (entry.getKey().name()) {

                case "points" -> pointsValue = entry.getValue();

                case "object" -> objectValue = entry.getValue();

                case "color" -> colorValue = entry.getValue();

                case "indices" -> indicesValue = entry.getValue();

            }

        }



boolean changed = false;

        if (pointsValue instanceof ArrayReference pointsArray) {

            for (Value pointValue : pointsArray.getValues()) {

                if (!(pointValue instanceof ArrayReference pair)) continue;

List<Value> parts = pair.getValues();

                if (parts.size() < 2 || !(parts.get(0) instanceof ObjectReference target)

                        || !(parts.get(1) instanceof StringReference color)) continue;

int[] indices = new int[Math.max(0, parts.size() - 2)];

int count = 0;

                for (int i = 2; i < parts.size(); i++) {

Integer parsed = readIndexValue(parts.get(i), thread);

                    if (parsed != null) indices[count++] = parsed;

                }

                if (count != indices.length) indices = Arrays.copyOf(indices, count);

                setPointColor(target, color.value(), indices);

                changed = true;

            }

        } else if (objectValue instanceof ObjectReference target

                && colorValue instanceof StringReference color) {

int[] indices = indicesValue instanceof ArrayReference array

                    ? readIntArray(array) : new int[0];

            setPointColor(target, color.value(), indices);

            changed = true;

        }



        if (changed) snapshots.add(buildSnapshot(thread));

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



    static void captureVisual(ThreadReference thread) throws Exception {

StackFrame frame = thread.frame(0);

List<LocalVariable> variables;

        try {

            variables = frame.visibleVariables();

        } catch (AbsentInformationException e) {

            return;

        }



Map<LocalVariable, Value> values = frame.getValues(variables);

ObjectReference target = null;

String type = null;

String component = null;



        for (Map.Entry<LocalVariable, Value> entry : values.entrySet()) {

String name = entry.getKey().name();

Value value = entry.getValue();

            if (name.equals("object") && value instanceof ObjectReference ref) target = ref;

            else if (name.equals("type") && value instanceof StringReference ref) type = ref.value();

            else if (name.equals("component") && value instanceof StringReference ref) component = ref.value();

        }



        if (target != null && type != null) {

String normalizedType = type.trim().toLowerCase(Locale.ROOT);

            if (component == null || component.isBlank()) {

                component = switch (normalizedType) {

                    case "linear", "tree" -> "value";

                    case "graph" -> resolveGraphComponent(target);

                    default -> null;

                };

            }

String name = resolveVisualName(target, thread);

            visuals.put(target.uniqueID(), new VisualRegistration(

                    target.uniqueID(), name, normalizedType, component));

            ensureKnown(target);

        }

    }



    static String resolveVisualName(ObjectReference target, ThreadReference thread) {

        try {

            for (StackFrame candidate : thread.frames()) {

String method = candidate.location().method().name();

                if (method.equals("visual") || method.equals("point")) continue;

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

        for (StackFrame frame : frames) {

            if (!isInfrastructureFrame(frame)) {

                collectFrameObjects(frame, knownHeap, visited);

            }

        }



Location location = null;

        for (StackFrame frame : frames) {

            if (!isInfrastructureFrame(frame)) {

                location = frame.location();

                break;

            }

        }

int line = location == null ? -1 : location.lineNumber();

StringBuilder out = new StringBuilder();

        out.append("{\"heap\":[");

boolean first = true;

        for (ObjectReference object : knownHeap.values()) {

            if (!first) out.append(',');

            first = false;

            appendHeapObject(out, object);

        }



        out.append("],\"scopes\":[");

boolean[] firstScopeVariable = {true};

        for (StackFrame frame : frames) {

            if (isInfrastructureFrame(frame)) continue;

            appendScope(out, frame, firstScopeVariable);

        }



        out.append("],\"visual\":[");

        first = true;

        for (VisualRegistration visual : visuals.values()) {

            if (!first) out.append(',');

            first = false;

            appendVisual(out, visual, thread);

        }

        out.append("],\"line\":").append(line).append('}');

String raw = out.toString();

        return raw;

    }



    static void appendVisual(StringBuilder out, VisualRegistration visual,

ThreadReference thread) throws Exception {

ObjectReference target = knownHeap.get(visual.targetId);

        out.append("{\"name\":"); appendJsonString(out, visual.name);

        out.append(",\"type\":"); appendJsonString(out, visual.type);

        out.append(",\"items\":");



        if (target == null) {

            out.append("[]}");

            return;

        }



String type = visual.type == null ? "" : visual.type.toLowerCase(Locale.ROOT);

String component = visual.component;

        if (component == null || component.isBlank()) {

            component = switch (type) {

                case "linear", "tree" -> "value";

                case "graph" -> resolveGraphComponent(target);

                default -> null;

            };

        }



        switch (type) {

            case "array" -> appendArrayVisual(out, target);

            case "matrix", "2d-array", "2darray" -> appendMatrixVisual(out, target);

            case "linear" -> appendLinearVisual(out, target,

                    component == null || component.isBlank() ? "value" : component, thread);

            case "tree" -> appendTreeVisual(out, target,

                    component == null || component.isBlank() ? "value" : component, thread);

            case "graph" -> appendGraphVisual(out, target, component, thread);

            default -> appendJsonString(out, invokeToString(target, thread));

        }

        out.append('}');

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



    static void appendArrayVisual(StringBuilder out, ObjectReference target) throws Exception {

        if (!(target instanceof ArrayReference array)) {

            appendJsonString(out, "Not a Java array");

            return;

        }

boolean matrix = false;

        for (Value value : array.getValues()) {

            if (value instanceof ArrayReference) { matrix = true; break; }

        }

        if (matrix) {

            appendMatrixRows(out, array, target.uniqueID());

            return;

        }

        out.append('[');

        for (int i = 0; i < array.length(); i++) {

            if (i > 0) out.append(',');

            out.append("{\"name\":"); appendJsonString(out, displayValue(array.getValue(i)));

            out.append(",\"color\":"); appendJsonString(out, itemColor(target.uniqueID(), Integer.toString(i)));

            out.append('}');

        }

        out.append(']');

    }



    static void appendMatrixVisual(StringBuilder out, ObjectReference target) throws Exception {

        if (!(target instanceof ArrayReference rows)) {

            appendJsonString(out, "Not a 2D array");

            return;

        }

        appendMatrixRows(out, rows, target.uniqueID());

    }



    static void appendMatrixRows(StringBuilder out, ArrayReference rows, long targetId) throws Exception {

        out.append('[');

        for (int i = 0; i < rows.length(); i++) {

            if (i > 0) out.append(',');

Value rowValue = rows.getValue(i);

            if (!(rowValue instanceof ArrayReference row)) { out.append("null"); continue; }

            out.append('[');

long rowId = row.uniqueID();

            for (int j = 0; j < row.length(); j++) {

                if (j > 0) out.append(',');

                out.append("{\"name\":"); appendJsonString(out, displayValue(row.getValue(j)));

String color = itemColor(targetId, i + "," + j);

                if ("none".equals(color)) color = itemColor(rowId, Integer.toString(j));

                out.append(",\"color\":"); appendJsonString(out, color);

                out.append('}');

            }

            out.append(']');

        }

        out.append(']');

    }



    
    // New display protocol: linear/tree structures expose a no-argument toDisplay().
    // Linear: Iterable/array of nodes.
    // Tree: Iterable/array of entries, each either {node, child} or [node, childFlags].
    static boolean hasZeroArgMethod(ObjectReference object, String methodName) {
        return object.referenceType().allMethods().stream().anyMatch(m ->
                m.name().equals(methodName) && m.argumentTypeNames().isEmpty());
    }

    static void appendLinearVisual(StringBuilder out, ObjectReference target,
            String component, ThreadReference thread) throws Exception {
        if (!hasZeroArgMethod(target, "toDisplay")) {
            appendLinearVisualLegacy(out, target, component, thread);
            return;
        }

        Value displayValue;
        disableStepping();
        try {
            displayValue = invokeZeroArg(target, "toDisplay", thread);
        } finally {
            enableStepping();
        }

        // Read array-backed display data directly; do not use Iterator methods.
        List<Value> items = readArrayOrArrayList(displayValue);
        if (items == null) {
            appendJsonString(out,
                    "toDisplay() must return an array or java.util.ArrayList");
            return;
        }

        out.append('[');
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) out.append(',');
            appendDisplayNode(out, items.get(i), component, target.uniqueID(), i);
        }
        out.append(']');
    }

    

static void appendTreeVisual(
        StringBuilder out,
        ObjectReference tree,
        String component,
        ThreadReference thread
) throws Exception {

    List<Value> slots = new ArrayList<>();

    // Prefer the tree's level-order Iterable output.
    if (isIterable(tree)) {
        disableStepping();
        try {
            Value iteratorValue = invokeZeroArg(tree, "iterator", thread);

            if (iteratorValue instanceof ObjectReference iterator) {
                while (slots.size() < 10000) {
                    Value hasNext = invokeZeroArg(iterator, "hasNext", thread);

                    if (!(hasNext instanceof BooleanValue more)
                            || !more.value()) {
                        break;
                    }

                    slots.add(invokeZeroArg(iterator, "next", thread));
                }
            }
        } finally {
            enableStepping();
        }
    }

    // Fallback: build level order from a root/left/right binary tree.
    if (slots.isEmpty()) {
        Field rootField = findField(tree.referenceType(), "root");
        ObjectReference root;

        if (rootField == null) {
            root = tree;
        } else {
            Value rootValue = tree.getValue(rootField);

            if (!(rootValue instanceof ObjectReference ref)) {
                out.append("[]");
                return;
            }

            root = ref;
        }

        List<Value> level = new ArrayList<>();
        level.add(root);

        while (!level.isEmpty()
                && slots.size() + level.size() <= 10000) {

            slots.addAll(level);

            List<Value> nextLevel = new ArrayList<>();
            boolean hasRealChild = false;

            for (Value value : level) {
                if (!(value instanceof ObjectReference node)
                        || value instanceof StringReference) {
                    nextLevel.add(null);
                    nextLevel.add(null);
                    continue;
                }

                Field leftField = findField(node.referenceType(), "left");
                Field rightField = findField(node.referenceType(), "right");

                Value left = leftField == null
                        ? null : node.getValue(leftField);

                Value right = rightField == null
                        ? null : node.getValue(rightField);

                nextLevel.add(left);
                nextLevel.add(right);

                if (left instanceof ObjectReference
                        && !(left instanceof StringReference)
                        || right instanceof ObjectReference
                        && !(right instanceof StringReference)) {
                    hasRealChild = true;
                }
            }

            if (!hasRealChild) break;

            level = nextLevel;
        }
    }

    // Serialize nodes and null slots.
    out.append('[');

    for (int i = 0; i < slots.size(); i++) {
        if (i > 0) out.append(',');

        Value value = slots.get(i);

        if (!(value instanceof ObjectReference node)
                || value instanceof StringReference) {
            out.append("null");
            continue;
        }

        Field selectedField = findField(node.referenceType(), component);

        Value selected = selectedField == null || selectedField.isStatic()
                ? null
                : node.getValue(selectedField);

        out.append("{\"name\":");
        appendJsonString(out, displayValue(selected));

        out.append(",\"color\":");
        appendJsonString(
                out,
                objectColors.getOrDefault(node.uniqueID(), "none")
        );

        out.append('}');
    }

    out.append(']');
}

    static void appendDisplayNode(StringBuilder out, Value item, String component,
            long containerId, int index) throws Exception {
        Value label = item;
        ObjectReference node = null;

        if (item instanceof ObjectReference ref && !(item instanceof StringReference)) {
            node = ref;
            Field field = findField(ref.referenceType(), component);
            if (field != null && !field.isStatic()) label = ref.getValue(field);
        }

        out.append("{\"name\":");
        appendJsonString(out, displayValue(label));
        out.append(",\"color\":");
        String color = itemColor(containerId, Integer.toString(index));
        if ("none".equals(color) && node != null) {
            color = objectColors.getOrDefault(node.uniqueID(), "none");
        }
        appendJsonString(out, color);
        out.append('}');
    }

    static void appendChildFlagsValue(StringBuilder out, Value flags,
            ThreadReference thread) throws Exception {
        List<Value> values = readSequence(flags, thread);
        out.append('[');
        if (values != null) {
            for (int i = 0; i < values.size(); i++) {
                if (i > 0) out.append(',');
                Value flag = values.get(i);
                boolean present = false;
                if (flag instanceof IntegerValue integer) present = integer.value() != 0;
                else if (flag instanceof BooleanValue bool) present = bool.value();
                else if (flag instanceof ObjectReference ref
                        && ref.referenceType().name().equals("java.lang.Integer")) {
                    try {
                        Value unboxed = invokeZeroArg(ref, "intValue", thread);
                        if (unboxed instanceof IntegerValue integer) present = integer.value() != 0;
                    } catch (Exception ignored) { }
                }
                out.append(present ? '1' : '0');
            }
        }
        out.append(']');
    }

static void appendLinearVisualLegacy(StringBuilder out, ObjectReference target,

String component, ThreadReference thread) throws Exception {

Value iterable = selectedField(target, component);

ObjectReference source = target;

        if (iterable instanceof ArrayReference arrayValue) {

            // Array-backed collection field.

            out.append('[');

            for (int i = 0; i < arrayValue.length(); i++) {

                if (i > 0) out.append(',');

                appendSelectedItem(out, arrayValue.getValue(i), component, target.uniqueID(), i);

            }

            out.append(']');

            return;

        }

        if (iterable instanceof ObjectReference ref && !(ref instanceof StringReference)

                && isIterable(ref)) source = ref;

        if (source instanceof ArrayReference array) {

            out.append('[');

            for (int i = 0; i < array.length(); i++) {

                if (i > 0) out.append(',');

                appendSelectedItem(out, array.getValue(i), component, target.uniqueID(), i);

            }

            out.append(']');

            return;

        }



        // A singly linked list may be represented by its head node rather than

        // an Iterable wrapper. Walk \`next\` references directly for that case.

        if (findField(source.referenceType(), "next") != null

                && !isIterable(source)) {

            appendLinkedChain(out, source, component, target.uniqueID());

            return;

        }
        appendJsonString(out,
                "Linear visual requires an array-backed field, a linked chain, or toDisplay() returning an array/ArrayList");

    }




        static void appendLinkedChain(StringBuilder out, ObjectReference head,

String component, long containerId) throws Exception {

        out.append('[');

Set<Long> seen = new HashSet<>();

ObjectReference current = head;

boolean first = true;

int index = 0;

        while (current != null && index < 10000 && seen.add(current.uniqueID())) {

            if (!first) out.append(',');

            first = false;

            appendSelectedItem(out, current, component, containerId, index++);

Field nextField = findField(current.referenceType(), "next");

            if (nextField == null || nextField.isStatic()) break;

Value next = current.getValue(nextField);

            current = next instanceof ObjectReference ref && !(next instanceof StringReference)

                    ? ref : null;

        }

        out.append(']');

    }



    static void appendSelectedItem(StringBuilder out, Value item, String component,

long containerId, int index) throws Exception {

Value selected = item;

        if (item instanceof ObjectReference ref && !(item instanceof StringReference)) {

Field field = findField(ref.referenceType(), component);

            if (field != null && !field.isStatic()) selected = ref.getValue(field);

        }

        out.append('{');

        out.append("\"name\":");

        appendJsonString(out, displayValue(selected));

        out.append(",\"color\":");

String color = itemColor(containerId, Integer.toString(index));

        if ("none".equals(color) && item instanceof ObjectReference ref) {

            color = objectColors.getOrDefault(ref.uniqueID(), "none");

        }

        appendJsonString(out, color);

        out.append('}');

    }



    static void appendTreeVisualLegacy(StringBuilder out, ObjectReference tree,

String component, ThreadReference thread) throws Exception {

List<ObjectReference> nodes = new ArrayList<>();



        // The visual protocol relies on the user's level-order iterator. Each node

        // carries child-presence flags; the frontend pairs flags with subsequent

        // real nodes in the same breadth-first order. Nulls are never emitted as nodes.

        if (isIterable(tree)) {

            disableStepping();

            try {

Value iteratorValue = invokeZeroArg(tree, "iterator", thread);

                if (iteratorValue instanceof ObjectReference iterator) {

Set<Long> seen = new HashSet<>();

                    while (nodes.size() < 10000) {

Value hasNext = invokeZeroArg(iterator, "hasNext", thread);

                        if (!(hasNext instanceof BooleanValue more) || !more.value()) break;

Value next = invokeZeroArg(iterator, "next", thread);

                        if (next instanceof ObjectReference node && !(next instanceof StringReference)

                                && seen.add(node.uniqueID())) nodes.add(node);

                    }

                }

            } finally {

                enableStepping();

            }

        }



        // Compatibility fallback: breadth-first traversal of a root/left/right tree.

        if (nodes.isEmpty()) {

Field rootField = findField(tree.referenceType(), "root");

ObjectReference root;

            if (rootField == null) {

                if (findField(tree.referenceType(), "left") == null

                        && findField(tree.referenceType(), "right") == null) {

                    out.append("[]");

                    return;

                }

                root = tree;

            } else {

Value rootValue = tree.getValue(rootField);

                if (!(rootValue instanceof ObjectReference rootRef)) { out.append("[]"); return; }

                root = rootRef;

            }

            collectTreeNodes(root, nodes, new HashSet<>());

        }



        out.append('[');

        for (int i = 0; i < nodes.size(); i++) {

            if (i > 0) out.append(',');

ObjectReference node = nodes.get(i);

Field selectedField = findField(node.referenceType(), component);

Value selected = selectedField == null || selectedField.isStatic() ? null : node.getValue(selectedField);



            out.append("{\"name\":"); appendJsonString(out, displayValue(selected));

            out.append(",\"color\":"); appendJsonString(out, objectColors.getOrDefault(node.uniqueID(), "none"));

            out.append(",\"child\":"); appendTreeChildFlags(out, node, component, thread);

            out.append('}');

        }

        out.append(']');

    }



    static void appendTreeChildFlags(

StringBuilder out,

ObjectReference node,

String component,

ThreadReference thread

) throws Exception {



ReferenceType nodeType = node.referenceType();

List<Value> slots = new ArrayList<>();



    // 1. Prefer an explicit children collection for n-ary trees.

Field childrenField = null;



    for (String candidate :

            new String[]{"children", "childNodes", "childs"}) {



Field field = findField(nodeType, candidate);



        if (field != null && !field.isStatic()) {

            childrenField = field;

            break;

        }

    }



    if (childrenField != null) {

Value children = node.getValue(childrenField);



        if (children instanceof ArrayReference array) {

            slots.addAll(array.getValues());



        } else if (children instanceof ObjectReference ref

                && isIterable(ref)) {



Value iteratorValue =

                    invokeZeroArg(ref, "iterator", thread);



            if (iteratorValue instanceof ObjectReference iterator) {

                while (slots.size() < 1000) {

Value more = invokeZeroArg(

                            iterator, "hasNext", thread);



                    if (!(more instanceof BooleanValue b)

                            || !b.value()) {

                        break;

                    }



                    slots.add(invokeZeroArg(iterator, "next", thread));

                }

            }

        }



    } else {

        // 2. Otherwise infer child slots from node-reference fields.

        // Field declaration order defines slot order.

        for (Field field : nodeType.allFields()) {



            if (field.isStatic()) continue;

            if (field.name().equals(component)) continue;



String name = field.name().toLowerCase(Locale.ROOT);



            if (name.equals("parent")

                    || name.equals("prev")

                    || name.equals("next")) {

                continue;

            }



            if (field.typeName().equals(nodeType.name())) {

                slots.add(node.getValue(field));

            }

        }

    }



    // 3. Emit one flag per child slot.

    out.append('[');



    for (int i = 0; i < slots.size(); i++) {

        if (i > 0) out.append(',');



Value child = slots.get(i);



        out.append(

                child instanceof ObjectReference

                        && !(child instanceof StringReference)

                        ? '1'

                        : '0'

        );

    }



    out.append(']');

}

    static void collectTreeNodes(ObjectReference root, List<ObjectReference> nodes,

Set<Long> visited) throws Exception {

ArrayDeque<ObjectReference> queue = new ArrayDeque<>();

        queue.add(root);

        while (!queue.isEmpty() && nodes.size() < 10000) {

ObjectReference node = queue.remove();

            if (!visited.add(node.uniqueID())) continue;

            nodes.add(node);

Field leftField = findField(node.referenceType(), "left");

Field rightField = findField(node.referenceType(), "right");

Value left = leftField == null ? null : node.getValue(leftField);

Value right = rightField == null ? null : node.getValue(rightField);

            if (left instanceof ObjectReference ref) queue.add(ref);

            if (right instanceof ObjectReference ref) queue.add(ref);

        }

    }



    // Graph accepts either a graph wrapper (with adjList/adjacencyList/etc.) or

    // the adjacency-list array/Iterable itself. For visual(adjList, "graph", "data"),

    // component is the label field read from object vertices; toString is the fallback.

    static void appendGraphVisual(StringBuilder out, ObjectReference target,

String component, ThreadReference thread) throws Exception {

Value source = target;

String labelField = null;

boolean directContainer = target instanceof ArrayReference || isIterable(target);



        if (directContainer) {

            labelField = component;

        } else {

Field named = findField(target.referenceType(), component);

            if (component != null && named != null && !named.isStatic()) {

                source = target.getValue(named);

            } else {

                labelField = component;

String adjacencyField = resolveGraphComponent(target);

Field field = findField(target.referenceType(), adjacencyField);

                if (field == null || field.isStatic()) {

                    appendJsonString(out, "Adjacency list not found; pass an adjacency list or a field such as adjList");

                    return;

                }

                source = target.getValue(field);

            }

        }



List<Value> rows = readSequence(source, thread);

        if (rows == null) {

            appendJsonString(out, "Graph expects an array or Iterable adjacency list");

            return;

        }



        // Collect row objects and labels first. Rows may be neighbor lists (classic

        // adjacency list) or vertex objects with their own neighbors/edges field.

List<Value> rowValues = rows;

List<String> labels = new ArrayList<>();

Map<Long, Integer> identityToIndex = new HashMap<>();

Map<String, Integer> labelToIndex = new HashMap<>();

        for (int i = 0; i < rowValues.size(); i++) {

Value row = rowValues.get(i);

            if (row instanceof ObjectReference ref && !(row instanceof StringReference)) {

                identityToIndex.put(ref.uniqueID(), i);

boolean isNeighborContainer = row instanceof ArrayReference || isIterable(ref);

Value label = isNeighborContainer ? null : selectedGraphLabel(ref, labelField, thread);

String text = label == null

                        ? (isNeighborContainer ? Integer.toString(i) : graphIdentityLabel(ref))

                        : graphLabelText(label);

                if (text == null || text.equals("null")) text = Integer.toString(i);

                labels.add(text);

                labelToIndex.put(text, i);

            } else {

                labels.add(Integer.toString(i));

                labelToIndex.put(Integer.toString(i), i);

            }

        }



        // Discover labels on neighbor objects too; this permits Node.data values to

        // identify vertices even when the outer list consists of lists of neighbors.

        for (Value row : rowValues) {

List<Value> neighbors = graphNeighbors(row, labelField, thread);

            if (neighbors == null) continue;

            for (Value neighbor : neighbors) {

                if (!(neighbor instanceof ObjectReference ref) || neighbor instanceof StringReference) continue;

Value labelValue = selectedGraphLabel(ref, labelField, thread);

String label = labelValue == null ? graphIdentityLabel(ref) : graphLabelText(labelValue);

                if (label != null && !label.equals("null")) {

int parsed = parseVertexIndex(label, -1);

                    if (parsed >= 0 && parsed < rowValues.size()) labelToIndex.putIfAbsent(label, parsed);

                }

                // When no explicit label field is supplied, display JDI identity labels;

                // a conventional \`data\` field may still help resolve non-identity references.

                if (labelField == null || labelField.isBlank()) {

Field dataField = findField(ref.referenceType(), "data");

                    if (dataField != null && !dataField.isStatic()) {

String dataKey = graphLabelText(ref.getValue(dataField));

int id = parseVertexIndex(dataKey, -1);

                        if (id >= 0 && id < rowValues.size()) {

                            labelToIndex.putIfAbsent(dataKey, id);

                            if (rowValues.get(id) instanceof ObjectReference rowObject

                                    && !(rowObject instanceof StringReference)

                                    && !(rowObject instanceof ArrayReference) && !isIterable(rowObject)) {

Value rowLabel = selectedGraphLabel(rowObject, null, thread);

                                labels.set(id, rowLabel == null ? graphIdentityLabel(rowObject) : graphLabelText(rowLabel));

                            } else if (id < labels.size() && labels.get(id).equals(Integer.toString(id))) {

Value refLabel = selectedGraphLabel(ref, null, thread);

                                labels.set(id, refLabel == null ? graphIdentityLabel(ref) : graphLabelText(refLabel));

                            }

                        }

                    }

                }

            }

        }



        out.append('[');

        for (int i = 0; i < rowValues.size(); i++) {

            if (i > 0) out.append(',');

Value row = rowValues.get(i);

            out.append("{\"name\":"); appendJsonString(out, labels.get(i));

            out.append(",\"neighbors\":[");

List<Value> neighbors = graphNeighbors(row, labelField, thread);

boolean first = true;

            if (neighbors != null) {

                for (Value neighbor : neighbors) {

Integer to = resolveGraphNeighbor(neighbor, labelField, identityToIndex,

                            labelToIndex, rowValues.size(), thread);

                    if (to == null || to < 0 || to >= rowValues.size()) continue;

                    if (!first) out.append(',');

                    first = false;

                    out.append(to);

                }

            }

            out.append("],\"color\":");

String color = itemColor(target.uniqueID(), Integer.toString(i));

            if ("none".equals(color) && row instanceof ObjectReference ref)

                color = objectColors.getOrDefault(ref.uniqueID(), "none");

            if ("none".equals(color))

                color = findGraphVertexColor(rowValues, i, labelField, thread);

            appendJsonString(out, color);

            out.append('}');

        }

        out.append(']');

    }



    static String findGraphVertexColor(List<Value> rows, int vertexIndex,

String labelField, ThreadReference thread) throws Exception {

        for (Value row : rows) {

List<Value> neighbors = graphNeighbors(row, labelField, thread);

            if (neighbors == null) continue;

            for (Value neighbor : neighbors) {

                if (!(neighbor instanceof ObjectReference ref) || neighbor instanceof StringReference) continue;

Value label = selectedGraphLabel(ref, labelField, thread);

String key = label == null ? graphIdentityLabel(ref) : graphLabelText(label);

                if (labelField == null || labelField.isBlank()) {

Field dataField = findField(ref.referenceType(), "data");

                    if (dataField != null && !dataField.isStatic()) key = graphLabelText(ref.getValue(dataField));

                }

                if (parseVertexIndex(key, -1) == vertexIndex) {

String color = objectColors.getOrDefault(ref.uniqueID(), "none");

                    if (!"none".equals(color)) return color;

                }

            }

        }

        return "none";

    }



    // Reads arrays and ArrayList backing storage directly, without Iterator calls.
    static List<Value> readArrayOrArrayList(Value value) throws Exception {
        if (value instanceof ArrayReference array) return array.getValues();
        if (!(value instanceof ObjectReference ref) || value instanceof StringReference) return null;
        if (!ref.referenceType().name().equals("java.util.ArrayList")) return null;

        Field sizeField = findField(ref.referenceType(), "size");
        Field dataField = findField(ref.referenceType(), "elementData");
        if (sizeField == null || dataField == null) return null;

        Value sizeValue = ref.getValue(sizeField);
        Value dataValue = ref.getValue(dataField);
        if (!(sizeValue instanceof IntegerValue size)
                || !(dataValue instanceof ArrayReference data)) return null;

        int count = Math.max(0, Math.min(size.value(), data.length()));
        List<Value> result = new ArrayList<>(count);
        for (int i = 0; i < count; i++) result.add(data.getValue(i));
        return result;
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



    static Value selectedGraphLabel(ObjectReference node, String labelField,

ThreadReference thread) throws Exception {

        // An explicitly supplied third argument is the label field (e.g. "data").

        if (labelField != null && !labelField.isBlank()) {

Field field = findField(node.referenceType(), labelField);

            if (field != null && !field.isStatic()) return node.getValue(field);

        }



        // Default labels use the JDI unique object ID, not the object's toString().

        // This gives stable identity labels within this VM run, e.g. Node\@67.

        return null;

    }



    static String graphIdentityLabel(ObjectReference node) {

String typeName = node.referenceType().name();

int dot = typeName.lastIndexOf('.');

        if (dot >= 0) typeName = typeName.substring(dot + 1);

int dollar = typeName.lastIndexOf('$');

        if (dollar >= 0) typeName = typeName.substring(dollar + 1);

        return typeName + "@" + node.uniqueID();

    }



    static List<Value> graphNeighbors(Value row, String labelField,

ThreadReference thread) throws Exception {

        if (row instanceof ArrayReference || (row instanceof ObjectReference ref

                && (ref.referenceType().name().equals("java.util.ArrayList") || isIterable(ref))))

            return readSequence(row, thread);

        if (row instanceof ObjectReference ref && !(row instanceof StringReference)) {

            for (String name : new String[]{"neighbors", "adjList", "adjacencyList", "adjacency", "adj", "edges"}) {

Field field = findField(ref.referenceType(), name);

                if (field == null || field.isStatic()) continue;

List<Value> values = readSequence(ref.getValue(field), thread);

                if (values != null) return values;

            }

        }

        return null;

    }



    static Integer resolveGraphNeighbor(Value neighbor, String labelField,

Map<Long, Integer> identityToIndex,

Map<String, Integer> labelToIndex, int size,

ThreadReference thread) throws Exception {

        if (neighbor instanceof ByteValue v) return (int) v.value();

        if (neighbor instanceof ShortValue v) return (int) v.value();

        if (neighbor instanceof IntegerValue v) return v.value();

        if (neighbor instanceof LongValue v) return (int) v.value();

        if (neighbor instanceof ObjectReference ref && !(neighbor instanceof StringReference)) {

Integer identity = identityToIndex.get(ref.uniqueID());

            if (identity != null) return identity;

Value label = selectedGraphLabel(ref, labelField, thread);

String text = label == null ? graphIdentityLabel(ref) : graphLabelText(label);

Integer byLabel = labelToIndex.get(text);

            if (byLabel != null && byLabel >= 0) return byLabel;

int parsed = parseVertexIndex(text, -1);

            if (parsed >= 0 && parsed < size) return parsed;

            if (labelField == null || labelField.isBlank()) {

Field dataField = findField(ref.referenceType(), "data");

                if (dataField != null && !dataField.isStatic()) {

String data = graphLabelText(ref.getValue(dataField));

Integer dataIndex = labelToIndex.get(data);

                    if (dataIndex != null && dataIndex >= 0) return dataIndex;

int dataParsed = parseVertexIndex(data, -1);

                    if (dataParsed >= 0 && dataParsed < size) return dataParsed;

                }

            }

        }

        return null;

    }



    static String graphLabelText(Value value) {

        if (value == null) return "null";

        if (value instanceof StringReference string) return string.value();

        return displayValue(value);

    }



    static int parseVertexIndex(String value, int fallback) {

        try { return Integer.parseInt(value); } catch (Exception ignored) { return fallback; }

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

            // A zero-argument iterator() is a safe practical fallback for the visualizer.

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

        return method.equals("point") || method.equals("visual") || isIteratorSupportFrame(frame);

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



    static void appendScope(StringBuilder out, StackFrame frame, boolean[] firstEntry) throws Exception {

ObjectReference thisObject = frame.thisObject();

String scopeName = thisObject != null

                ? thisObject.referenceType().name() + "@" + thisObject.uniqueID()

                    + "." + frame.location().method().name() + "()"

                : frame.location().declaringType().name() + "." + frame.location().method().name() + "()";

List<LocalVariable> variables;

        try { variables = frame.visibleVariables(); }

        catch (AbsentInformationException e) { return; }

Map<LocalVariable, Value> values = frame.getValues(variables);

Map<String, LocalVariable> currentVariables = new LinkedHashMap<>();

Map<String, Value> currentValues = new HashMap<>();

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

        for (String name : order) {

LocalVariable variable = currentVariables.get(name);

            if (variable == null) continue;

            if (!firstEntry[0]) out.append(',');

            firstEntry[0] = false;

            appendVariable(out, scopeName, variable, currentValues.get(name));

        }

    }



    static void appendVariable(StringBuilder out, String scopeName,

LocalVariable variable, Value value) throws Exception {

        out.append("{\"scope\":"); appendJsonString(out, scopeName);

        out.append(",\"name\":"); appendJsonString(out, variable.name());

        out.append(",\"type\":"); appendJsonString(out, variable.typeName());

        out.append(",\"value\":");

        if (value instanceof ArrayReference array) appendJsonString(out, array.referenceType().name() + "@" + array.uniqueID());

        else appendJsonValue(out, value);

String color = value instanceof ObjectReference ref

                ? objectColors.getOrDefault(ref.uniqueID(), "none") : "none";

        out.append(",\"color\":"); appendJsonString(out, color);

        out.append('}');

    }



    static void appendHeapObject(StringBuilder out, ObjectReference object) throws Exception {

        out.append("{\"id\":"); appendJsonString(out, object.referenceType().name() + "@" + object.uniqueID());

        out.append(",\"class\":"); appendJsonString(out, object.referenceType().name());

        out.append(",\"color\":");

        appendJsonString(out, objectColors.getOrDefault(object.uniqueID(), "none"));

        out.append(",\"fields\":[");

boolean first = true;

        if (object instanceof ArrayReference array) {

            for (int i = 0; i < array.length(); i++) {

                if (!first) out.append(','); first = false;

                appendJsonString(out, "[" + i + "]: " + displayValue(array.getValue(i)));

            }

        } else {

            for (Field field : object.referenceType().allFields()) {

                if (field.isStatic()) continue;

Value value = object.getValue(field);

                if (value instanceof ObjectReference iteratorRef && isIteratorObject(iteratorRef)) continue;

                if (value instanceof ObjectReference ref && isJdkObject(ref)) {

                    if (ref instanceof StringReference string) {

                        if (!first) out.append(','); first = false;

                        appendJsonString(out, field.name() + ": " + string.value());

                    }

                    continue;

                }

                if (!first) out.append(','); first = false;

                appendJsonString(out, field.name() + ": " + displayValue(value));

            }

        }

        out.append("]}");

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

VirtualMachineManager manager = Bootstrap.virtualMachineManager();

LaunchingConnector connector = manager.defaultConnector();

Map<String, Connector.Argument> arguments = connector.defaultArguments();

        arguments.get("main").setValue(mainClass);

        return connector.launch(arguments);

    }

}
