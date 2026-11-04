export interface DocumentInfo {
  id: string;
  original_name: string;
  file_size: number;
  page_count: number;
  current_version: number;
  head_version: number;
  was_encrypted: number;
  is_signed: number;
  created_at: string;
  updated_at: string;
  canUndo?: boolean;
  canRedo?: boolean;
  history?: HistoryEntry[];
}

export interface HistoryEntry {
  version: number;
  page: number;
  type: string;
  summary: string;
  createdAt: string;
  applied: boolean;
  layoutPreserved: boolean | null;
}

export interface FontInfo {
  name: string;
  baseFont: string;
  type: string;
  embedded: boolean;
  subset: boolean;
  bold: boolean;
  italic: boolean;
  editable: boolean;
  warnings: string[];
}

export interface GlyphInfo {
  i: number;
  c: string;
  b: [number, number, number, number]; // bbox in PDF user space
  o: [number, number]; // baseline origin
  a: number; // angle (degrees)
  f: string; // font key
  s: number; // effective size (pt)
  col: string;
  tr: number; // rendering mode
  x: boolean; // inside a form XObject
  conf?: number; // OCR confidence (scanned pages)
}

export interface LineInfo {
  id: number;
  text: string;
  map: number[]; // char index -> glyph index (-1 = implied space)
  bbox: [number, number, number, number];
}

export interface PageModel {
  page: number;
  box: [number, number, number, number];
  rotation: number;
  type: "digital" | "scanned" | "hybrid" | "empty";
  fonts: Record<string, FontInfo>;
  glyphs: GlyphInfo[];
  lines: LineInfo[];
  warnings: string[];
  source?: "ocr";
  ocrAvailable?: boolean;
  ocr?: { langs: string; words: number; meanConfidence: number | null };
  images?: PageImage[];
}

/** A picture drawn on the page. bbox is [x0, y0, x1, y1] in PDF points (origin bottom-left). */
export interface PageImage {
  id: number;
  bbox: [number, number, number, number];
  width: number; // pixels of the stored picture
  height: number;
  dpi: number; // effective resolution at the size it is drawn
  pageScan: boolean; // covers (nearly) the whole page: a scan or background
  inForm: boolean; // part of a reusable page element; only this page changes
  clipped: boolean; // cropped by a frame
  name: string;
  hasAlpha: boolean;
  colorSpace: string;
}

export type Tool = "edit" | "images" | "note" | "rect" | "ellipse" | "ink" | "signature" | "image" | "stamp";

export interface Placement {
  rect?: [number, number, number, number];
  x?: number;
  y?: number;
  paths?: number[][][];
}

export interface ScanStyle {
  family: "auto" | "sans" | "serif" | "mono";
  bold: boolean;
}

export type Anchor = "auto" | "left" | "right" | "center";
export type Fit = "auto" | "none" | "squeeze" | "reflow";

export interface EditReport {
  originalText: string;
  newText: string;
  font: string;
  fontSize: number;
  strategy: "original-font" | "mixed" | "substitute-font" | "scan-patch";
  substitutes: { char: string; font: string; quality: string }[];
  fits: boolean;
  overflow: number;
  scale: number;
  anchor: Anchor;
  fit: Fit;
  fitApplied: Fit;
  shift?: number;
  recentered?: boolean;
  originalWidth: number;
  newWidth: number;
  warnings: string[];
  notes?: string[];
  page?: number;
}

export interface Verification {
  unchangedGlyphs?: number;
  movedGlyphs?: number;
  newTextVerified?: boolean;
  changedOutside?: number;
  layoutPreserved: boolean;
  warnings?: string[];
}

export interface EditResponse {
  dryRun: boolean;
  version: number;
  reports: EditReport[];
  verification: Verification;
  summary: string;
  page?: PageModel;
}

export interface FindHit {
  page: number;
  glyphs: number[];
  text: string;
  line: number;
  bbox: [number, number, number, number];
  splitStreams: boolean;
}

export interface FindReplaceResponse {
  dryRun: boolean;
  matches: number;
  replaced: number;
  pages: number[];
  reports: EditReport[];
  skipped: { page: number; text: string; reason: string }[];
  verification: Verification;
  version: number;
}

/** A word (or user-extended range) on one line. */
export interface Selection {
  page: number;
  line: number;
  start: number; // char index in line.text
  end: number; // exclusive
}
