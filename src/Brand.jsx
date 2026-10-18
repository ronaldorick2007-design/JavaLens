import { useEffect, useState } from "react";

const FRAMES = ["J", "JA", "JAV", "JAVA", "JavaLens"];
const FRAME_MS = 130;

// Short wordmark reveal. Purely cosmetic: nothing waits on it.
export default function Brand() {
  const [frame, setFrame] = useState(() =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? FRAMES.length - 1
      : 0
  );

  useEffect(() => {
    if (frame >= FRAMES.length - 1) return undefined;
    const id = setTimeout(() => setFrame((f) => f + 1), FRAME_MS);
    return () => clearTimeout(id);
  }, [frame]);

  const full = FRAMES[FRAMES.length - 1];
  return (
    <span className="brand" aria-label={full}>
      {/* The full word reserves width so the toolbar never shifts. */}
      <span className="brand-ghost" aria-hidden="true">{full}</span>
      <span className="brand-text" aria-hidden="true">{FRAMES[frame]}</span>
    </span>
  );
}
