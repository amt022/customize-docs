import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PageActions {
  rotate: (page: number, degrees: number) => void;
  remove: (page: number) => void;
  move: (from: number, to: number) => void;
}

function Thumb({ pdf, n, active, onClick, actions, total, onDragStart, onDropOn }: {
  pdf: PDFDocumentProxy; n: number; active: boolean; onClick: () => void; actions: PageActions; total: number;
  onDragStart: (n: number) => void; onDropOn: (n: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    pdf.getPage(n).then((page) => {
      if (cancelled || !ref.current) return;
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 120 / Math.max(base.width, base.height * 0.77) });
      const c = ref.current;
      c.width = vp.width * 2;
      c.height = vp.height * 2;
      c.style.width = `${vp.width}px`;
      c.style.height = `${vp.height}px`;
      task = page.render({ canvasContext: c.getContext("2d")!, viewport: vp, transform: [2, 0, 0, 2, 0, 0] });
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, n]);
  return (
    <div
      className={"thumb" + (active ? " active" : "") + (over ? " drop-target" : "")}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(n); }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDropOn(n); }}
    >
      <button className="thumb-img" onClick={onClick} aria-label={`Page ${n}`}><canvas ref={ref} /></button>
      <div className="thumb-bar">
        <span>{n}</span>
        <span className="thumb-actions">
          <button title="Rotate left" onClick={() => actions.rotate(n, -90)}>↺</button>
          <button title="Rotate right" onClick={() => actions.rotate(n, 90)}>↻</button>
          <button title="Move up" disabled={n === 1} onClick={() => actions.move(n, n - 1)}>↑</button>
          <button title="Move down" disabled={n === total} onClick={() => actions.move(n, n + 1)}>↓</button>
          <button title="Delete page" disabled={total === 1} onClick={() => actions.remove(n)}>🗑</button>
        </span>
      </div>
    </div>
  );
}

export default function Thumbnails({ pdf, page, onPage, actions }: { pdf: PDFDocumentProxy; page: number; onPage: (n: number) => void; actions: PageActions }) {
  const pages = Array.from({ length: Math.min(pdf.numPages, 500) }, (_, i) => i + 1);
  const dragged = useRef<number | null>(null);
  return (
    <nav className="thumbs">
      {pages.map((n) => (
        <Thumb key={n} pdf={pdf} n={n} total={pdf.numPages} active={n === page} onClick={() => onPage(n)} actions={actions}
          onDragStart={(k) => { dragged.current = k; }}
          onDropOn={(k) => { if (dragged.current && dragged.current !== k) actions.move(dragged.current, k); dragged.current = null; }} />
      ))}
    </nav>
  );
}
