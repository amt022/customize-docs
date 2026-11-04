import { useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";
import type { Placement, Tool } from "../types";

/** Captures pointer input for placement tools and reports the result in PDF coordinates. */
export default function PlacementLayer({ viewport, tool, onPlace }: { viewport: PageViewport; tool: Tool; onPlace: (p: Placement) => void }) {
  const [start, setStart] = useState<[number, number] | null>(null);
  const [cur, setCur] = useState<[number, number] | null>(null);
  const [path, setPath] = useState<[number, number][]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const local = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const toPdf = (p: [number, number]) => viewport.convertToPdfPoint(p[0], p[1]) as [number, number];

  const finish = (end: [number, number]) => {
    if (tool === "note") {
      const [x, y] = toPdf(end);
      onPlace({ x, y });
    } else if (tool === "ink") {
      if (path.length > 1) onPlace({ paths: [path.map(toPdf)] });
    } else if (start) {
      const a = toPdf(start), b = toPdf(end);
      if (Math.abs(end[0] - start[0]) > 4 && Math.abs(end[1] - start[1]) > 4) onPlace({ rect: [a[0], a[1], b[0], b[1]] });
    }
    setStart(null);
    setCur(null);
    setPath([]);
  };

  const box = start && cur ? {
    left: Math.min(start[0], cur[0]), top: Math.min(start[1], cur[1]),
    width: Math.abs(cur[0] - start[0]), height: Math.abs(cur[1] - start[1]),
  } : null;

  return (
    <div
      ref={ref}
      className={"placement tool-" + tool}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const p = local(e);
        setStart(p);
        setCur(p);
        setPath([p]);
      }}
      onPointerMove={(e) => {
        if (!start) return;
        const p = local(e);
        setCur(p);
        if (tool === "ink") setPath((old) => [...old, p]);
      }}
      onPointerUp={(e) => start && finish(local(e))}
    >
      {box && tool !== "ink" && tool !== "note" && <div className={"ghost " + (tool === "ellipse" ? "round" : "")} style={box} />}
      {tool === "ink" && path.length > 1 && (
        <svg className="ink-preview" width="100%" height="100%">
          <polyline points={path.map((p) => p.join(",")).join(" ")} fill="none" stroke="#d62828" strokeWidth={2} strokeLinecap="round" />
        </svg>
      )}
      <div className="placement-hint">
        {tool === "note" ? "Click where the note goes" : tool === "ink" ? "Draw with the mouse" : "Drag to place"} · Esc to stop
      </div>
    </div>
  );
}
