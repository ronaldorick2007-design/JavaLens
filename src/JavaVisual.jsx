import { useEffect, useMemo, useState } from "react";
import { useTheme } from "./ThemeProvider";
function colorClass(color, dark = false, base = "bg-white") {
    const colors = {
        red: dark ? "border-red-500 bg-red-950 text-red-50 font-bold" : "border-red-600 bg-red-100 text-red-950 font-bold",
        blue: dark ? "border-blue-400 bg-blue-950 text-blue-50 font-bold" : "border-blue-600 bg-blue-100 text-blue-950 font-bold",
        green: dark ? "border-green-400 bg-green-950 text-green-50 font-bold" : "border-green-600 bg-green-100 text-green-950 font-bold",
        orange: dark ? "border-orange-400 bg-orange-950 text-orange-50 font-bold" : "border-orange-600 bg-orange-100 text-orange-950 font-bold",
        purple: dark ? "border-purple-400 bg-purple-950 text-purple-50 font-bold" : "border-purple-600 bg-purple-100 text-purple-950 font-bold",
        yellow: dark ? "border-yellow-300 bg-yellow-950 text-yellow-50 font-bold" : "border-yellow-600 bg-yellow-100 text-yellow-950 font-bold",
        pink: dark ? "border-pink-400 bg-pink-950 text-pink-50 font-bold" : "border-pink-600 bg-pink-100 text-pink-950 font-bold",
        cyan: dark ? "border-cyan-400 bg-cyan-950 text-cyan-50 font-bold" : "border-cyan-600 bg-cyan-100 text-cyan-950 font-bold",
    };
    return colors[String(color || "").toLowerCase()] || `${dark ? "border-white text-white" : "border-black text-black"} ${base}`;
}

function toVisualArray(input) {
    if (Array.isArray(input)) return input;
    if (input && typeof input === "object") {
        for (const key of ["items", "nodes", "values", "data", "array", "elements", "fields", "rows"]) {
            if (Array.isArray(input[key])) return input[key];
        }
        for (const key of ["items", "nodes", "values", "data", "array", "elements", "fields", "rows"]) {
            if (input[key] && typeof input[key] === "object") return Object.values(input[key]);
        }
        return Object.values(input);
    }
    return [];
}

function readItemValue(item) {
    if (item == null) return String(item);
    if (typeof item !== "object") return String(item);
    return String(item.name ?? item.value ?? item.label ?? item.id ?? JSON.stringify(item));
}

function normalizeScopes(rawScopes) {
    const scopes = Array.isArray(rawScopes) ? rawScopes : toVisualArray(rawScopes);
    if (scopes.some((entry) => entry && typeof entry === "object" && "scope" in entry && !Array.isArray(entry.variables))) {
        const grouped = new Map();
        for (const variable of scopes) {
            const scopeName = String(variable?.scope ?? "Unknown scope");
            if (!grouped.has(scopeName)) grouped.set(scopeName, { name: scopeName, variables: [] });
            grouped.get(scopeName).variables.push({
                name: variable?.name ?? "unnamed",
                type: variable?.type ?? "var",
                value: variable?.value,
                color: variable?.color ?? "none",
            });
        }
        return [...grouped.values()];
    }
    return scopes.map((scope) => ({
        ...scope,
        name: scope?.name ?? "Unnamed scope",
        variables: Array.isArray(scope?.variables)
            ? scope.variables
            : scope?.variables && typeof scope.variables === "object"
                ? Object.entries(scope.variables).map(([name, value]) => ({ name, value }))
                : [],
    }));
}

/* ---------------- NORMALIZE ---------------- */
function normalizeSnapshots(input) {
let data = input;
       if (typeof data === "string") {
           try {
               data = JSON.parse(data);
           } catch {
               return { snapshots: [], error: "Snapshot data is not valid JSON." };
           }
       }
       if (data && !Array.isArray(data) && Array.isArray(data.snapshots)) {
           data = data.snapshots;
       } else if (data && !Array.isArray(data) && (data.heap || data.scopes || data.visual)) {
           data = [data];
       }
       if (!Array.isArray(data)) {
           return {
               snapshots: [],
               error: "No snapshots provided. Pass snapshots as an array, a snapshot object, or JSON string.",
           };
       }
       return {
           snapshots: data.map((item, index) => ({
               ...(item && typeof item === "object" ? item : {}),
               line: Number.isFinite(item?.line) ? item.line : index + 1,
               heap: Array.isArray(item?.heap) ? item.heap : toVisualArray(item?.heap),
               scopes: normalizeScopes(item?.scopes),
               visual: Array.isArray(item?.visual) ? item.visual : item?.visual ? [item.visual] : [],
           })),
           error: null,
       };
}
function normalizeTreeItems(input) {
    return toVisualArray(input)
        .filter((node) => node && typeof node === "object")
        .map((node, index) => ({
            ...node,
            id: String(node.id ?? `tree-node-${index}`),
            name: node.name ?? node.value ?? node.label ?? `Node ${index}`,
            child: Array.isArray(node.child)
                ? node.child.map((flag) => flag ? 1 : 0)
                : ("left" in node || "right" in node)
                    ? [node.left != null ? 1 : 0, node.right != null ? 1 : 0]
                    : [],
        }));
}

/* ---------------- VALUES ---------------- */
function DisplayValue({ value, dark = false }) {
    const cell = dark ? "border-white bg-black text-white" : "border-black bg-white text-black";
    const is2D = Array.isArray(value) && value.some(Array.isArray);
    if (!Array.isArray(value)) {
        return <span>{value === undefined ? "undefined" : JSON.stringify(value)}</span>;
    }
    const renderCell = (item, rowIndex, columnIndex) => {
        const rawItemColor = item && typeof item === "object" ? item.color : undefined;
        const color = rawItemColor && rawItemColor !== "none" ? rawItemColor : undefined;
        return (
            <div
                key={columnIndex}
                className={`min-w-[76px] max-w-full [overflow-wrap:anywhere] border px-2 py-1 text-center ${
                    color ? colorClass(color, dark) : cell
                }`}
            >
                {readItemValue(item)}
            </div>
        );
    };
    if (!is2D) {
        return <div className={`grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,76px),max-content))] gap-1 ${dark ? "text-white" : "text-black"}`}>
            {value.map((item, index) => renderCell(item, null, index))}
        </div>;
    }
    return <div className={`w-full space-y-1 ${dark ? "text-white" : "text-black"}`}>
        {value.map((row, rowIndex) => (
            <div key={rowIndex} className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,76px),max-content))] gap-1">
                {Array.isArray(row)
                    ? row.map((item, columnIndex) => (
                        <div key={columnIndex}>
                            {renderCell(item, rowIndex, columnIndex)}
                        </div>
                    ))
                    : <div className={`border px-2 py-1 ${cell}`}>{readItemValue(row)}</div>}
            </div>
        ))}
    </div>;
}

/* ---------------- HEAP ---------------- */
function HeapObject({ object, dark = false }) {
const panel = dark ? "border-white bg-zinc-900 text-white" : "border-black bg-gray-50 text-black";
const inner = dark ? "border-white bg-black text-white" : "border-black bg-white text-black";
const muted = dark ? "text-gray-400" : "text-gray-500";
const fields = Array.isArray(object?.fields) ? object.fields : toVisualArray(object?.fields);
const isArray = typeof object?.class === "string" && object.class.endsWith("[]");
       return (
           <div className={`w-full min-w-0 border p-3 ${panel} ${object?.color && object.color !== "none" ? colorClass(object.color, dark) : ""}`}>
               <div className="break-words font-bold">
                   {object?.id ?? "Unknown object"}
               </div>
               <div className={`mb-2 text-sm ${muted}`}>
                   {object?.class ?? "Unknown class"}
               </div>
               {isArray ? (
                   <div className={`grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,76px),max-content))] gap-1 ${dark ? "text-white" : "text-black"}`}>
                       {fields.map((field, index) => {
const text = field && typeof field === "object" ? readItemValue(field) : String(field);
const separator = text.indexOf(":");
const value = separator >= 0 ? text.slice(separator + 1).trim() : text;
const rawElementColor = field && typeof field === "object" ? field.color : undefined;
const elementColor = rawElementColor && rawElementColor !== "none" ? rawElementColor : undefined;
                           return (
                               <div
                                   key={index}
                                   className={`min-w-[76px] max-w-full [overflow-wrap:anywhere] border px-2 py-1 text-center ${elementColor ? colorClass(elementColor, dark) : inner}`}
                               >
                                   <div className={`text-xs ${muted}`}>[{index}]</div>
                                   <div className="text-sm leading-5 [overflow-wrap:anywhere]">{value}</div>
                               </div>
                           );
                       })}
                   </div>
               ) : fields.length ? (
                   fields.map((field, index) => (
                       <div key={index} className="break-words text-sm">
                           {String(field)}
                       </div>
                   ))
               ) : (
                   <div className={`text-sm ${muted}`}>No fields</div>
               )}
           </div>
       );
}
/* ---------------- LINEAR VISUAL ---------------- */
function LinearVisual({ visual, dark = false }) {
const panel = dark ? "border-white bg-zinc-900 text-white" : "border-black bg-gray-50 text-black";
const panelClass = panel;
const inner = dark ? "border-white bg-black text-white" : "border-black bg-white text-black";
const muted = dark ? "text-gray-400" : "text-gray-500";
const items = toVisualArray(visual?.items ?? visual?.nodes);
       return (
           <div className={`w-full min-w-0 border p-4 ${panelClass}`}>
               <div className="mb-3 flex items-center justify-between">
                   <div className="font-bold">{visual?.name ?? "Linear visual"}</div>
                   <div className={`text-xs ${muted}`}>linear</div>
               </div>
               {items.length === 0 ? (
                   <div className={`border border-dashed px-3 py-4 text-sm ${inner} ${muted}`}>
                       No items
                   </div>
               ) : (
                   <div className="flex w-full flex-wrap items-stretch gap-2">
                       {items.map((item, index) => (
                           <div key={index} className="flex min-w-0 flex-1 items-center gap-2">
                               <div className={`min-w-0 w-full flex-1 break-words border px-3 py-2 text-center ${item?.color && item.color !== "none" ? colorClass(item.color, dark) : inner}`}>
                                   {readItemValue(item)}
                               </div>
                               {index < items.length - 1 && (
                                   <div className={muted}>-</div>
                               )}
                           </div>
                       ))}
                   </div>
               )}
           </div>
       );
}
/* ---------------- TREE VISUAL ---------------- */



function TreeVisual({ items = [], dark = false }) {
    const SIZE = 40;
    const RADIUS = SIZE / 2;
    const GAP = 32;
    const LEVEL_GAP = 76;
    const STEP = SIZE + GAP;
    const PAD = 24;

    const arr = Array.isArray(items) ? items : [];

    if (!arr.length || arr[0] == null) {
        return (
            <div className="text-sm text-gray-500">
                No tree nodes
            </div>
        );
    }

    // Preserve null slots when determining tree depth.
    let lastIndex = 0;

    for (let i = 0; i < arr.length; i++) {
        if (arr[i] != null) lastIndex = i;
    }

    const depth = Math.floor(Math.log2(lastIndex + 1));
    const span = depth + 1;
    const cols = 2 ** span - 1;
    const width = cols * STEP + PAD * 2;
    const height = span * LEVEL_GAP + PAD * 2;

    // Original TreeBuild column placement.
    function findNode(i) {
        const I = i + 1;
        const row = Math.floor(Math.log2(I));

        const no = 2 ** row;
        const half = no * 2;
        const col = Math.floor(cols / half);
        const cross = 2 ** (span - row);

        const index = I % no;
        const c = col + index * cross;

        return {
            x: PAD + c * STEP,
            y: PAD + row * LEVEL_GAP
        };
    }

    const palette = {
        red: "#dc2626",
        blue: "#2563eb",
        green: "#16a34a",
        lime: "#16a34a",
        orange: "#ea580c",
        purple: "#9333ea",
        yellow: "#ca8a04",
        pink: "#db2777",
        cyan: "#0891b2"
    };

    function isHighlighted(node) {
        const color = String(node?.color ?? "none").toLowerCase();

        return ![
            "none",
            "default",
            "gray",
            "grey",
            ""
        ].includes(color);
    }

    function getColor(node) {
        if (!isHighlighted(node)) return "#ffffff";

        const color = String(node.color).toLowerCase();
        return palette[color] || node.color;
    }

    function getLabel(node) {
        const raw = node?.name ?? node?.value ?? node?.data ?? "?";
        const label = String(raw);

        return label.length > 6
            ? label.slice(0, 5) + "…"
            : label;
    }

    const edges = [];

    // Connect existing nodes using binary heap indices.
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] == null) continue;

        for (const childIndex of [2 * i + 1, 2 * i + 2]) {
            if (childIndex >= arr.length || arr[childIndex] == null) {
                continue;
            }

            edges.push([i, childIndex]);
        }
    }

    return (
        <div
            className={`w-full min-w-0 overflow-auto p-2 ${
                dark ? "bg-zinc-900" : "bg-gray-50"
            }`}
        >
            <svg
                width={width}
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                style={{ display: "block", maxWidth: "none" }}
            >
                {edges.map(([parentIndex, childIndex]) => {
                    const parent = findNode(parentIndex);
                    const child = findNode(childIndex);

                    const x1 = parent.x + RADIUS;
                    const y1 = parent.y + RADIUS;
                    const x2 = child.x + RADIUS;
                    const y2 = child.y + RADIUS;

                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const distance = Math.hypot(dx, dy) || 1;

                    return (
                        <line
                            key={`${parentIndex}-${childIndex}`}
                            x1={x1 + (dx / distance) * RADIUS}
                            y1={y1 + (dy / distance) * RADIUS}
                            x2={x2 - (dx / distance) * RADIUS}
                            y2={y2 - (dy / distance) * RADIUS}
                            stroke={dark ? "#a1a1aa" : "#000000"}
                            strokeWidth="1.5"
                        />
                    );
                })}

                {arr.map((node, index) => {
                    if (node == null) return null;

                    const point = findNode(index);
                    const cx = point.x + RADIUS;
                    const cy = point.y + RADIUS;
                    const highlighted = isHighlighted(node);

                    return (
                        <g key={index}>
                            <circle
                                cx={cx}
                                cy={cy}
                                r={RADIUS}
                                fill={getColor(node)}
                                stroke={
                                    highlighted
                                        ? "none"
                                        : dark
                                            ? "#d4d4d8"
                                            : "#000000"
                                }
                                strokeWidth="1"
                            />

                            <text
                                x={cx}
                                y={cy}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fontSize="12"
                                fill={highlighted ? "#ffffff" : "#000000"}
                                pointerEvents="none"
                            >
                                {getLabel(node)}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}




function ArrayVisual({ visual, dark = false, matrix = false }) {
    const panel = dark ? "border-white bg-zinc-900 text-white" : "border-black bg-gray-50 text-black";
    const panelClass = panel;
    const muted = dark ? "text-gray-400" : "text-gray-500";
    let items = toVisualArray(visual?.items ?? visual?.values ?? visual?.data ?? visual?.array);
    const inferredMatrix = matrix || items.some(Array.isArray);
    if (inferredMatrix || (matrix && Array.isArray(visual?.rows))) {
        if (!items.some(Array.isArray) && Array.isArray(visual?.rows)) items = visual.rows;
        return (
            <div className={`w-full min-w-0 border p-4 ${panelClass}`}>
                <div className="mb-3 flex items-center justify-between">
                    <div className="font-bold">{visual?.name ?? (matrix ? "Matrix" : "Array")}</div>
                    <div className={`text-xs ${muted}`}>2D</div>
                </div>
                <div className="w-full space-y-1 overflow-x-auto">
                    {items.map((row, rowIndex) => (
                        <div key={rowIndex} className="flex min-w-max gap-1">
                            {(Array.isArray(row) ? row : [row]).map((item, columnIndex) => {
                                const rawItemColor = item && typeof item === "object" ? item.color : undefined;
                                const itemColor = rawItemColor && rawItemColor !== "none" ? rawItemColor : undefined;
                                const color = itemColor;
                                return <div key={columnIndex} className={`min-w-[64px] border px-2 py-2 text-center [overflow-wrap:anywhere] ${
                                    color ? colorClass(color, dark) : dark ? "border-white bg-black text-white" : "border-black bg-white text-black"
                                }`}>
                                    <div className={`text-xs ${muted}`}>[{rowIndex},{columnIndex}]</div>
                                    {readItemValue(item)}
                                </div>;
                            })}
                        </div>
                    ))}
                </div>
            </div>
        );
    }
    return (
        <div className={`w-full min-w-0 border p-4 ${panelClass}`}>
            <div className="mb-3 flex items-center justify-between">
                <div className="font-bold">{visual?.name ?? "Array"}</div>
                <div className={`text-xs ${muted}`}>array</div>
            </div>
            <div className="flex w-full flex-wrap gap-1">
                {items.map((item, index) => {
                    const rawItemColor = item && typeof item === "object" ? item.color : undefined;
                    const itemColor = rawItemColor && rawItemColor !== "none" ? rawItemColor : undefined;
                    const color = itemColor;
                    return <div key={index} className={`min-w-[64px] flex-1 border px-2 py-2 text-center [overflow-wrap:anywhere] ${
                        color ? colorClass(color, dark) : dark ? "border-white bg-black text-white" : "border-black bg-white text-black"
                    }`}>
                        <div className={`text-xs ${muted}`}>[{index}]</div>
                        {readItemValue(item)}
                    </div>;
                })}
            </div>
        </div>
    );
}


function GraphVisual({ visual, dark = false }) {
    const panel = dark
        ? "border-white bg-zinc-900 text-white"
        : "border-black bg-gray-50 text-black";

    const rawItems = toVisualArray(visual?.items);

    const nodes = rawItems.map((item, index) => {
        if (Array.isArray(item)) {
            return {
                id: index,
                name: String(index),
                neighbors: item,
                color: "none",
            };
        }

        return {
            ...(item && typeof item === "object" ? item : {}),
            id: index,
            name: readItemValue(item),
            neighbors: toVisualArray(item?.neighbors),
            color: item?.color ?? "none",
        };
    });

    const width = 520;
    const height = 300;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.34;
    const NODE_RADIUS = 22;

    const positions = nodes.map((_, index) => {
        const angle =
            (2 * Math.PI * index / Math.max(nodes.length, 1)) -
            Math.PI / 2;

        return {
            x: cx + radius * Math.cos(angle),
            y: cy + radius * Math.sin(angle),
        };
    });

    const edges = [];

    nodes.forEach((node, from) => {
        node.neighbors.forEach(neighbor => {
            const to =
                typeof neighbor === "number"
                    ? neighbor
                    : Number(
                        neighbor?.id ??
                        neighbor?.value ??
                        neighbor
                    );

            if (
                Number.isInteger(to) &&
                to >= 0 &&
                to < nodes.length &&
                from <= to
            ) {
                edges.push({ from, to });
            }
        });
    });

    const palette = {
        red: "#dc2626",
        blue: "#2563eb",
        green: "#16a34a",
        lime: "#16a34a",
        orange: "#ea580c",
        purple: "#9333ea",
        yellow: "#ca8a04",
        pink: "#db2777",
        cyan: "#0891b2",
    };

    function isHighlighted(node) {
        const color = node?.color;

        return Boolean(
            color &&
            !["none", "default", "gray", "grey"].includes(
                String(color).toLowerCase()
            )
        );
    }

    function getColor(node) {
        if (!isHighlighted(node)) return "#ffffff";

        const color = String(node.color).toLowerCase();
        return palette[color] || node.color;
    }

    return (
        <div className={`w-full min-w-0 border p-4 ${panel}`}>
            <div className="mb-3 font-bold">
                {visual?.name ?? "Graph"}
            </div>

            {!nodes.length ? (
                <div className="text-sm opacity-70">
                    No graph nodes found
                </div>
            ) : (
                <div className="w-full overflow-x-auto">
                    <svg
                        viewBox={`0 0 ${width} ${height}`}
                        className="h-auto w-full"
                        role="img"
                        aria-label="Graph visualization"
                    >
                        {/* Black edges behind nodes. */}
                        {edges.map((edge, index) => {
                            const a = positions[edge.from];
                            const b = positions[edge.to];

                            if (
                                !a ||
                                !b ||
                                edge.from === edge.to
                            ) {
                                return null;
                            }

                            const dx = b.x - a.x;
                            const dy = b.y - a.y;
                            const distance = Math.hypot(dx, dy) || 1;

                            return (
                                <line
                                    key={`e-${index}`}
                                    x1={a.x + (dx / distance) * NODE_RADIUS}
                                    y1={a.y + (dy / distance) * NODE_RADIUS}
                                    x2={b.x - (dx / distance) * NODE_RADIUS}
                                    y2={b.y - (dy / distance) * NODE_RADIUS}
                                    stroke="#000000"
                                    strokeWidth="1.5"
                                />
                            );
                        })}

                        {/* Uniform-size nodes with shared styling. */}
                        {nodes.map((node, index) => {
                            const p = positions[index];
                            const highlighted = isHighlighted(node);
                            const label = String(node.name ?? index);

                            return (
                                <g key={index}>
                                    <circle
                                        cx={p.x}
                                        cy={p.y}
                                        r={NODE_RADIUS}
                                        fill={getColor(node)}
                                        stroke={
                                            highlighted
                                                ? "none"
                                                : "#000000"
                                        }
                                        strokeWidth="1"
                                    />

                                    <text
                                        x={p.x}
                                        y={p.y}
                                        textAnchor="middle"
                                        dominantBaseline="central"
                                        fontSize="11"
                                        fill={
                                            highlighted
                                                ? "#ffffff"
                                                : "#000000"
                                        }
                                        pointerEvents="none"
                                    >
                                        {label.length > 12
                                            ? `${label.slice(0, 11)}…`
                                            : label}
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                </div>
            )}
        </div>
    );
}

/* ---------------- VISUAL ROUTER ---------------- */
function VisualObject({ visual, dark = false }) {
    const panel = dark ? "border-white bg-zinc-900 text-white" : "border-black bg-gray-50 text-black";
    const muted = dark ? "text-gray-400" : "text-gray-500";
    const type = String(visual?.type ?? "").trim().toLowerCase();
    if (type === "linear") return <LinearVisual visual={visual} dark={dark} />;
    if (type === "array") return <ArrayVisual visual={visual} dark={dark} />;
    if (type === "matrix" || type === "2d-array" || type === "2darray") return <ArrayVisual visual={visual} dark={dark} matrix />;
    if (type === "tree") return <TreeVisual items={visual?.items ?? visual?.nodes ?? visual?.root ?? []} visual={visual} dark={dark} />;
    if (type === "graph") return <GraphVisual visual={visual} dark={dark} />;
    return (
        <div className={`w-full min-w-0 border p-4 ${panel}`}>
            <div className="font-bold">{visual?.name ?? "Unnamed visual"}</div>
            <div className={`text-sm ${muted}`}>Unknown visual type: {visual?.type ?? "not specified"}</div>
        </div>
    );
}
/* ---------------- MAIN ---------------- */
export default function JavaVisual({ setLine, snapshots: snapshotsProp, snapshot: snapshotProp }) {
const { theme, appTheme } = useTheme();
const dark = theme === "dark";
const interactiveHover = `${appTheme.hover} ${appTheme.transition}`;
const panel = dark ? "border-white bg-black text-white" : "border-black bg-white text-black";
const section = dark ? "border-white bg-black text-white" : "border-black bg-white text-black";
const surface = dark ? "border-white bg-zinc-900 text-white" : "border-black bg-gray-50 text-black";
const inner = dark ? "border-white bg-black text-white" : "border-black bg-white text-black";
const muted = dark ? "text-gray-400" : "text-gray-500";
const accent = dark ? "border-red-500 bg-red-500 text-white" : "border-red-600 bg-red-100 text-red-950";
const currentLine = dark ? "border-red-500 bg-red-950 text-red-50" : "border-red-600 bg-red-50 text-red-950";
const inputSnapshots = snapshotsProp ?? snapshotProp;
const normalized = useMemo(
           () => normalizeSnapshots(inputSnapshots),
           [inputSnapshots]
       );
const snapshots = normalized.snapshots;
const [step, setStep] = useState(0);
const [playing, setPlaying] = useState(false);
const [size, setSize] = useState(14);
const [activeTab, setActiveTab] = useState("visual");
const snapshot = snapshots[step];
       useEffect(() => {
           setStep(0);
           setPlaying(false);
           setActiveTab("visual");
       }, [inputSnapshots]);
       useEffect(() => {
           if (typeof setLine === "function" && snapshot) {
               setLine(snapshot.line);
           }
       }, [snapshot, setLine]);
       useEffect(() => {
           if (!playing || snapshots.length <= 1) return undefined;
const timer = setInterval(() => {
               setStep((current) => {
                   if (current >= snapshots.length - 1) {
                       setPlaying(false);
                       return current;
                   }
                   return current + 1;
               });
           }, 1000);
           return () => clearInterval(timer);
       }, [playing, snapshots.length]);
function nextStep() {
           setStep((current) => Math.min(snapshots.length - 1, current + 1));
       }
function reset() {
           setPlaying(false);
           setStep(0);
       }
       if (!snapshots.length || !snapshot) {
           return (
               <div className={`border p-4 ${dark ? "border-red-500 bg-black text-red-100" : "border-red-600 bg-red-50 text-red-950"}`}>
                   {normalized.error ?? "No snapshots available for this problem."}
               </div>
           );
       }
       return (
           <div
               className={`min-w-0 border p-4 ${panel}`}
               style={{ fontSize: `${size}px`, "--accent": "#ef4444" }}
           >
               {/* Playback controls */}
               <div className={`mb-4 flex flex-wrap items-center gap-2 border p-3 ${inner}`}>
                   <button
                       onClick={() => setPlaying((current) => !current)}
                       disabled={snapshots.length < 2 ||
                           (playing && step === snapshots.length - 1)}
                       className={`border px-3 py-2 ${interactiveHover} disabled:opacity-40 ${accent}`}
                   >
                       {playing ? "Pause" : "Play"}
                   </button>
                   <button
                       onClick={() => setStep((current) => Math.max(0, current - 1))}
                       disabled={step === 0}
                       className={`border px-3 py-2 ${interactiveHover} disabled:opacity-40 ${inner}`}
                   >
                       ← Prev
                   </button>
                   <button
                       onClick={nextStep}
                       disabled={step >= snapshots.length - 1}
                       className={`border px-3 py-2 ${interactiveHover} disabled:opacity-40 ${inner}`}
                   >
                       Next →
                   </button>
                   <button onClick={reset} className={`border px-3 py-2 ${interactiveHover} ${inner}`}>
                       Stop / Reset
                   </button>
                   <div className={`border px-3 py-2 tabular-nums ${surface}`}>
                       {step + 1} / {snapshots.length}
                   </div>
                   <div className="ml-auto flex min-w-40 items-center gap-3">
                       <label htmlFor="java-visual-size" className={`whitespace-nowrap text-sm ${muted}`}>
                           Size {size}px
                       </label>
                       <input
                           id="java-visual-size"
                           type="range"
                           min="12"
                           max="20"
                           step="1"
                           value={size}
                           onChange={(event) => setSize(Number(event.target.value))}
                           className="w-full accent-red-500 transition-transform duration-200 hover:scale-95"
                       />
                   </div>
               </div>
               {/* Current line */}
               <div className={`mb-4 flex items-center justify-between border px-4 py-3 ${currentLine}`}>
                   <span className="text-sm">Current Line</span>
                   <span className="font-bold tabular-nums">
                       {snapshot.line}
                   </span>
               </div>
               {/* Switchable runtime views */}
               <div className="mb-4 grid grid-cols-3 gap-3" role="tablist" aria-label="Execution views">
                   {[
                       { id: "visual", label: "Visual", count: snapshot.visual.length },
                       { id: "scopes", label: "Scopes", count: snapshot.scopes.length },
                       { id: "heap", label: "Heap", count: snapshot.heap.length },
                   ].map((tab) => (
                       <button
                           key={tab.id}
                           type="button"
                           role="tab"
                           id={`java-visual-tab-${tab.id}`}
                           aria-selected={activeTab === tab.id}
                           aria-controls={`java-visual-panel-${tab.id}`}
                           onClick={() => setActiveTab(tab.id)}
                           className={`min-w-0 border px-3 py-3 text-sm font-bold ${interactiveHover} ${
                               activeTab === tab.id
                                   ? "border-red-500 bg-red-500 text-white"
                                   : `${inner}`
                           }`}
                       >
                           <span>{tab.label}</span>
                           <span className={`ml-2 text-xs ${activeTab === tab.id ? "text-white" : muted}`}>
                               {tab.count}
                           </span>
                       </button>
                   ))}
               </div>
               {/* Visuals */}
               {activeTab === "visual" && (
<section role="tabpanel" id="java-visual-panel-visual" aria-labelledby="java-visual-tab-visual" className={`mb-4 border p-4  ${panel}`}>
                   <div className="mb-3 flex items-center justify-between">
                       <h3 className="font-bold">Visual</h3>
                       <span className={`text-sm ${muted}`}>
                           {snapshot.visual.length} items
                       </span>
                   </div>
                   {snapshot.visual.length > 0 ? (
                       <div className="flex w-full min-w-0 flex-col gap-3">
                           {snapshot.visual.map((visual, index) => (
                               <VisualObject
                                   key={`${visual?.name ?? "visual"}-${index}`}
                                   visual={visual}
                                   dark={dark}
                               />
                           ))}
                       </div>
                   ) : (
                       <div className={`border border-dashed px-3 py-5 text-center text-sm ${surface} ${muted}`}>
                           No visual data in this snapshot
                       </div>
                   )}
               </section>
               )}
               {/* Function stack / scopes */}
               {activeTab === "scopes" && (
<section role="tabpanel" id="java-visual-panel-scopes" aria-labelledby="java-visual-tab-scopes" className={`mb-4 border p-4  ${panel}`}>
                   <div className="mb-3 flex items-center justify-between">
                       <h3 className="font-bold">Function Stack / Scope</h3>
                       <span className={`text-sm ${muted}`}>
                           {snapshot.scopes.length} scopes
                       </span>
                   </div>
                   {snapshot.scopes.length > 0 ? (
                       <div className="flex w-full min-w-0 flex-col gap-3">
                           {snapshot.scopes.map((scope, index) => (
                               <div
                                   key={`${scope.name}-${index}`}
                                   className={`w-full min-w-0 border px-3 py-3 ${surface}`}
                               >
                                   <div className="mb-2 font-semibold">{scope.name}</div>
                                   {scope.variables.length > 0 ? (
                                       <div className="flex w-full min-w-0 flex-col gap-0">
                                           {scope.variables.map((variable, variableIndex) => (
                                               <div
                                                   key={`${variable?.name ?? "variable"}-${variableIndex}`}
                                                   className="flex w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 py-1"
                                               >
                                                   <span className={muted}>
                                                       {variable?.type ?? "var"}
                                                   </span>
                                                   <span className="font-semibold">
                                                       {variable?.name ?? "unnamed"}
                                                   </span>
                                                   <span>=</span>
                                                   {Array.isArray(variable?.value) ? (
                                                       <div className="min-w-0 flex-1 basis-full pt-1">
                                                           <DisplayValue
                                                               dark={dark}
                                                               value={variable.value}
                                                           />
                                                       </div>
                                                   ) : (
                                                       <span className={`min-w-0 break-words ${variable?.color && variable.color !== "none" ? colorClass(variable.color, dark, "") : ""}`}>
                                                           {variable?.value === undefined ? "undefined" : JSON.stringify(variable.value)}
                                                       </span>
                                                   )}
                                               </div>
                                           ))}
                                       </div>
                                   ) : (
                                       <span className={`text-sm ${muted}`}>No variables</span>
                                   )}
                               </div>
                           ))}
                       </div>
                   ) : (
                       <div className={`border border-dashed px-3 py-5 text-center text-sm ${surface} ${muted}`}>
                           No active scopes
                       </div>
                   )}
               </section>
               )}
               {/* Heap */}
               {activeTab === "heap" && (
<section role="tabpanel" id="java-visual-panel-heap" aria-labelledby="java-visual-tab-heap" className={`border p-4  ${panel}`}>
                   <div className="mb-3 flex items-center justify-between">
                       <h3 className="font-bold">Heap</h3>
                       <span className={`text-sm ${muted}`}>
                           {snapshot.heap.length} objects
                       </span>
                   </div>
                   {snapshot.heap.length > 0 ? (
                       <div
                           className="grid w-full min-w-0 items-start gap-3"
                           style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), max-content))" }}
                       >
                           {snapshot.heap.map((object, index) => (
                               <div key={object?.id ?? `heap-${index}`} className="w-full min-w-0 max-w-full">
                                   <HeapObject object={object} dark={dark} />
                               </div>
                           ))}
                       </div>
                   ) : (
                       <div className={`border border-dashed px-3 py-5 text-center text-sm ${surface} ${muted}`}>
                           Heap is empty
                       </div>
                   )}
               </section>
               )}
           </div>
       );
}
