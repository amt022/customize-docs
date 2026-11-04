import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { GlyphInfo, LineInfo } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function loadPdf(url: string): Promise<PDFDocumentProxy> {
  const data = await fetch(url, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(`Could not load PDF (${r.status})`);
    return r.arrayBuffer();
  });
  return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
}

export type Rect = { left: number; top: number; width: number; height: number };

/** PDF user-space bbox -> CSS pixel rect inside the rendered page (handles rotation/cropbox). */
export function toViewRect(viewport: pdfjs.PageViewport, b: number[]): Rect {
  const [x0, y0, x1, y1] = viewport.convertToViewportRectangle(b);
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

export interface Word {
  line: number;
  start: number;
  end: number;
  text: string;
  glyphs: number[];
  bbox: [number, number, number, number];
}

export function glyphsFor(line: LineInfo, start: number, end: number): number[] {
  return [...new Set(line.map.slice(start, end).filter((i) => i >= 0))];
}

export function unionBox(glyphs: GlyphInfo[], ids: number[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of ids) {
    const b = glyphs[i].b;
    x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]);
    x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
  }
  return [x0, y0, x1, y1];
}

/** Split each line into words; whitespace (real or implied) separates words. */
export function wordsOf(lines: LineInfo[], glyphs: GlyphInfo[]): Word[] {
  const words: Word[] = [];
  for (const line of lines) {
    const t = line.text;
    let i = 0;
    while (i < t.length) {
      while (i < t.length && /\s/.test(t[i])) i++;
      const s = i;
      while (i < t.length && !/\s/.test(t[i])) i++;
      if (i > s) {
        const ids = glyphsFor(line, s, i);
        if (ids.length) words.push({ line: line.id, start: s, end: i, text: t.slice(s, i), glyphs: ids, bbox: unionBox(glyphs, ids) });
      }
    }
  }
  return words;
}

export function cssFontFamily(name: string): string {
  const n = name.toLowerCase();
  if (/courier|mono|consol/.test(n)) return `"Courier New", Consolas, monospace`;
  if (/times|georgia|garamond|serif|cambria|book/.test(n) && !/sans/.test(n)) return `"Times New Roman", Georgia, serif`;
  if (/calibri/.test(n)) return `Calibri, Carlito, Arial, sans-serif`;
  if (/nirmala|mangal|devanagari/.test(n)) return `"Nirmala UI", Mangal, sans-serif`;
  return `Arial, Helvetica, sans-serif`;
}
