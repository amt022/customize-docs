export type Fmt = "jpeg" | "png" | "webp";

/** What an application portal asks for. maxKB 0 means no upper limit. */
export interface Req {
  name: string;
  w: number; h: number; unit: "px" | "mm"; dpi: number;
  minKB: number; maxKB: number;
  format: Fmt;
}

// Examples only: every exam sets its own limits, so these must be checked against the official notification.
export const TEMPLATES: Req[] = [
  { name: "Photograph (example)", w: 200, h: 230, unit: "px", dpi: 300, minKB: 20, maxKB: 50, format: "jpeg" },
  { name: "Passport photo 35×45 mm (example)", w: 35, h: 45, unit: "mm", dpi: 300, minKB: 20, maxKB: 100, format: "jpeg" },
  { name: "Signature (example)", w: 140, h: 60, unit: "px", dpi: 300, minKB: 10, maxKB: 20, format: "jpeg" },
];
export const STORE = "applysetu.requirements";

export interface Check { ok: boolean; label: string; detail: string }

export const pixels = (r: Req): [number, number] =>
  r.unit === "px" ? [Math.round(r.w), Math.round(r.h)] : [Math.round((r.w / 25.4) * r.dpi), Math.round((r.h / 25.4) * r.dpi)];
export const kbText = (b: number) => `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
const fmtOf = (mime: string): Fmt | null => (mime === "image/jpeg" ? "jpeg" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : null);

/** Judge a file (dimensions, size, format) against the requirement. */
export function check(r: Req, w: number, h: number, bytes: number, mime: string): Check[] {
  const [pw, ph] = pixels(r);
  const f = fmtOf(mime);
  const kb = bytes / 1024;
  return [
    { ok: f === r.format, label: "Format", detail: `${(f ?? mime).toUpperCase()} (needs ${r.format.toUpperCase()})` },
    { ok: w === pw && h === ph, label: "Dimensions", detail: `${w}×${h} px (needs ${pw}×${ph})` },
    { ok: kb >= r.minKB && (r.maxKB === 0 || kb <= r.maxKB), label: "File size", detail: `${kbText(bytes)} (needs ${r.minKB}${r.maxKB ? `–${r.maxKB}` : "+"} KB)` },
  ];
}

/** Add comment segments to a JPEG until it reaches `bytes`; the picture itself does not change. */
export async function padJpeg(blob: Blob, bytes: number): Promise<Blob> {
  let left = bytes - blob.size;
  if (left <= 0) return blob;
  const parts: BlobPart[] = [];
  while (left > 0) {
    const len = Math.min(left, 65535);
    const data = Math.max(0, len - 4);
    const seg = new Uint8Array(4 + data);
    seg.set([0xff, 0xfe, ((data + 2) >> 8) & 0xff, (data + 2) & 0xff]);
    parts.push(seg);
    left -= seg.length;
  }
  return new Blob([blob.slice(0, 2), ...parts, blob.slice(2)], { type: "image/jpeg" });
}
