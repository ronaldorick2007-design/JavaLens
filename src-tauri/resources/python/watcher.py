import sys
import json
import os
import types
USER_FILE = os.path.abspath("main.py")
OUTPUT_FILE = "snapshots.json"
known_heap = {}
object_ids = {}
object_counter = 0
snapshots = []
pending_lines = {}
pending_indications = {}
# Snapshot-scoped annotations: (object identity, index path) -> color.
point_registry = {}

def is_user_frame(frame):
    return os.path.abspath( frame.f_code.co_filename ) == USER_FILE

def is_class_body(frame):
    locals_ = frame.f_locals
    return ( "__module__" in locals_ and "__qualname__" in locals_ and locals_.get("__qualname__") == frame.f_code.co_name )

def is_point_frame(frame):
    return frame.f_code.co_name == "point"

def is_visual_frame(frame):
    return frame.f_code.co_name == "visual"

def is_user_class(value):
    return ( isinstance(value, type) and getattr(value, "__module__", None) == "__main__" )

def is_user_function(value):
    return (
        isinstance(value, types.FunctionType)
        and getattr(value, "__module__", None) == "__main__"
    )

def is_primitive(value):
    return ( isinstance( value, ( int, float, bool, str, bytes, complex, ), ) or value is None )

def is_python_internal(value):
    return isinstance( value, ( types.FunctionType, types.BuiltinFunctionType, types.MethodType, types.BuiltinMethodType, types.CodeType, types.ModuleType, types.CellType, types.GetSetDescriptorType, types.MemberDescriptorType, types.WrapperDescriptorType, type, ), )

def is_user_object(value):
    if value is None:
        return False
    if is_primitive(value):
        return False
    if is_user_class(value):
        return True
    if is_user_function(value):
        return True
    if is_python_internal(value):
        return False
    if isinstance( value, ( list, tuple, dict, set, frozenset, ), ):
        return True
    if callable(value):
        return False
    return hasattr(value, "__dict__")

def get_object_id(obj):
    global object_counter
    key = id(obj)
    if key not in object_ids:
        known_heap[key] = obj
        if is_user_class(obj):
            object_ids[key] = None
            return f"{obj.__name__}@class"
        object_counter += 1
        object_ids[key] = object_counter
    if is_user_class(obj):
        return f"{obj.__name__}@class"
    if is_user_function(obj):
        return f"function@{object_ids[key]}"
    return f"{type(obj).__name__}@{object_ids[key]}"

def get_type_name(value):
    if value is None:
        return "NoneType"
    return type(value).__name__

def display_value(value):
    if value is None:
        return None
    if is_primitive(value):
        return value
    if is_user_function(value):
        return get_object_id(value)
    if is_user_object(value):
        return get_object_id(value)
    if isinstance(value, list):
        return [ display_value(x) for x in value ]
    if isinstance(value, tuple):
        return [ display_value(x) for x in value ]
    if isinstance(value, dict):
        return { str(k): display_value(v) for k, v in value.items() }
    if isinstance(value, set):
        return [ display_value(x) for x in value ]
    if isinstance(value, frozenset):
        return [ display_value(x) for x in value ]
    return str(value)

def format_heap_value(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return str(value)
    if is_user_function(value):
        return get_object_id(value)
    if is_user_object(value):
        return get_object_id(value)
    return str(value)

def discover_object(value, seen=None):
    if seen is None:
        seen = set()
    if is_primitive(value):
        return
    if is_python_internal(value) and not is_user_class(value) and not is_user_function(value):
        return
    key = id(value)
    if key in seen:
        return
    seen.add(key)
    if not is_user_object(value):
        return
    get_object_id(value)
    if is_user_function(value):
        return
    if is_user_class(value):
        for name, member in vars(value).items():
            if name.startswith("__") and name not in ("__init__", "__iter__", "__repr__", "__str__", "__len__", "__getitem__"):
                continue
            if is_user_function(member):
                discover_object(member, seen)
        return
    if isinstance(value, list):
        for item in value:
            discover_object(item, seen)
        return
    if isinstance(value, tuple):
        for item in value:
            discover_object(item, seen)
        return
    if isinstance(value, (set, frozenset)):
        for item in value:
            discover_object(item, seen)
        return
    if isinstance(value, dict):
        for key_, item in value.items():
            discover_object( key_, seen, )
            discover_object( item, seen, )
        return
    try:
        for item in vars(value).values():
            discover_object(item, seen)
    except ( TypeError, AttributeError, ):
        pass

def discover_from_frame(frame):
    current = frame
    while current is not None:
        if ( is_user_frame(current) and not is_class_body(current) ):
            for name, value in current.f_locals.items():
                if name.startswith("__"):
                    continue
                if name in ( "point", "visual", ):
                    continue
                discover_object(value)
        current = current.f_back

def get_heap_class(obj):
    if is_user_function(obj):
        return "function"
    if is_user_class(obj):
        return "class"
    if isinstance(obj, list):
        return "list[]"
    if isinstance(obj, tuple):
        return "tuple[]"
    if isinstance(obj, dict):
        return "dict{}"
    if isinstance(obj, (set, frozenset)):
        return "set{}"
    return type(obj).__name__


def point_color(obj, indices=()):
    return point_registry.get((id(obj), tuple(indices)), "None")


def make_attribute(name, value, depth=0, owner_id=None, path=()):
    # Object identity colors references; container identity + index colors slots.
    color = point_color(value)
    if owner_id is not None:
        color = point_registry.get((owner_id, tuple(path)), color)
    attribute = {
        "n": str(name),
        "t": get_type_name(value),
        "c": color,
    }
    if isinstance(value, (list, tuple)):
        dimensions = array_dimensions(value)
        if dimensions > 2:
            attribute["a"] = [{"n": "More than 2 dimensions", "t": "warning", "c": "orange"}]
        elif depth < 2:
            root_id = owner_id if owner_id is not None else id(value)
            base_path = tuple(path) if owner_id is not None else ()
            attribute["a"] = [
                make_attribute("", item, depth + 1, root_id, base_path + (index,))
                for index, item in enumerate(value)
            ]
        else:
            attribute["value"] = display_value(value)
    else:
        attribute["value"] = display_value(value)
    return attribute

def array_dimensions(value):
    if not isinstance(value, (list, tuple)) or not value:
        return 1
    return 1 + max((array_dimensions(item) for item in value if isinstance(item, (list, tuple))), default=0)


def build_heap():
    heap = []
    processed = set()
    # The list may grow while class methods/functions are discovered.
    while True:
        pending = [obj for key, obj in known_heap.items() if key not in processed]
        if not pending:
            break
        for obj in pending:
            processed.add(id(obj))
            if not is_user_object(obj):
                continue

            attributes = []
            if is_user_function(obj):
                attributes.append(make_attribute("name", obj.__name__))
                attributes.append(make_attribute("qualname", obj.__qualname__))
            elif is_user_class(obj):
                attributes.append(make_attribute("__name__", obj.__name__))
                for name, value in vars(obj).items():
                    if name in (
                        "__module__", "__qualname__", "__dict__", "__weakref__",
                        "__doc__", "__annotations__",
                    ):
                        continue
                    if name.startswith("__") and name not in (
                        "__init__", "__iter__", "__repr__", "__str__", "__len__", "__getitem__",
                    ):
                        continue
                    if is_user_function(value):
                        discover_object(value)
                        attributes.append(make_attribute(name, value))
                    elif not callable(value):
                        discover_object(value)
                        attributes.append(make_attribute(name, value))
            elif isinstance(obj, (list, tuple)):
                for index, value in enumerate(obj):
                    discover_object(value)
                    attributes.append(make_attribute(f"[{index}]", value, owner_id=id(obj), path=(index,)))
            elif isinstance(obj, (set, frozenset)):
                for index, value in enumerate(obj):
                    discover_object(value)
                    attributes.append(make_attribute(f"[{index}]", value, owner_id=id(obj), path=(index,)))
            elif isinstance(obj, dict):
                for key, value in obj.items():
                    discover_object(key)
                    discover_object(value)
                    attributes.append(make_attribute(str(key), value))
            else:
                try:
                    for name, value in vars(obj).items():
                        if name.startswith("__"):
                            continue
                        discover_object(value)
                        attributes.append(make_attribute(name, value))

                    # Class methods are shared by instances; expose references
                    # without duplicating the function objects.
                    cls = type(obj)
                    if is_user_class(cls):
                        for name, value in vars(cls).items():
                            if is_user_function(value):
                                discover_object(value)
                                attributes.append(make_attribute(name, value))
                except (TypeError, AttributeError):
                    pass

            heap.append({
                "n": get_object_id(obj),
                "t": get_heap_class(obj),
                "c": point_color(obj),
                "a": attributes,
            })
    return heap

def frame_name(frame):
    name = frame.f_code.co_name
    if name == "<module>":
        return "<module>()"
    if name == "__init__":
        self_obj = frame.f_locals.get("self")
        if ( self_obj is not None and is_user_object(self_obj) ):
            base_name = ( f"{get_object_id(self_obj)}.__init__()" )
        else:
            base_name = "__init__()"
    else:
        self_obj = frame.f_locals.get("self")
        if ( self_obj is not None and is_user_object(self_obj) ):
            base_name = ( f"{get_object_id(self_obj)}.{name}()" )
        else:
            base_name = f"{name}()"
    previous = frame.f_back
    if previous is not None:
        if previous.f_code.co_name == name:
            return f"{base_name}@{id(frame)}"
    return base_name

def scope_base_name(frame):
    name = frame.f_code.co_name
    if name == "<module>":
        return "main"
    self_obj = frame.f_locals.get("self")
    if self_obj is not None and is_user_object(self_obj):
        return f"{type(self_obj).__name__}.{name}"
    return name


def build_stack(current_frame):
    scopes = {}
    name_counts = {}
    frame = current_frame
    while frame is not None:
        if (
            not is_user_frame(frame)
            or is_class_body(frame)
            or is_point_frame(frame)
            or is_visual_frame(frame)
        ):
            frame = frame.f_back
            continue

        base_name = scope_base_name(frame)
        name_counts[base_name] = name_counts.get(base_name, 0) + 1
        occurrence = name_counts[base_name]
        scope_name = base_name if occurrence == 1 else f"{base_name}#{occurrence - 1}"

        variables = []
        for name, value in frame.f_locals.items():
            if name.startswith("__") or name in ("point", "visual"):
                continue
            if callable(value) and not is_user_class(value):
                continue
            if isinstance(value, type) and not is_user_class(value):
                continue
            variables.append({
                "n": name,
                "t": get_type_name(value),
                "c": point_color(value),
                "value": display_value(value),
            })
        scopes[scope_name] = variables
        frame = frame.f_back
    return scopes

def _graph_references(value, relationship, output, seen_containers=None):
    """Collect direct object references; nested containers retain a readable path."""
    if seen_containers is None:
        seen_containers = set()

    if is_user_object(value):
        output.append({"n": get_object_id(value), "r": str(relationship)})
        return

    if isinstance(value, (list, tuple)):
        key = id(value)
        if key in seen_containers:
            return
        seen_containers.add(key)
        for index, item in enumerate(value):
            _graph_references(item, f"{relationship}[{index}]", output, seen_containers)
    elif isinstance(value, dict):
        key = id(value)
        if key in seen_containers:
            return
        seen_containers.add(key)
        for item_key, item in value.items():
            _graph_references(item_key, f"{relationship}.key", output, seen_containers)
            _graph_references(item, f"{relationship}[{item_key}]", output, seen_containers)
    elif isinstance(value, (set, frozenset)):
        key = id(value)
        if key in seen_containers:
            return
        seen_containers.add(key)
        for index, item in enumerate(value):
            _graph_references(item, f"{relationship}[{index}]", output, seen_containers)


def build_visual_graph():
    nodes = []
    for obj in list(known_heap.values()):
        if not is_user_object(obj):
            continue

        edges = []
        if isinstance(obj, (list, tuple)):
            for index, value in enumerate(obj):
                _graph_references(value, f"[{index}]", edges)
        elif isinstance(obj, dict):
            for key, value in obj.items():
                _graph_references(key, "key", edges)
                _graph_references(value, f"[{key}]", edges)
        elif isinstance(obj, (set, frozenset)):
            for index, value in enumerate(obj):
                _graph_references(value, f"[{index}]", edges)
        elif is_user_class(obj):
            for name, value in vars(obj).items():
                if not name.startswith("__") and not callable(value):
                    _graph_references(value, name, edges)
        elif not is_user_function(obj):
            try:
                for name, value in vars(obj).items():
                    if not name.startswith("__"):
                        _graph_references(value, name, edges)
            except (TypeError, AttributeError):
                pass

        node_id = get_object_id(obj)
        node = {"n": node_id, "c": point_color(obj), "e": edges}
        for edge in node["e"]:
            # Graph edge labels for sequence slots are [i] or [i][j].
            label = edge.get("r", "")
            if label.startswith("[") and label.endswith("]"):
                try:
                    indices = tuple(int(part) for part in label.strip("[]").replace("][", ",").split(","))
                    color = point_registry.get((id(obj), indices))
                    if color is not None:
                        edge["c"] = color
                except ValueError:
                    pass
        nodes.append(node)
    return nodes


def emit_visual(frame):
    snapshots.append( build_snapshot( frame, frame.f_lineno, None, ) )

def capture_point(frame):
    obj = frame.f_locals.get("object")
    color = frame.f_locals.get("color")
    indices = frame.f_locals.get("indices", ())
    args = frame.f_locals.get("args", ())
    if args:
        color = args[-1]
        indices = args[:-1]
    if obj is None or color is None or not is_user_object(obj):
        return None
    if not isinstance(color, str):
        return None
    parsed = tuple(int(index) for index in indices)
    point_registry[(id(obj), parsed)] = color
    return {"object": get_object_id(obj), "color": color, "indices": list(parsed)}

def build_snapshot(frame, line, indication=None):
    try:
        discover_from_frame(frame)
        # Resolve colors inline while scopes, heap attributes and graph are built.
        heap = build_heap()
        scopes = build_stack(frame)
        visual = build_visual_graph()
        return {"l": line, "s": scopes, "h": heap, "v": visual}
    finally:
        # A point annotation is consumed by exactly this snapshot.
        point_registry.clear()

def emit( frame, line, indication=None, ):
    snapshots.append( build_snapshot( frame, line, indication, ) )

def flush_pending(frame, snapshot_frame=None):
    frame_id = id(frame)
    if frame_id not in pending_lines:
        return
    line = pending_lines.pop(frame_id)
    indication = pending_indications.pop( frame_id, None, )
    emit( snapshot_frame if snapshot_frame is not None else frame, line, indication, )

def trace(frame, event, arg):
    if event == "call":
        name = frame.f_code.co_name
        if name == "point":
            caller = frame.f_back
            if ( caller is not None and is_user_frame(caller) ):
                indication = capture_point(frame)
                pending_indications[ id(caller) ] = indication
            return None
        if name == "visual":
            # Backward-compatible no-op; graph capture is always active.
            return None
    if not is_user_frame(frame):
        return trace
    if is_class_body(frame):
        return None
    if event == "call":
        return trace
    if event == "line":
        if is_point_frame(frame):
            return None
        if is_visual_frame(frame):
            return None
        frame_id = id(frame)
        if frame_id not in pending_lines:
            pending_lines[ frame_id ] = frame.f_lineno
            return trace
        flush_pending(frame)
        pending_lines[ frame_id ] = frame.f_lineno
        return trace
    if event == "return":
        if is_point_frame(frame):
            return None
        if is_visual_frame(frame):
            return None
        caller = frame.f_back
        flush_pending( frame, caller if caller is not None else frame, )
        return trace
    return trace

def write_json():
    with open( OUTPUT_FILE, "w", encoding="utf-8", ) as file:
        json.dump(snapshots, file, ensure_ascii=False, separators=(",", ":"))

def run():
    global USER_FILE
    global OUTPUT_FILE
    if len(sys.argv) > 1:
        USER_FILE = os.path.abspath( sys.argv[1] )
    if len(sys.argv) > 2:
        OUTPUT_FILE = sys.argv[2]
    with open( USER_FILE, "r", encoding="utf-8", ) as file:
        source = file.read()
    code = compile( source, USER_FILE, "exec", )
    globals_dict = { "__name__": "__main__", "__file__": USER_FILE, "__builtins__": __builtins__, "point": point, "visual": visual, }
    sys.settrace(trace)
    try:
        exec( code, globals_dict, )
    finally:
        sys.settrace(None)
        write_json()

def point(object, *args):
    """Highlight an object, or an array element: point(arr, index, color)."""
    pass

def visual():
    """Activate generic object-reference graph capture for subsequent snapshots."""
    pass

if __name__ == "__main__": run()
