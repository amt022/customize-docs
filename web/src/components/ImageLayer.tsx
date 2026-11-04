import { useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";
import type { PageImage } from "../types";
import { toViewRect, type Rect } from "../pdf";

type Handle = "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN = 10; // px

interface Drag {
  id: number;
  handle: Handle;
  from: [number, number];
  start: Rect;
  rect: Rect;
  moved: boolean;
}

/** Selection boxes over the page's pictures: click to select, drag to move, drag a handle to resize. */
export default function ImageLayer({ viewport, images, selected, lockAspect, onSelect, onCommit }: {
  viewport: PageViewport;
  images: PageImage[];
  selected: number | null;
  lockAspect: boolean;
  onSelect: (id: number | null) => void;
  onCommit: (id: number, bbox: [number, number, number, number]) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const point = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const begin = (e: React.PointerEvent, img: PageImage, handle: Handle) => {
    e.stopPropagation();
    ref.current!.setPointerCapture(e.pointerId);
    onSelect(img.id);
    const start = toViewRect(viewport, img.bbox);
    setDrag({ id: img.id, handle, from: point(e), start, rect: start, moved: false });
  };

  const update = (e: React.PointerEvent) => {
    if (!drag) return;
    const [x, y] = point(e);
    const dx = x - drag.from[0], dy = y - drag.from[1];
    const s = drag.start;
    // shift temporarily flips the aspect-ratio lock
    const keep = e.shiftKey ? !lockAspect : lockAspect;
    let { left, top } = s;
    let right = s.left + s.width, bottom = s.top + s.height;
    const h = drag.handle;
    if (h === "move") {
      left += dx; right += dx; top += dy; bottom += dy;
    } else {
      if (h.includes("w")) left += dx;
      if (h.includes("e")) right += dx;
      if (h.includes("n")) top += dy;
      if (h.includes("s")) bottom += dy;
      if (right - left < MIN) { if (h.includes("w")) left = right - MIN; else right = left + MIN; }
      if (bottom - top < MIN) { if (h.includes("n")) top = bottom - MIN; else bottom = top + MIN; }
      if (keep) {
        const ratio = s.width / s.height;
        let w = right - left, hh = bottom - top;
        const corner = h.length === 2;
        if (corner ? Math.abs(w - s.width) / s.width >= Math.abs(hh - s.height) / s.height : h === "e" || h === "w") hh = w / ratio;
        else w = hh * ratio;
        if (corner) {
          if (h.includes("w")) left = right - w; else right = left + w;
          if (h.includes("n")) top = bottom - hh; else bottom = top + hh;
        } else if (h === "e" || h === "w") {
          const cy = (s.top + s.top + s.height) / 2; // the free axis grows from the centre
          if (h === "w") left = right - w; else right = left + w;
          top = cy - hh / 2; bottom = cy + hh / 2;
        } else {
          const cx = (s.left + s.left + s.width) / 2;
          if (h === "n") top = bottom - hh; else bottom = top + hh;
          left = cx - w / 2; right = cx + w / 2;
        }
      }
    }
    setDrag({ ...drag, rect: { left, top, width: right - left, height: bottom - top }, moved: drag.moved || Math.hypot(dx, dy) > 3 });
  };

  const finish = () => {
    if (!drag) return;
    const { rect, moved, id } = drag;
    setDrag(null);
    if (!moved) return;
    const a = viewport.convertToPdfPoint(rect.left, rect.top) as [number, number];
    const b = viewport.convertToPdfPoint(rect.left + rect.width, rect.top + rect.height) as [number, number];
    onCommit(id, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
  };

  // big pictures first so small ones stay on top and can be picked
  const ordered = [...images].sort((p, q) => area(q) - area(p));

  return (
    <div
      ref={ref}
      className="image-layer"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={() => onSelect(null)}
      onPointerMove={update}
      onPointerUp={finish}
      onPointerCancel={() => setDrag(null)}
    >
      {ordered.map((img) => {
        const dragging = drag?.id === img.id && drag.moved;
        const r = toViewRect(viewport, img.bbox);
        const isSel = selected === img.id;
        return (
          <div
            key={img.id}
            className={"img-box" + (isSel ? " selected" : "") + (img.pageScan ? " page-scan" : "") + (dragging ? " dragging" : "")}
            style={r}
            title={`${img.width}×${img.height} px · ${img.dpi} dpi`}
            onPointerDown={(e) => begin(e, img, "move")}
          >
            {isSel && !drag && HANDLES.map((h) => (
              <span key={h} className={"img-handle h-" + h} onPointerDown={(e) => begin(e, img, h)} />
            ))}
          </div>
        );
      })}
      {drag?.moved && (
        <div className="img-draft" style={drag.rect}>
          <span className="img-size">{label(viewport, drag.rect)}</span>
        </div>
      )}
    </div>
  );
}

function area(i: PageImage): number {
  return (i.bbox[2] - i.bbox[0]) * (i.bbox[3] - i.bbox[1]);
}

/** Live size read-out while dragging, in points. */
function label(vp: PageViewport, r: Rect): string {
  return `${Math.round(r.width / vp.scale)} × ${Math.round(r.height / vp.scale)} pt`;
}
