import { useEffect, useState } from "react";
import type { PageImage } from "../types";

type Unit = "pt" | "in" | "cm" | "mm";
const PER_PT: Record<Unit, number> = { pt: 1, in: 1 / 72, cm: 2.54 / 72, mm: 25.4 / 72 };
const DECIMALS: Record<Unit, number> = { pt: 1, in: 2, cm: 2, mm: 1 };

type Box = [number, number, number, number];

/** Side panel for pictures: list, exact size and position, rotate, replace, delete, insert. */
export default function ImagePanel({ images, selected, pageBox, lockAspect, busy, onLock, onSelect, onBox, onRotate, onDelete, onReplace, onInsert, onClose }: {
  images: PageImage[];
  selected: number | null;
  pageBox: Box;
  lockAspect: boolean;
  busy: boolean;
  onLock: (v: boolean) => void;
  onSelect: (id: number | null) => void;
  onBox: (bbox: Box) => void;
  onRotate: (deg: number) => void;
  onDelete: () => void;
  onReplace: () => void;
  onInsert: () => void;
  onClose: () => void;
}) {
  const [unit, setUnit] = useState<Unit>("pt");
  const img = images.find((i) => i.id === selected) ?? null;
  const [pw, ph] = [pageBox[2] - pageBox[0], pageBox[3] - pageBox[1]];

  // position is shown from the top-left corner of the page, like on screen
  const view = img ? {
    x: img.bbox[0] - pageBox[0], y: pageBox[3] - img.bbox[3], w: img.bbox[2] - img.bbox[0], h: img.bbox[3] - img.bbox[1],
  } : null;
  const [fields, setFields] = useState({ x: "", y: "", w: "", h: "" });
  useEffect(() => {
    if (!view) return;
    const f = (v: number) => (v * PER_PT[unit]).toFixed(DECIMALS[unit]);
    setFields({ x: f(view.x), y: f(view.y), w: f(view.w), h: f(view.h) });
  }, [img?.bbox.join(","), unit]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (key: "x" | "y" | "w" | "h") => {
    if (!img || !view) return;
    const v = parseFloat(fields[key]) / PER_PT[unit];
    if (!isFinite(v) || v < 0) return;
    let { x, y, w, h } = view;
    const ratio = w / h;
    if (key === "w") { if (v < 4) return; w = v; if (lockAspect) h = w / ratio; }
    if (key === "h") { if (v < 4) return; h = v; if (lockAspect) w = h * ratio; }
    if (key === "x") x = v;
    if (key === "y") y = v;
    if (Math.abs(x - view.x) + Math.abs(y - view.y) + Math.abs(w - view.w) + Math.abs(h - view.h) < 0.05) return;
    onBox([pageBox[0] + x, pageBox[3] - y - h, pageBox[0] + x + w, pageBox[3] - y]);
  };

  const fitWidth = () => {
    if (!view) return;
    const h = (view.w ? pw / view.w : 1) * view.h;
    onBox([pageBox[0], pageBox[3] - view.y - h, pageBox[2], pageBox[3] - view.y]);
  };
  const fitPage = () => {
    if (!view) return;
    const s = Math.min(pw / view.w, ph / view.h);
    const w = view.w * s, h = view.h * s;
    onBox([pageBox[0] + (pw - w) / 2, pageBox[1] + (ph - h) / 2, pageBox[0] + (pw + w) / 2, pageBox[1] + (ph + h) / 2]);
  };
  const scaleBy = (f: number) => {
    if (!img || !view) return;
    const cx = (img.bbox[0] + img.bbox[2]) / 2, cy = (img.bbox[1] + img.bbox[3]) / 2;
    onBox([cx - (view.w * f) / 2, cy - (view.h * f) / 2, cx + (view.w * f) / 2, cy + (view.h * f) / 2]);
  };

  const field = (key: "x" | "y" | "w" | "h", label: string) => (
    <label className="img-field">
      <span>{label}</span>
      <input
        value={fields[key]} inputMode="decimal" disabled={busy}
        onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
        onBlur={() => commit(key)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );

  return (
    <aside className="props images-panel">
      <header className="chat-head">
        <h3>🖼 Images</h3>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onClose} aria-label="Close image tools">✕</button>
      </header>
      <div className="images-body">
        <button className="btn primary" onClick={onInsert} disabled={busy}>＋ Insert image…</button>
        {images.length === 0 && <p className="muted small">This page has no pictures. Insert one, then drag it into place and resize it.</p>}
        {images.length > 0 && !img && <p className="muted small">Click a picture on the page to move or resize it, or choose one below.</p>}

        {images.length > 0 && (
          <ul className="img-list">
            {images.map((i, n) => (
              <li key={i.id}>
                <button className={selected === i.id ? "active" : ""} onClick={() => onSelect(i.id)}>
                  <strong>{i.pageScan ? "Full-page picture" : `Image ${n + 1}`}</strong>
                  <span className="muted small">{i.width}×{i.height} px · {i.dpi} dpi</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {img && view && (
          <>
            <div className="img-grid">
              {field("x", "X")}{field("y", "Y")}{field("w", "Width")}{field("h", "Height")}
            </div>
            <div className="img-row">
              <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="Units">
                <option value="pt">points</option><option value="in">inches</option>
                <option value="cm">cm</option><option value="mm">mm</option>
              </select>
              <label className="check-row"><input type="checkbox" checked={lockAspect} onChange={(e) => onLock(e.target.checked)} /> Keep proportions</label>
            </div>
            <div className="img-row">
              <button className="btn small" onClick={() => scaleBy(0.5)} disabled={busy}>50%</button>
              <button className="btn small" onClick={() => scaleBy(0.75)} disabled={busy}>75%</button>
              <button className="btn small" onClick={() => scaleBy(1.25)} disabled={busy}>125%</button>
              <button className="btn small" onClick={() => scaleBy(2)} disabled={busy}>200%</button>
            </div>
            <div className="img-row">
              <button className="btn small" onClick={fitWidth} disabled={busy}>Fit width</button>
              <button className="btn small" onClick={fitPage} disabled={busy}>Fit page</button>
              <button className="btn small" onClick={() => onRotate(-90)} disabled={busy} title="Rotate left">↺</button>
              <button className="btn small" onClick={() => onRotate(90)} disabled={busy} title="Rotate right">↻</button>
            </div>
            <div className="img-row">
              <button className="btn small" onClick={onReplace} disabled={busy}>Replace picture…</button>
              <button className="btn small danger" onClick={onDelete} disabled={busy}>Delete</button>
            </div>
            <p className="muted small">
              {img.width}×{img.height} px, drawn at {img.dpi} dpi{img.dpi > 0 && img.dpi < 150 ? " — low for printing" : ""}.
              {img.inForm && " Part of a repeated page element: only this page changes."}
              {img.clipped && " A frame crops this picture, so enlarging may not show more of it."}
            </p>
          </>
        )}
        <p className="muted small tip">Drag a handle to resize. Hold <kbd>Shift</kbd> to switch proportion locking while dragging. Press <kbd>Delete</kbd> to remove the selected picture.</p>
      </div>
    </aside>
  );
}
