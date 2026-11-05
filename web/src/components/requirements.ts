export type Fmt = "jpeg" | "png" | "webp";

/** What an application portal asks for. maxKB 0 means no upper limit. */
export interface Req {
  name: string;
  w: number; h: number; unit: "px" | "mm"; dpi: number;
  minKB: number; maxKB: number;
  format: Fmt;
  group?: string;     // exam / portal, for the preset list
  note?: string;      // extra rule shown when the preset is chosen
  nameDate?: boolean; // name and date of the photograph must be printed under the face
}

// Commonly published limits. Every exam can change them in a new notification, so the UI
// always asks the user to check the official one.
const P = (group: string, name: string, r: Omit<Req, "name" | "group">): Req => ({ group, name: `${group}: ${name}`, ...r });
export const TEMPLATES: Req[] = [
  P("SSC (CGL, CHSL, MTS, GD)", "Photo", { w: 35, h: 45, unit: "mm", dpi: 200, minKB: 20, maxKB: 50, format: "jpeg",
    note: "Recent photo, plain light background, no cap or glasses." }),
  P("SSC (CGL, CHSL, MTS, GD)", "Signature", { w: 40, h: 20, unit: "mm", dpi: 200, minKB: 10, maxKB: 20, format: "jpeg" }),
  P("UPSC (CSE, NDA, CDS)", "Photo", { w: 350, h: 350, unit: "px", dpi: 300, minKB: 20, maxKB: 300, format: "jpeg", nameDate: true,
    note: "Your name and the date the photo was taken must be printed below the face." }),
  P("UPSC (CSE, NDA, CDS)", "Signature", { w: 350, h: 350, unit: "px", dpi: 300, minKB: 20, maxKB: 300, format: "jpeg" }),
  P("IBPS / SBI / RBI (bank exams)", "Photo", { w: 200, h: 230, unit: "px", dpi: 200, minKB: 20, maxKB: 50, format: "jpeg" }),
  P("IBPS / SBI / RBI (bank exams)", "Signature", { w: 140, h: 60, unit: "px", dpi: 200, minKB: 10, maxKB: 20, format: "jpeg",
    note: "Black ink on white paper; capital letters are not accepted." }),
  P("IBPS / SBI / RBI (bank exams)", "Left thumb impression", { w: 240, h: 240, unit: "px", dpi: 200, minKB: 20, maxKB: 50, format: "jpeg" }),
  P("IBPS / SBI / RBI (bank exams)", "Handwritten declaration", { w: 800, h: 400, unit: "px", dpi: 200, minKB: 50, maxKB: 100, format: "jpeg" }),
  P("NTA (NEET, JEE Main, CUET)", "Passport photo", { w: 35, h: 45, unit: "mm", dpi: 200, minKB: 10, maxKB: 200, format: "jpeg", nameDate: true,
    note: "80% face, white background; name and date of the photo below the face." }),
  P("NTA (NEET, JEE Main, CUET)", "Signature", { w: 50, h: 20, unit: "mm", dpi: 200, minKB: 4, maxKB: 30, format: "jpeg" }),
  P("Railways (RRB NTPC, Group D)", "Photo", { w: 35, h: 45, unit: "mm", dpi: 200, minKB: 30, maxKB: 70, format: "jpeg" }),
  P("Railways (RRB NTPC, Group D)", "Signature", { w: 50, h: 20, unit: "mm", dpi: 200, minKB: 30, maxKB: 70, format: "jpeg" }),
  P("PAN card (NSDL / UTIITSL)", "Photo", { w: 25, h: 35, unit: "mm", dpi: 200, minKB: 0, maxKB: 50, format: "jpeg" }),
  P("PAN card (NSDL / UTIITSL)", "Signature", { w: 45, h: 20, unit: "mm", dpi: 200, minKB: 0, maxKB: 50, format: "jpeg" }),
  P("General", "Passport photo 35×45 mm", { w: 35, h: 45, unit: "mm", dpi: 300, minKB: 20, maxKB: 100, format: "jpeg" }),
  P("General", "Photo 200×230 px", { w: 200, h: 230, unit: "px", dpi: 300, minKB: 20, maxKB: 50, format: "jpeg" }),
  P("General", "Signature 140×60 px", { w: 140, h: 60, unit: "px", dpi: 300, minKB: 10, maxKB: 20, format: "jpeg" }),
];
export const GROUPS = [...new Set(TEMPLATES.map((t) => t.group!))];
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
