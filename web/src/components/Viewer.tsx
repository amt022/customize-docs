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
  children?: (viewport: PageViewport) => React.ReactNode;
}

export default function Viewer({ pdf, pageNum, zoom, model, selection, highlights, marks, onSelect, onEdit, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [rendering, setRendering] = useState(true);

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

  const handleWordClick = (w: Word, e: React.MouseEvent) => {
    e.stopPropagation();
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
          {children?.(viewport)}
        </div>
      )}
      {rendering && <div className="page-loading">Rendering…</div>}
    </div>
  );
}
