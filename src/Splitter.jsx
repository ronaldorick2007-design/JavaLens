import { useRef } from "react";

// Draggable / keyboard-resizable divider. Reports pixel deltas along its axis.
export default function Splitter({ vertical = false, onDelta, label }) {
  const last = useRef(null);
  const axis = (e) => (vertical ? e.clientX : e.clientY);

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      tabIndex={0}
      className={`splitter ${vertical ? "splitter-v" : "splitter-h"}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = axis(e);
        document.body.classList.add("is-resizing");
      }}
      onPointerMove={(e) => {
        if (last.current == null) return;
        const pos = axis(e);
        onDelta(pos - last.current);
        last.current = pos;
      }}
      onPointerUp={() => {
        last.current = null;
        document.body.classList.remove("is-resizing");
      }}
      onPointerCancel={() => {
        last.current = null;
        document.body.classList.remove("is-resizing");
      }}
      onKeyDown={(e) => {
        const keys = vertical ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
        const i = keys.indexOf(e.key);
        if (i < 0) return;
        e.preventDefault();
        onDelta(i === 0 ? -16 : 16);
      }}
    />
  );
}
