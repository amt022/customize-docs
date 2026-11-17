import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import type { PageModel, Selection } from "../types";
import { glyphsFor, toViewRect, unionBox, wordsOf, type Word } from "../pdf";

interface Props {
  pdf: PDFDocumentProxy;
  pageNum: number;
  zoom: number;
  model: PageModel | null;
  selection: Selection | null;
  highlights: number[][]; // glyph groups to highlight (search hits)
  marks?: { boxes: number[][]; severity: string } | null; // PDF-space boxes of a document-check finding
  onSelect: (s: Selection | null) => void;
  onEdit: () => void;
  marking?: boolean; // drag a box around text the OCR did not find
  onMark?: (bbox: number[]) => void; // the box, in PDF units
  children?: (viewport: PageViewport) => React.ReactNode;
}

export default function Viewer({ pdf, pageNum, zoom, model, selection, highlights, marks, onSelect, onEdit, marking, onMark, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [rendering, setRendering] = useState(true);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    setRendering(true);
    (async () => {
      const page = await pdf.getPage(pageNum);
      if (cancelled) return;
      const vp = page.getViewport({ scale: zoom });
      const canvas = canvasRef.current!;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      const ctx = canvas.getContext("2d")!;
      task = page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      try {
        await task.promise;
      } catch {
        return; // cancelled by a newer render
      }
      if (!cancelled) {
        setViewport(vp);
        setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNum, zoom]);

  const words: Word[] = useMemo(() => (model ? wordsOf(model.lines, model.glyphs) : []), [model]);

  const selRect = useMemo(() => {
    if (!model || !selection || !viewport) return null;
    const line = model.lines[selection.line];
    const ids = glyphsFor(line, selection.start, selection.end);
    if (!ids.length) return null;
    return toViewRect(viewport, unionBox(model.glyphs, ids));
  }, [model, selection, viewport]);

  // pointer position on the page, in viewport units (the frame may be shown scaled)
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = viewport && r.width ? viewport.width / r.width : 1;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  };
  const endMark = () => {
    const d = drag;
    setDrag(null);
    if (!d || !viewport || Math.abs(d.x1 - d.x0) < 8 || Math.abs(d.y1 - d.y0) < 8) return;
    const [ax, ay] = viewport.convertToPdfPoint(d.x0, d.y0);
    const [bx, by] = viewport.convertToPdfPoint(d.x1, d.y1);
    onMark?.([Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]);
  };

  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const handleWordClick = (w: Word, e: React.MouseEvent) => {
    e.stopPropagation();
    const inSel = selection && selection.line === w.line && w.start >= selection.start && w.end <= selection.end;
    if (touch && inSel && !e.shiftKey) {  // phones: tap the selected word again to edit it
      onEdit();
      return;
    }
    if (e.shiftKey && selection && selection.line === w.line) {
      onSelect({ page: pageNum, line: w.line, start: Math.min(selection.start, w.start), end: Math.max(selection.end, w.end) });
    } else {
      onSelect({ page: pageNum, line: w.line, start: w.start, end: w.end });
    }
  };

  return (
    <div className="page-frame" style={viewport ? { width: viewport.width, height: viewport.height } : undefined}
      onClick={() => onSelect(null)}>
      <canvas ref={canvasRef} className="page-canvas" />
      {viewport && model && !rendering && (
        <div className="overlay">
          {marks?.boxes.map((b, k) => (
            <div key={`m${k}`} className={"issue-box " + marks.severity} style={toViewRect(viewport, b as [number, number, number, number])} />
          ))}
          {highlights.map((ids, k) => {
            const r = toViewRect(viewport, unionBox(model.glyphs, ids));
            return <div key={`h${k}`} className="hit" style={r} />;
          })}
          {words.map((w) => {
            const r = toViewRect(viewport, w.bbox);
            const selected = selection && selection.line === w.line && w.start >= selection.start && w.end <= selection.end;
            return (
              <div
                key={`${w.line}:${w.start}`}
                className={"word" + (selected ? " in-selection" : "")}
                style={r}
                title={w.text}
                onClick={(e) => handleWordClick(w, e)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!selected) onSelect({ page: pageNum, line: w.line, start: w.start, end: w.end });
                  onEdit();
                }}
              />
            );
          })}
          {selRect && <div className="selection" style={selRect} />}
          {selRect && touch && selection && (() => {
            const next = words.filter((w) => w.line === selection.line && w.start >= selection.end).sort((a, b) => a.start - b.start)[0];
            return (
              <div className="touch-bar" style={{ left: Math.max(4, selRect.left), top: selRect.top + selRect.height + 6 }}
                onClick={(e) => e.stopPropagation()}>
                <button className="btn small primary" onClick={onEdit}>✎ Edit</button>
                {next && <button className="btn small" onClick={() => onSelect({ ...selection, end: next.end })}>＋ Next word</button>}
              </div>
            );
          })()}
          {children?.(viewport)}
          {marking && (
            <div className="mark-layer" onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
              onPointerMove={(e) => { if (drag) { const p = at(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } }}
              onPointerUp={endMark} onPointerCancel={() => setDrag(null)}>
              {drag && <div className="mark-box" style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }} />}
            </div>
          )}
        </div>
      )}
      {rendering && <div className="page-loading">Rendering…</div>}
    </div>
  );
}
