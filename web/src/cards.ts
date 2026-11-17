// Creative Studio: draws invitation cards, welcome boards and posters on a canvas.
// Everything runs in the browser; one set of details feeds every design so the package matches.
import qrcode from "qrcode-generator";

export type Pic = HTMLImageElement | HTMLCanvasElement;
export type Lang = "en" | "hi" | "both";
export type Kind =
  | "engagement" | "tilak" | "haldi" | "mehndi" | "wedding" | "reception"
  | "welcome" | "car" | "thanks";

export interface EventInfo { date: string; time: string; venue: string }

export interface Details {
  bride: string; groom: string;
  brideHi: string; groomHi: string;
  brideParents: string; groomParents: string;
  host: string; // "With best compliments from" line
  venue: string; address: string;
  date: string; time: string;
  events: Partial<Record<Kind, EventInfo>>;
  rsvp: string; // phone shown on cards
  qr: string;   // map link or RSVP link put in a QR code
  lang: Lang;
  theme: string;
  blessing: boolean; // "ॐ श्री गणेशाय नमः" at the top
  frame?: Frame;
  emblem?: Emblem;
}

export interface Theme {
  id: string; name: string;
  bg: [string, string]; ink: string; accent: string; soft: string; motif: "mandala" | "floral" | "leaf" | "line";
}

export const THEMES: Theme[] = [
  { id: "royal", name: "Red & Gold", bg: ["#7a0d14", "#3f0408"], ink: "#fff3d6", accent: "#e7b94c", soft: "#f6d98c", motif: "mandala" },
  { id: "ivory", name: "Ivory & Maroon", bg: ["#fff8ec", "#f3e3c4"], ink: "#5a1018", accent: "#a8741a", soft: "#c79a47", motif: "mandala" },
  { id: "blush", name: "Blush Floral", bg: ["#fff1f2", "#f9d6dc"], ink: "#6b2340", accent: "#c4577a", soft: "#e79ab1", motif: "floral" },
  { id: "peacock", name: "Peacock Blue", bg: ["#0b3b52", "#04202f"], ink: "#eaf7ff", accent: "#d9b45a", soft: "#3cc0b0", motif: "mandala" },
  { id: "haldi", name: "Marigold", bg: ["#ffd84a", "#f39a1e"], ink: "#4a1d00", accent: "#b33a00", soft: "#fff3b0", motif: "floral" },
  { id: "mehndi", name: "Mehndi Green", bg: ["#2f5d2a", "#173515"], ink: "#f5f0d8", accent: "#d8b75b", soft: "#a8c97b", motif: "leaf" },
  { id: "minimal", name: "Modern White", bg: ["#ffffff", "#f1f1f1"], ink: "#222222", accent: "#9b7b3d", soft: "#cfc2a3", motif: "line" },
  { id: "purple", name: "Royal Purple", bg: ["#4b1d6b", "#220b33"], ink: "#f8eefe", accent: "#e8c15a", soft: "#c9a0e8", motif: "mandala" },
  { id: "rosegold", name: "Rose Gold", bg: ["#fbe9e4", "#efc9bd"], ink: "#5b2b2b", accent: "#b76e5a", soft: "#dba393", motif: "floral" },
  { id: "navy", name: "Navy & Gold", bg: ["#13254a", "#070f22"], ink: "#eef3ff", accent: "#d8b45c", soft: "#8fb0ff", motif: "line" },
  { id: "saffron", name: "Saffron", bg: ["#ff9a3c", "#d9530f"], ink: "#fff6e8", accent: "#fff0a8", soft: "#ffd36b", motif: "mandala" },
  { id: "sage", name: "Sage Garden", bg: ["#eef3e6", "#d3e0c2"], ink: "#2f4127", accent: "#6f8f4e", soft: "#a9c08c", motif: "leaf" },
  { id: "black", name: "Black & Gold", bg: ["#1c1c1c", "#050505"], ink: "#f4ead2", accent: "#d4af37", soft: "#8c7a4a", motif: "line" },
  { id: "lilac", name: "Pastel Lilac", bg: ["#f4efff", "#ddd2f7"], ink: "#3d2d63", accent: "#7d62c4", soft: "#b7a6ea", motif: "floral" },
  { id: "teal", name: "Teal & Coral", bg: ["#0f5f5c", "#063432"], ink: "#effbf9", accent: "#ff8a6b", soft: "#7fd8cc", motif: "floral" },
  { id: "wine", name: "Wine & Blush", bg: ["#5c1028", "#2c0613"], ink: "#fde8ee", accent: "#f2b6c6", soft: "#c9758d", motif: "floral" },
  { id: "mint", name: "Mint Fresh", bg: ["#eafaf3", "#c5ecdb"], ink: "#174a38", accent: "#1f9e74", soft: "#86d3b5", motif: "leaf" },
  { id: "kumkum", name: "Kumkum & Turmeric", bg: ["#b3122b", "#6b0414"], ink: "#fff1d0", accent: "#ffc93c", soft: "#ff8a3c", motif: "mandala" },
  { id: "sky", name: "Sky Blue", bg: ["#eaf5ff", "#c8e2fb"], ink: "#16365c", accent: "#2f74c0", soft: "#8ebbe8", motif: "floral" },
];

export const theme = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

interface KindInfo { en: string; hi: string; inviteEn: string; inviteHi: string; event: boolean; size: [number, number] }

// card 5x7 at 216 px/in, boards 2:3 portrait, car poster landscape
const CARD: [number, number] = [1080, 1512];
export const KINDS: Record<Kind, KindInfo> = {
  engagement: { en: "Engagement Ceremony", hi: "सगाई समारोह", inviteEn: "request the pleasure of your company at the ring ceremony of", inviteHi: "की सगाई के शुभ अवसर पर आप सादर आमंत्रित हैं", event: true, size: CARD },
  tilak: { en: "Tilak Ceremony", hi: "तिलक समारोह", inviteEn: "cordially invite you to the Tilak ceremony of", inviteHi: "के तिलकोत्सव में आपकी गरिमामयी उपस्थिति प्रार्थनीय है", event: true, size: CARD },
  haldi: { en: "Haldi Ceremony", hi: "हल्दी रस्म", inviteEn: "join us for an afternoon of turmeric, music and laughter with", inviteHi: "की हल्दी रस्म में आप सपरिवार आमंत्रित हैं", event: true, size: CARD },
  mehndi: { en: "Mehndi Night", hi: "मेहंदी की रात", inviteEn: "invite you to colour the evening with henna and songs for", inviteHi: "की मेहंदी रस्म में आप सपरिवार आमंत्रित हैं", event: true, size: CARD },
  wedding: { en: "Wedding Invitation", hi: "शुभ विवाह", inviteEn: "request the honour of your presence at the wedding of", inviteHi: "के शुभ विवाह में आपकी उपस्थिति सादर प्रार्थनीय है", event: true, size: CARD },
  reception: { en: "Wedding Reception", hi: "प्रीतिभोज", inviteEn: "invite you to celebrate the newly married couple", inviteHi: "के विवाहोपरांत प्रीतिभोज में आप सादर आमंत्रित हैं", event: true, size: CARD },
  welcome: { en: "Welcome", hi: "स्वागतम्", inviteEn: "to the wedding celebrations of", inviteHi: "के शुभ विवाह में आपका हार्दिक स्वागत है", event: false, size: [1200, 1800] },
  car: { en: "Just Married", hi: "शुभ विवाह", inviteEn: "", inviteHi: "", event: false, size: [1800, 600] },
  thanks: { en: "Thank You", hi: "धन्यवाद", inviteEn: "for blessing our wedding with your presence and love", inviteHi: "हमारे विवाह में पधारकर आशीर्वाद देने के लिए हृदय से आभार", event: false, size: CARD },
};

export const KIND_ORDER: Kind[] = ["engagement", "tilak", "haldi", "mehndi", "wedding", "reception", "welcome", "car", "thanks"];

export const SERIF = `"Noto Serif Devanagari", "Nirmala UI", Mangal, "Palatino Linotype", Georgia, serif`;
export const SCRIPT = `"Great Vibes", "Segoe Script", "Lucida Handwriting", "Brush Script MT", cursive`;

export function eventOf(d: Details, k: Kind): EventInfo {
  const e = d.events[k];
  return { date: e?.date || d.date, time: e?.time || d.time, venue: e?.venue || d.venue };
}

const MONTHS_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const DAYS_HI = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];

export function formatDate(iso: string, hi: boolean): string {
  if (!iso) return "";
  const dt = new Date(iso + "T12:00:00");
  if (isNaN(+dt)) return iso;
  if (hi) return `${DAYS_HI[dt.getDay()]}, ${dt.getDate()} ${MONTHS_HI[dt.getMonth()]} ${dt.getFullYear()}`;
  return dt.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function formatTime(hm: string, hi: boolean): string {
  if (!hm) return "";
  const [h, m] = hm.split(":").map(Number);
  if (isNaN(h)) return hm;
  const h12 = ((h + 11) % 12) + 1, mm = String(m || 0).padStart(2, "0");
  if (hi) {
    const part = h < 12 ? "प्रातः" : h < 16 ? "दोपहर" : h < 19 ? "सायं" : "रात्रि";
    return `${part} ${h12}:${mm} बजे`;
  }
  return `${h12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

// ---------------------------------------------------------------- drawing helpers

export function fit(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, px: number, maxW: number): number {
  let s = px;
  ctx.font = font(s);
  while (s > 10 && ctx.measureText(text).width > maxW) { s *= 0.94; ctx.font = font(s); }
  return s;
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean), lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function petal(ctx: CanvasRenderingContext2D, len: number, wid: number) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(wid, -len * 0.5, 0, -len);
  ctx.quadraticCurveTo(-wid, -len * 0.5, 0, 0);
}

/** A round mandala / flower made of petal rings. */
export function mandala(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: Theme, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha *= alpha;
  const rings: [n: number, len: number, wid: number, color: string, fill: boolean][] = [
    [24, r, r * 0.13, t.accent, false],
    [16, r * 0.75, r * 0.16, t.soft, true],
    [12, r * 0.48, r * 0.14, t.accent, true],
  ];
  for (const [n, len, wid, color, filled] of rings) {
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.rotate((i / n) * Math.PI * 2);
      petal(ctx, len, wid);
      ctx.lineWidth = Math.max(1, r * 0.018);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (filled) { ctx.globalAlpha *= 0.55; ctx.fill(); ctx.globalAlpha /= 0.55; }
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2); ctx.fillStyle = t.accent; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2); ctx.fillStyle = t.bg[1]; ctx.fill();
  ctx.restore();
}

/** A spray of leaves (mehndi theme) or a five-petal flower (floral theme). */
export function corner(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, t: Theme) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (t.motif === "mandala") {
    ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI / 2); ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.04; ctx.stroke();
    mandala(ctx, 0, 0, s * 0.8, t, 0.9);
  } else if (t.motif === "floral") {
    for (const [dx, dy, r] of [[s * 0.35, s * 0.35, s * 0.42], [s * 0.95, s * 0.15, s * 0.22], [s * 0.15, s * 0.95, s * 0.22]] as const) {
      for (let i = 0; i < 5; i++) {
        ctx.save(); ctx.translate(dx, dy); ctx.rotate((i / 5) * Math.PI * 2);
        petal(ctx, r, r * 0.55); ctx.fillStyle = i % 2 ? t.soft : t.accent; ctx.globalAlpha = 0.75; ctx.fill(); ctx.restore();
      }
      ctx.beginPath(); ctx.arc(dx, dy, r * 0.18, 0, Math.PI * 2); ctx.fillStyle = t.ink; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
    }
  } else if (t.motif === "leaf") {
    ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.03;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * 0.6, s * 0.2, s * 1.2, s * 1.2); ctx.stroke();
    for (let i = 1; i <= 6; i++) {
      const p = i / 7, px = s * 1.2 * p * p + s * 0.6 * 2 * p * (1 - p) * 0.0 + s * 0.6 * 2 * p * (1 - p), py = s * 1.2 * p * p + s * 0.2 * 2 * p * (1 - p);
      for (const side of [-1, 1]) {
        ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI / 4 + side * 0.9);
        petal(ctx, s * 0.28, s * 0.1); ctx.fillStyle = side > 0 ? t.soft : t.accent; ctx.globalAlpha = 0.85; ctx.fill(); ctx.restore();
      }
    }
  } else {
    ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.025;
    ctx.beginPath(); ctx.moveTo(0, s); ctx.lineTo(0, 0); ctx.lineTo(s, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.18, s * 0.6); ctx.lineTo(s * 0.18, s * 0.18); ctx.lineTo(s * 0.6, s * 0.18); ctx.stroke();
  }
  ctx.restore();
}

export type Frame = "ornate" | "arch" | "simple" | "garland" | "scallop" | "deco" | "temple";
export const FRAMES: [Frame, string][] = [
  ["ornate", "Ornate corners"], ["arch", "Mandap arch"], ["garland", "Marigold garland"], ["temple", "Temple pillars"],
  ["scallop", "Lace scallop"], ["deco", "Art deco"], ["simple", "Simple"],
];

export function background(ctx: CanvasRenderingContext2D, w: number, h: number, t: Theme, frame: Frame = "ornate") {
  const g = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.45, Math.max(w, h) * 0.75);
  g.addColorStop(0, t.bg[0]); g.addColorStop(1, t.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // faint pattern of tiny diamonds for texture
  ctx.save();
  ctx.globalAlpha = frame === "simple" ? 0.035 : 0.07; ctx.fillStyle = t.accent;
  const step = Math.min(w, h) / 14;
  for (let y = step / 2; y < h; y += step) for (let x = ((y / step) % 2 ? step / 2 : 0) + step / 4; x < w; x += step) {
    ctx.beginPath(); ctx.moveTo(x, y - step * 0.08); ctx.lineTo(x + step * 0.08, y); ctx.lineTo(x, y + step * 0.08); ctx.lineTo(x - step * 0.08, y); ctx.fill();
  }
  ctx.restore();
  const m = Math.min(w, h) * 0.035;
  ctx.strokeStyle = t.accent;
  if (frame === "simple") {
    ctx.lineWidth = Math.min(w, h) * 0.003; ctx.strokeRect(m * 1.2, m * 1.2, w - 2.4 * m, h - 2.4 * m);
    return;
  }
  if (frame === "arch") return mandap(ctx, w, h, m, t);
  if (frame === "garland") return garland(ctx, w, h, m, t);
  if (frame === "scallop") return scallop(ctx, w, h, m, t);
  if (frame === "deco") return deco(ctx, w, h, m, t);
  if (frame === "temple") return temple(ctx, w, h, m, t);
  // double border
  ctx.lineWidth = Math.min(w, h) * 0.006; ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
  ctx.lineWidth = Math.min(w, h) * 0.002; ctx.strokeRect(m * 1.5, m * 1.5, w - 3 * m, h - 3 * m);
  const s = Math.min(w, h) * 0.16;
  corner(ctx, m, m, s, 0, t);
  corner(ctx, w - m, m, s, Math.PI / 2, t);
  corner(ctx, w - m, h - m, s, Math.PI, t);
  corner(ctx, m, h - m, s, -Math.PI / 2, t);
}

/** Strings of marigolds hanging from the top edge, with a thin border. */
function garland(ctx: CanvasRenderingContext2D, w: number, h: number, m: number, t: Theme) {
  const s = Math.min(w, h);
  ctx.save();
  ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.003;
  ctx.strokeRect(m * 1.2, m * 1.2, w - 2.4 * m, h - 2.4 * m);
  const strands = Math.max(5, Math.round(w / (s * 0.13)));
  for (let i = 0; i <= strands; i++) {
    const x = m * 1.2 + (i / strands) * (w - 2.4 * m);
    // short in the middle (the blessing line sits there), long towards the sides
    const len = s * (0.05 + 0.13 * Math.abs(i / strands - 0.5) * 2) * (i % 2 ? 0.75 : 1);
    for (let k = 0; k * s * 0.02 < len; k++) {
      ctx.fillStyle = k % 3 === 2 ? "#e8442b" : k % 2 ? "#ffb300" : "#ff7a00";
      ctx.beginPath(); ctx.arc(x, m * 1.2 + k * s * 0.02, s * 0.0115, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#3d8b40";
    ctx.save(); ctx.translate(x, m * 1.2 + len + s * 0.01); ctx.rotate(Math.PI); petal(ctx, s * 0.03, s * 0.012); ctx.fill(); ctx.restore();
  }
  ctx.strokeStyle = "#ff9800"; ctx.lineWidth = s * 0.016; ctx.lineCap = "round";
  for (let i = 0; i < strands; i++) {
    const x0 = m * 1.2 + (i / strands) * (w - 2.4 * m), x1 = m * 1.2 + ((i + 1) / strands) * (w - 2.4 * m);
    ctx.beginPath(); ctx.moveTo(x0, m * 1.2); ctx.quadraticCurveTo((x0 + x1) / 2, m * 1.2 + s * 0.05, x1, m * 1.2); ctx.stroke();
  }
  for (const [x, y] of [[m * 2.4, h - m * 2.4], [w - m * 2.4, h - m * 2.4]]) {
    for (let k = 0; k < 8; k++) { ctx.save(); ctx.translate(x, y); ctx.rotate((k / 8) * Math.PI * 2); petal(ctx, s * 0.05, s * 0.02); ctx.fillStyle = k % 2 ? "#ffb300" : "#ff7a00"; ctx.fill(); ctx.restore(); }
    ctx.fillStyle = "#c2410c"; ctx.beginPath(); ctx.arc(x, y, s * 0.012, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** A lace border of half-circles with dots, like a paper doily. */
function scallop(ctx: CanvasRenderingContext2D, w: number, h: number, m: number, t: Theme) {
  const s = Math.min(w, h), r = s * 0.022, inset = m * 1.4;
  ctx.save();
  ctx.fillStyle = t.accent; ctx.strokeStyle = t.accent;
  const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.round(len / (r * 2)));
    const a = Math.atan2(ny, nx);
    for (let i = 0; i < n; i++) {
      const cx = x0 + ((i + 0.5) / n) * (x1 - x0), cy = y0 + ((i + 0.5) / n) * (y1 - y0);
      ctx.globalAlpha = 0.9; ctx.lineWidth = s * 0.003;
      ctx.beginPath(); ctx.arc(cx, cy, r, a - Math.PI / 2, a + Math.PI / 2); ctx.stroke();
      ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(cx + nx * r * 0.45, cy + ny * r * 0.45, r * 0.18, 0, Math.PI * 2); ctx.fill();
    }
  };
  edge(inset, inset, w - inset, inset, 0, -1);
  edge(inset, h - inset, w - inset, h - inset, 0, 1);
  edge(inset, inset, inset, h - inset, -1, 0);
  edge(w - inset, inset, w - inset, h - inset, 1, 0);
  ctx.globalAlpha = 1; ctx.lineWidth = s * 0.002;
  ctx.strokeRect(inset + r * 0.6, inset + r * 0.6, w - 2 * inset - r * 1.2, h - 2 * inset - r * 1.2);
  ctx.restore();
}

/** Stepped art-deco corners with fan rays. */
function deco(ctx: CanvasRenderingContext2D, w: number, h: number, m: number, t: Theme) {
  const s = Math.min(w, h), inset = m * 1.2;
  ctx.save();
  ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.004;
  ctx.strokeRect(inset, inset, w - 2 * inset, h - 2 * inset);
  ctx.lineWidth = s * 0.002;
  ctx.strokeRect(inset + m * 0.5, inset + m * 0.5, w - 2 * inset - m, h - 2 * inset - m);
  for (const [cx, cy, sx, sy] of [[inset, inset, 1, 1], [w - inset, inset, -1, 1], [inset, h - inset, 1, -1], [w - inset, h - inset, -1, -1]]) {
    ctx.lineWidth = s * 0.004;
    for (let k = 1; k <= 3; k++) {
      const d = s * 0.035 * k;
      ctx.beginPath(); ctx.moveTo(cx + sx * d, cy); ctx.lineTo(cx + sx * d, cy + sy * d); ctx.lineTo(cx, cy + sy * d); ctx.stroke();
    }
    ctx.lineWidth = s * 0.0018;
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(cx + sx * s * 0.12, cy + sy * s * 0.12);
      ctx.lineTo(cx + sx * (s * 0.12 + Math.cos(a) * s * 0.09), cy + sy * (s * 0.12 + Math.sin(a) * s * 0.09)); ctx.stroke();
    }
  }
  ctx.fillStyle = t.accent;
  for (const y of [inset, h - inset]) {
    ctx.beginPath(); ctx.moveTo(w / 2, y - s * 0.02); ctx.lineTo(w / 2 + s * 0.03, y); ctx.lineTo(w / 2, y + s * 0.02); ctx.lineTo(w / 2 - s * 0.03, y); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/** Carved temple pillars on both sides with a lintel and bells. */
function temple(ctx: CanvasRenderingContext2D, w: number, h: number, m: number, t: Theme) {
  const s = Math.min(w, h), pw = s * 0.07, top = m * 1.3, bottom = h - m * 1.3;
  ctx.save();
  ctx.fillStyle = t.accent; ctx.strokeStyle = t.accent;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(m, top, w - 2 * m, s * 0.018);
  ctx.fillRect(m * 1.6, top + s * 0.03, w - 3.2 * m, s * 0.006);
  ctx.globalAlpha = 1;
  for (const x of [m * 1.2, w - m * 1.2 - pw]) {
    ctx.lineWidth = s * 0.003;
    ctx.strokeRect(x, top + s * 0.04, pw, bottom - top - s * 0.04);
    ctx.fillRect(x - pw * 0.2, top + s * 0.04, pw * 1.4, s * 0.02);
    ctx.fillRect(x - pw * 0.2, bottom - s * 0.025, pw * 1.4, s * 0.025);
    const n = Math.max(4, Math.round((bottom - top) / (s * 0.16)));
    for (let k = 1; k < n; k++) {
      const y = top + s * 0.04 + (k / n) * (bottom - top - s * 0.07);
      ctx.lineWidth = s * 0.002;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + pw, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + pw / 2, y - s * 0.03); ctx.lineTo(x + pw * 0.8, y - s * 0.06); ctx.lineTo(x + pw / 2, y - s * 0.09); ctx.lineTo(x + pw * 0.2, y - s * 0.06); ctx.closePath(); ctx.stroke();
    }
  }
  const bells = Math.max(3, Math.round(w / (s * 0.25)));
  for (let i = 1; i < bells; i++) {
    const bx = m * 1.2 + pw + (i / bells) * (w - 2.4 * m - 2 * pw), by = top + s * 0.08 + (i % 2) * s * 0.03;
    ctx.lineWidth = s * 0.0018; ctx.beginPath(); ctx.moveTo(bx, top + s * 0.036); ctx.lineTo(bx, by); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx - s * 0.014, by + s * 0.024); ctx.quadraticCurveTo(bx - s * 0.014, by, bx, by); ctx.quadraticCurveTo(bx + s * 0.014, by, bx + s * 0.014, by + s * 0.024); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

export type Emblem = "mandala" | "lotus" | "kalash" | "peacock" | "rings" | "diya" | "shehnai" | "none";
export const EMBLEMS: [Emblem, string][] = [
  ["mandala", "Mandala"], ["lotus", "Lotus"], ["kalash", "Kalash"], ["peacock", "Peacock feather"],
  ["rings", "Rings"], ["diya", "Diya"], ["shehnai", "Shehnai pair"], ["none", "None"],
];

/** The ornament at the top of a card, centred on (cx, cy), about 2r wide. */
export function emblem(ctx: CanvasRenderingContext2D, kind: Emblem, cx: number, cy: number, r: number, t: Theme) {
  ctx.save();
  if (kind === "mandala") mandala(ctx, cx, cy, r, t);
  else if (kind === "lotus") {
    const layers: [number, number, number, string][] = [[7, 1.05, 0.34, t.soft], [5, 0.95, 0.36, t.accent], [3, 0.8, 0.3, t.soft]];
    for (const [n, len, wid, col] of layers) for (let i = 0; i < n; i++) {
      const a = ((i - (n - 1) / 2) / n) * Math.PI * 0.95;
      ctx.save(); ctx.translate(cx, cy + r * 0.45); ctx.rotate(a);
      petal(ctx, r * len, r * wid); ctx.fillStyle = col; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = t.accent; ctx.lineWidth = r * 0.02; ctx.stroke(); ctx.restore();
    }
    ctx.fillStyle = t.accent; ctx.fillRect(cx - r * 0.7, cy + r * 0.5, r * 1.4, r * 0.05);
  } else if (kind === "kalash") {
    ctx.fillStyle = t.accent;
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.35, r * 0.55, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(cx - r * 0.22, cy - r * 0.25, r * 0.44, r * 0.3);
    ctx.fillStyle = t.soft; ctx.fillRect(cx - r * 0.55, cy + r * 0.25, r * 1.1, r * 0.08);
    for (let i = -2; i <= 2; i++) { ctx.save(); ctx.translate(cx + i * r * 0.13, cy - r * 0.25); ctx.rotate(i * 0.38); petal(ctx, r * 0.45, r * 0.14); ctx.fillStyle = "#3d8b40"; ctx.fill(); ctx.restore(); }
    ctx.fillStyle = "#b5651d"; ctx.beginPath(); ctx.arc(cx, cy - r * 0.5, r * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = t.bg[1]; ctx.lineWidth = r * 0.04;
    ctx.beginPath(); ctx.arc(cx, cy + r * 0.45, r * 0.16, 0, Math.PI * 2); ctx.stroke();
  } else if (kind === "peacock") {
    ctx.translate(cx, cy); ctx.rotate(-0.25);
    ctx.strokeStyle = t.accent; ctx.lineWidth = r * 0.03;
    ctx.beginPath(); ctx.moveTo(0, r * 1.05); ctx.quadraticCurveTo(r * 0.1, 0, 0, -r * 0.9); ctx.stroke();
    ctx.lineWidth = r * 0.01;
    for (let k = 0; k < 16; k++) {
      const y = r * 0.9 - k * r * 0.11, l = r * (0.25 + 0.25 * Math.sin((k / 16) * Math.PI));
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sd * l, y - r * 0.12); ctx.stroke(); }
    }
    ctx.fillStyle = "#1f8a6e"; ctx.beginPath(); ctx.ellipse(0, -r * 0.45, r * 0.36, r * 0.48, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = t.accent; ctx.beginPath(); ctx.ellipse(0, -r * 0.42, r * 0.24, r * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1d4fa8"; ctx.beginPath(); ctx.ellipse(0, -r * 0.4, r * 0.14, r * 0.19, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#0b1d3a"; ctx.beginPath(); ctx.ellipse(0, -r * 0.38, r * 0.06, r * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  } else if (kind === "rings") {
    ctx.lineWidth = r * 0.12;
    ctx.strokeStyle = t.accent; ctx.beginPath(); ctx.arc(cx - r * 0.3, cy + r * 0.1, r * 0.48, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = t.soft; ctx.beginPath(); ctx.arc(cx + r * 0.3, cy + r * 0.1, r * 0.48, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#eaf6ff";
    ctx.beginPath(); ctx.moveTo(cx - r * 0.3, cy - r * 0.62); ctx.lineTo(cx - r * 0.16, cy - r * 0.42); ctx.lineTo(cx - r * 0.3, cy - r * 0.3); ctx.lineTo(cx - r * 0.44, cy - r * 0.42); ctx.closePath(); ctx.fill();
  } else if (kind === "diya") {
    const g = ctx.createRadialGradient(cx, cy - r * 0.3, 0, cx, cy - r * 0.3, r * 1.2);
    g.addColorStop(0, "rgba(255,200,80,0.55)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(cx - r * 1.2, cy - r * 1.5, r * 2.4, r * 2.4);
    ctx.fillStyle = "#ffd75e";
    ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.95); ctx.quadraticCurveTo(cx + r * 0.25, cy - r * 0.4, cx, cy - r * 0.15); ctx.quadraticCurveTo(cx - r * 0.25, cy - r * 0.4, cx, cy - r * 0.95); ctx.fill();
    ctx.fillStyle = t.accent;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.8, cy - r * 0.05); ctx.quadraticCurveTo(cx, cy + r * 0.75, cx + r * 0.8, cy - r * 0.05); ctx.closePath(); ctx.fill();
  } else if (kind === "shehnai") {
    for (const sd of [-1, 1]) {
      ctx.save(); ctx.translate(cx, cy + r * 0.1); ctx.rotate(sd * 0.55);
      ctx.fillStyle = t.accent;
      ctx.beginPath(); ctx.moveTo(-r * 0.05, -r * 0.9); ctx.lineTo(r * 0.05, -r * 0.9); ctx.lineTo(r * 0.12, r * 0.45); ctx.lineTo(-r * 0.12, r * 0.45); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-r * 0.12, r * 0.4); ctx.quadraticCurveTo(0, r * 0.55, r * 0.12, r * 0.4); ctx.lineTo(r * 0.3, r * 0.8); ctx.lineTo(-r * 0.3, r * 0.8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = t.bg[1];
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(0, -r * 0.5 + k * r * 0.2, r * 0.03, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Ready-made looks: one click sets colour theme, frame and emblem together. */
export interface StylePreset { id: string; name: string; theme: string; frame: Frame; emblem: Emblem }
export const STYLE_PRESETS: StylePreset[] = [
  { id: "rajwada", name: "Royal Rajwada", theme: "royal", frame: "arch", emblem: "mandala" },
  { id: "temple", name: "South Indian Temple", theme: "kumkum", frame: "temple", emblem: "kalash" },
  { id: "marigold", name: "Marigold Mela", theme: "haldi", frame: "garland", emblem: "kalash" },
  { id: "peacock", name: "Peacock Palace", theme: "peacock", frame: "arch", emblem: "peacock" },
  { id: "lotus", name: "Lotus Ivory", theme: "ivory", frame: "ornate", emblem: "lotus" },
  { id: "pastel", name: "Pastel Lace", theme: "lilac", frame: "scallop", emblem: "lotus" },
  { id: "blush", name: "Blush Garden", theme: "blush", frame: "scallop", emblem: "rings" },
  { id: "rose", name: "Rose Gold Modern", theme: "rosegold", frame: "deco", emblem: "rings" },
  { id: "gatsby", name: "Black Tie Deco", theme: "black", frame: "deco", emblem: "rings" },
  { id: "navy", name: "Navy Elegance", theme: "navy", frame: "deco", emblem: "lotus" },
  { id: "purple", name: "Purple Durbar", theme: "purple", frame: "temple", emblem: "mandala" },
  { id: "mehndi", name: "Mehndi Vines", theme: "mehndi", frame: "ornate", emblem: "peacock" },
  { id: "sage", name: "Sage Minimal", theme: "sage", frame: "simple", emblem: "lotus" },
  { id: "saffron", name: "Saffron Festive", theme: "saffron", frame: "garland", emblem: "diya" },
  { id: "teal", name: "Teal Coral", theme: "teal", frame: "scallop", emblem: "peacock" },
  { id: "wine", name: "Wine Romance", theme: "wine", frame: "ornate", emblem: "rings" },
  { id: "shehnai", name: "Baaraat Shehnai", theme: "royal", frame: "temple", emblem: "shehnai" },
  { id: "mint", name: "Mint Fresh", theme: "mint", frame: "simple", emblem: "kalash" },
  { id: "sky", name: "Sky Breeze", theme: "sky", frame: "scallop", emblem: "lotus" },
  { id: "classic", name: "Classic White", theme: "minimal", frame: "simple", emblem: "mandala" },
];

/** Pillars and a cusped (Mughal / temple) arch, with hanging bells and a marigold garland. */
function mandap(ctx: CanvasRenderingContext2D, w: number, h: number, m: number, t: Theme) {
  const L = m * 1.6, R = w - m * 1.6, B = h - m * 1.4, shoulder = h * (w > h ? 0.3 : 0.24), apex = m * 1.4;
  const cx = w / 2, half = (R - L) / 2;
  const path = (inset: number) => {
    ctx.beginPath();
    ctx.moveTo(L + inset, B);
    ctx.lineTo(L + inset, shoulder);
    // three lobes up to the pointed top, mirrored
    const lobes = 3;
    for (let i = 1; i <= lobes; i++) {
      const fx = (i / lobes) * (half - inset), x = L + inset + fx;
      const y = shoulder - (shoulder - apex - inset) * Math.sin((i / lobes) * Math.PI / 2);
      const px = L + inset + ((i - 1) / lobes) * (half - inset), py = shoulder - (shoulder - apex - inset) * Math.sin(((i - 1) / lobes) * Math.PI / 2);
      ctx.quadraticCurveTo((px + x) / 2 - (y - py) * 0.25, (py + y) / 2 - half * 0.06, x, y);
    }
    for (let i = lobes - 1; i >= 0; i--) {
      const fx = (i / lobes) * (half - inset), x = R - inset - fx;
      const y = shoulder - (shoulder - apex - inset) * Math.sin((i / lobes) * Math.PI / 2);
      const px = R - inset - ((i + 1) / lobes) * (half - inset), py = shoulder - (shoulder - apex - inset) * Math.sin(((i + 1) / lobes) * Math.PI / 2);
      ctx.quadraticCurveTo((px + x) / 2 + (py - y) * 0.25, (py + y) / 2 - half * 0.06, x, y);
    }
    ctx.lineTo(R - inset, B);
  };
  ctx.save();
  ctx.strokeStyle = t.accent; ctx.lineJoin = "round";
  ctx.lineWidth = Math.min(w, h) * 0.008; path(0); ctx.stroke();
  ctx.lineWidth = Math.min(w, h) * 0.0025; path(m * 0.5); ctx.stroke();
  ctx.lineWidth = Math.min(w, h) * 0.006; ctx.beginPath(); ctx.moveTo(L - m * 0.3, B); ctx.lineTo(R + m * 0.3, B); ctx.stroke();
  // pillar bands
  for (const x of [L, R]) for (const y of [shoulder + h * 0.05, B - h * 0.06]) {
    ctx.fillStyle = t.accent; ctx.fillRect(x - m * 0.45, y, m * 0.9, m * 0.35);
  }
  // garland along the shoulders and hanging bells
  const s = Math.min(w, h);
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? L + m * 0.5 : R - m * 0.5;
    for (let k = 0; k < 9; k++) {
      ctx.fillStyle = k % 2 ? t.soft : t.accent;
      ctx.beginPath(); ctx.arc(x0 + side * -k * s * 0.004, shoulder + k * s * 0.022, s * 0.011, 0, Math.PI * 2); ctx.fill();
    }
    const bx = cx + side * half * 0.62, by = apex + (shoulder - apex) * 0.6;
    ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.002;
    ctx.beginPath(); ctx.moveTo(bx, by - s * 0.07); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = t.accent;
    ctx.beginPath(); ctx.moveTo(bx - s * 0.018, by + s * 0.03); ctx.quadraticCurveTo(bx - s * 0.018, by, bx, by); ctx.quadraticCurveTo(bx + s * 0.018, by, bx + s * 0.018, by + s * 0.03); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(bx, by + s * 0.034, s * 0.005, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function divider(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number, t: Theme) {
  ctx.save();
  ctx.strokeStyle = t.accent; ctx.fillStyle = t.accent; ctx.lineWidth = Math.max(1.5, w * 0.006);
  ctx.beginPath(); ctx.moveTo(cx - w / 2, y); ctx.lineTo(cx - w * 0.06, y); ctx.moveTo(cx + w * 0.06, y); ctx.lineTo(cx + w / 2, y); ctx.stroke();
  const d = w * 0.035;
  ctx.beginPath(); ctx.moveTo(cx, y - d); ctx.lineTo(cx + d, y); ctx.lineTo(cx, y + d); ctx.lineTo(cx - d, y); ctx.closePath(); ctx.fill();
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sx * w * 0.5, y, d * 0.35, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

export function drawQr(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, t: Theme) {
  const q = qrcode(0, "M");
  q.addData(unescape(encodeURIComponent(text))); // UTF-8 bytes
  q.make();
  const n = q.getModuleCount(), pad = size * 0.06, cell = (size - pad * 2) / n;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = t.accent; ctx.lineWidth = 2; ctx.strokeRect(x, y, size, size);
  ctx.fillStyle = "#111111";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(x + pad + c * cell, y + pad + r * cell, Math.ceil(cell), Math.ceil(cell));
}

export function photoCircle(ctx: CanvasRenderingContext2D, img: Pic, cx: number, cy: number, r: number, t: Theme) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  // soft backdrop, seen only where the photo's background was removed
  const bd = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
  bd.addColorStop(0, t.soft); bd.addColorStop(1, t.accent);
  ctx.globalAlpha = 0.55; ctx.fillStyle = bd; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); ctx.globalAlpha = 1;
  const s = Math.max((2 * r) / img.width, (2 * r) / img.height);
  ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2 * 0.9, img.width * s, img.height * s);
  ctx.restore();
  ctx.strokeStyle = t.accent; ctx.lineWidth = r * 0.06;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = r * 0.015;
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.08, 0, Math.PI * 2); ctx.stroke();
}

// ---------------------------------------------------------------- the designs

export function sizeOf(kind: Kind, vertical = false): [number, number] {
  return vertical ? [1080, 1920] : KINDS[kind].size;
}

// ---------------------------------------------------------------- on-card editing
// Every text line and picture is drawn through say() / place(), which apply the user's changes
// (moved, resized, recoloured, rewritten, hidden) and record where it landed so it can be clicked.

export interface Override { dx?: number; dy?: number; scale?: number; text?: string; color?: string; hidden?: boolean }
export type Overrides = Record<string, Override>;
export interface Item { id: string; x: number; y: number; w: number; h: number; text?: string; box?: boolean }

let OV: Overrides = {};
let REC: Item[] | null = null;

/** Run a drawing with the user's changes applied; returns the items it drew. */
export function edited(ov: Overrides | undefined, fn: () => void): Item[] {
  const po = OV, pr = REC, rec: Item[] = [];
  OV = ov ?? {}; REC = rec;
  try { fn(); } finally { OV = po; REC = pr; }
  return rec;
}

/** Run a measuring pass that must not be recorded. */
export function quiet<T>(fn: () => T): T {
  const r = REC; REC = null;
  try { return fn(); } finally { REC = r; }
}

export function say(ctx: CanvasRenderingContext2D, id: string, text: string, x: number, y: number) {
  const o = OV[id];
  const str = o?.text ?? text;
  if (o?.hidden || !str) return;
  ctx.save();
  if (o?.scale) ctx.font = ctx.font.replace(/([\d.]+)px/, (_, px) => `${parseFloat(px) * o.scale!}px`);
  if (o?.color) ctx.fillStyle = o.color;
  const X = x + (o?.dx ?? 0), Y = y + (o?.dy ?? 0);
  ctx.fillText(str, X, Y);
  if (REC) {
    const m = ctx.measureText(str);
    const left = ctx.textAlign === "center" ? X - m.width / 2 : ctx.textAlign === "right" || ctx.textAlign === "end" ? X - m.width : X;
    const asc = m.actualBoundingBoxAscent || parseFloat(ctx.font.match(/([\d.]+)px/)?.[1] ?? "20") * 0.8;
    REC.push({ id, x: left, y: Y - asc, w: m.width, h: asc + (m.actualBoundingBoxDescent || 0), text: str });
  }
  ctx.restore();
}

/** Where a picture (photo, QR) goes after the user's move / resize; `hidden` when removed. */
export function place(id: string, x: number, y: number, w: number, h: number) {
  const o = OV[id], s = o?.scale ?? 1;
  const r = { x: x + (w - w * s) / 2 + (o?.dx ?? 0), y: y + (h - h * s) / 2 + (o?.dy ?? 0), w: w * s, h: h * s, hidden: !!o?.hidden };
  if (REC && !r.hidden) REC.push({ id, x: r.x, y: r.y, w: r.w, h: r.h, box: true });
  return r;
}

/** Draw one design. `vertical` = WhatsApp status / story size (1080x1920). Returns the editable items. */
export function draw(ctx: CanvasRenderingContext2D, kind: Kind, d: Details, photo: Pic | null, vertical = false, ov?: Overrides): Item[] {
  return edited(ov, () => drawInner(ctx, kind, d, photo, vertical));
}

function drawInner(ctx: CanvasRenderingContext2D, kind: Kind, d: Details, photo: Pic | null, vertical: boolean) {
  const [w, h] = sizeOf(kind, vertical);
  const t = theme(d.theme);
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  background(ctx, w, h, t, kind === "car" ? "ornate" : d.frame);
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  if (kind === "car") return drawCar(ctx, w, h, d, t), ctx.restore();
  const info = KINDS[kind];
  const hi = d.lang !== "en", en = d.lang !== "hi";
  const cx = w / 2, inner = w * 0.72;
  const U = w / 1080; // unit: 1px of a 1080-wide card
  const top = h * (vertical ? 0.1 : 0.085);
  const foot = h - h * 0.075;
  const qrSize = 150 * U;
  const hasQr = !!d.qr && kind !== "welcome" && kind !== "thanks";
  // lay the content out once off-screen; if it runs into the footer (QR / RSVP), shrink it to fit
  const limit = foot - (hasQr ? qrSize + 72 * U : 46 * U);
  const scratch = document.createElement("canvas").getContext("2d")!;
  scratch.textAlign = "center";
  const end = quiet(() => body(scratch, 1));
  body(ctx, end > limit ? Math.max(0.55, (limit - top) / (end - top)) : 1);

  // footer: RSVP + QR
  const u = U;
  if (hasQr) {
    const q = place("qr", cx - qrSize / 2, foot - qrSize - 30 * u, qrSize, qrSize);
    if (!q.hidden) drawQr(ctx, d.qr, q.x, q.y, q.w, t);
    ctx.fillStyle = t.soft; ctx.font = `400 ${20 * u}px ${SERIF}`;
    say(ctx, "qrlabel", hi && !en ? "स्थान / RSVP के लिए स्कैन करें" : "Scan for location / RSVP", cx, foot - qrSize - 42 * u);
  }
  if ((d.rsvp || (kind === "thanks" && d.host)) && kind !== "welcome") {
    ctx.fillStyle = t.ink; ctx.font = `400 ${24 * u}px ${SERIF}`;
    const line = kind === "thanks" ? (d.host ? `${en ? "With love," : "सप्रेम,"} ${d.host}` : "") : `${hi && !en ? "संपर्क" : "RSVP"}: ${d.rsvp}`;
    say(ctx, "rsvp", line, cx, foot + 6 * u);
  }
  ctx.restore();

  /** Draws everything between the top and the footer at scale `k`; returns where it ended. */
  function body(ctx: CanvasRenderingContext2D, k: number): number {
    const u = U * k;
    let y = top;
    const lines = (id: string, text: string, step: number, dy = 0) => {
      wrap(ctx, text, inner).forEach((l, i) => { say(ctx, `${id}.${i}`, l, cx, y + dy); y += step; });
    };

    if (d.blessing && kind !== "thanks") {
      ctx.fillStyle = t.accent;
      fit(ctx, "॥ ॐ श्री गणेशाय नमः ॥", (px) => `600 ${px}px ${SERIF}`, 34 * u, inner);
      say(ctx, "blessing", "॥ ॐ श्री गणेशाय नमः ॥", cx, y);
      y += 30 * u;
    }
    emblem(ctx, d.emblem ?? "mandala", cx, y + 70 * u, 62 * u, t);
    y += 175 * u;

    // title
    ctx.fillStyle = t.accent;
    if (hi) { fit(ctx, info.hi, (px) => `700 ${px}px ${SERIF}`, (kind === "welcome" ? 110 : 66) * u, inner); say(ctx, "title.hi", info.hi, cx, y); y += (kind === "welcome" ? 90 : 62) * u; }
    if (en) {
      const big = kind === "welcome" || kind === "thanks";
      const title = big ? info.en : info.en.toUpperCase();
      const font = (px: number) => (hi ? `400 ${px}px ${SERIF}` : big ? `${px}px ${SCRIPT}` : `700 ${px}px ${SERIF}`);
      if (!hi && !big) ctx.letterSpacing = `${6 * u}px`;
      fit(ctx, title, font, (hi ? 30 : big ? 110 : 52) * u, inner);
      say(ctx, "title.en", title, cx, y);
      ctx.letterSpacing = "0px";
      y += (hi ? 40 : 70) * u;
    }
    divider(ctx, cx, y, inner * 0.7, t);
    y += 60 * u;

    // invite line
    ctx.fillStyle = t.ink;
    if (kind !== "thanks" && en) {
      ctx.font = `italic 400 ${30 * u}px ${SERIF}`;
      const before = y;
      lines("invite", kind === "welcome" ? info.inviteEn : `${d.host || "Together with their families"}, ${info.inviteEn}`, 42 * u);
      if (y > before) y += 20 * u;
    }

    // couple photo
    if (photo) {
      const r = (kind === "welcome" ? 170 : 120) * u;
      const b = place("photo", cx - r, y, r * 2, r * 2);
      if (!b.hidden) photoCircle(ctx, photo, b.x + b.w / 2, b.y + b.h / 2, b.w / 2, t);
      y += r * 2 + (kind === "welcome" ? 70 : 60) * u;
    }

    // names
    const bride = (hi && !en ? d.brideHi || d.bride : d.bride) || "Bride";
    const groom = (hi && !en ? d.groomHi || d.groom : d.groom) || "Groom";
    const first = kind === "tilak" ? groom : bride;
    const second = kind === "tilak" ? bride : groom;
    const nameFont = (px: number) => (hi && !en ? `700 ${px}px ${SERIF}` : `${px}px ${SCRIPT}`);
    const np = fit(ctx, first.length > second.length ? first : second, nameFont, 120 * u, inner);
    ctx.fillStyle = t.accent;
    ctx.font = nameFont(np);
    say(ctx, "name1", first, cx, y + np * 0.4); y += np * 0.9;
    ctx.font = `400 ${46 * u}px ${SERIF}`; ctx.fillStyle = t.soft;
    say(ctx, "amp", hi && !en ? "संग" : "&", cx, y + 10 * u); y += 50 * u;
    ctx.font = nameFont(np); ctx.fillStyle = t.accent;
    say(ctx, "name2", second, cx, y + np * 0.45); y += np * 0.8 + 16 * u;
    if (hi && en && (d.brideHi || d.groomHi)) {
      ctx.font = `600 ${36 * u}px ${SERIF}`; ctx.fillStyle = t.soft;
      const pair = kind === "tilak" ? [d.groomHi || d.groom, d.brideHi || d.bride] : [d.brideHi || d.bride, d.groomHi || d.groom];
      say(ctx, "pair", `${pair[0]} संग ${pair[1]}`, cx, y + 10 * u); y += 50 * u;
    }
    y += 10 * u;

    if (hi && kind !== "thanks" && kind !== "welcome") {
      ctx.fillStyle = t.ink; ctx.font = `400 ${30 * u}px ${SERIF}`;
      lines("inviteHi", info.inviteHi, 42 * u, 20 * u);
      y += 10 * u;
    }

    // parents
    if (kind !== "welcome" && kind !== "thanks" && (d.brideParents || d.groomParents)) {
      ctx.fillStyle = t.ink; ctx.font = `400 ${26 * u}px ${SERIF}`;
      const ps = [
        ["bp", d.brideParents && (en ? `D/o ${d.brideParents}` : `सुपुत्री ${d.brideParents}`)],
        ["gp", d.groomParents && (en ? `S/o ${d.groomParents}` : `सुपुत्र ${d.groomParents}`)],
      ].filter((x) => x[1]) as [string, string][];
      if (kind === "tilak") ps.reverse();
      for (const [id, l] of ps) lines(id, l, 36 * u, 20 * u);
      y += 14 * u;
    }

    if (kind === "thanks") {
      ctx.fillStyle = t.ink; ctx.font = `400 ${32 * u}px ${SERIF}`;
      y += 20 * u;
      if (hi) lines("thanks.hi", info.inviteHi, 46 * u);
      if (en) lines("thanks.en", info.inviteEn, 46 * u);
    }

    // date / time / venue
    if (info.event || kind === "welcome") {
      const ev = eventOf(d, kind);
      divider(ctx, cx, y + 12 * u, inner * 0.5, t);
      y += 66 * u;
      ctx.fillStyle = t.accent;
      const dateLine = [formatDate(ev.date, hi && !en), formatTime(ev.time, hi && !en)].filter(Boolean).join(" · ");
      fit(ctx, dateLine, (px) => `700 ${px}px ${SERIF}`, 38 * u, inner);
      if (dateLine) { say(ctx, "date", dateLine, cx, y); y += 52 * u; }
      if (hi && en && ev.date) {
        ctx.fillStyle = t.soft; ctx.font = `400 ${28 * u}px ${SERIF}`;
        say(ctx, "date.hi", [formatDate(ev.date, true), formatTime(ev.time, true)].filter(Boolean).join(" · "), cx, y); y += 44 * u;
      }
      ctx.fillStyle = t.ink; ctx.font = `600 ${32 * u}px ${SERIF}`;
      lines("venue", ev.venue, 42 * u);
      if (d.address && kind !== "welcome") {
        ctx.font = `400 ${26 * u}px ${SERIF}`;
        lines("addr", d.address, 36 * u);
      }
    }
    return y;
  }
}

function drawCar(ctx: CanvasRenderingContext2D, w: number, h: number, d: Details, t: Theme) {
  const hi = d.lang !== "en", en = d.lang !== "hi";
  mandala(ctx, h * 0.42, h / 2, h * 0.26, t);
  mandala(ctx, w - h * 0.42, h / 2, h * 0.26, t);
  ctx.fillStyle = t.accent;
  const title = en ? "Just Married" : "शुभ विवाह";
  fit(ctx, title, (px) => (en ? `${px}px ${SCRIPT}` : `700 ${px}px ${SERIF}`), h * 0.32, w * 0.54);
  say(ctx, "title", title, w / 2, h * 0.45);
  const names = hi && !en ? `${d.groomHi || d.groom} संग ${d.brideHi || d.bride}` : `${d.groom || "Groom"} weds ${d.bride || "Bride"}`;
  ctx.fillStyle = t.ink;
  fit(ctx, names, (px) => `600 ${px}px ${SERIF}`, h * 0.13, w * 0.6);
  say(ctx, "names", names, w / 2, h * 0.68);
  if (hi && en && (d.brideHi || d.groomHi)) {
    ctx.fillStyle = t.soft;
    fit(ctx, "शुभ विवाह", (px) => `600 ${px}px ${SERIF}`, h * 0.09, w * 0.6);
    say(ctx, "names.hi", `शुभ विवाह · ${d.groomHi || d.groom} संग ${d.brideHi || d.bride}`, w / 2, h * 0.84);
  }
}

/** Draw a design onto a fresh canvas. */
export function render(kind: Kind, d: Details, photo: Pic | null, vertical = false, ov?: Overrides): HTMLCanvasElement {
  const [w, h] = sizeOf(kind, vertical);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!, kind, d, photo, vertical, ov);
  return c;
}

// ---------------------------------------------------------------- invitation video

export type Music = { kind: "none" } | { kind: "tune"; tune: "shehnai" | "bells" | "dhol" } | { kind: "file"; data: ArrayBuffer };

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** A short royalty-free tune generated on the spot (nothing to license). */
function scheduleTune(ac: BaseAudioContext, out: AudioNode, tune: "shehnai" | "bells" | "dhol", seconds: number) {
  const t0 = ac.currentTime + 0.05;
  // drone: Sa + Pa, like a tanpura
  if (tune !== "dhol") for (const n of [48, 55]) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "sawtooth"; o.frequency.value = midi(n);
    const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 600;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.035, t0 + 1.5); g.gain.setValueAtTime(0.035, t0 + seconds - 1.5); g.gain.linearRampToValueAtTime(0, t0 + seconds);
    o.connect(f).connect(g).connect(out); o.start(t0); o.stop(t0 + seconds);
  }
  // melody on the Bhupali scale (Sa Re Ga Pa Dha)
  const scale = [60, 62, 64, 67, 69, 72, 74, 76];
  const phrase = [0, 2, 3, 4, 3, 2, 1, 0, 2, 4, 5, 4, 3, 2, 3, 0];
  const beat = tune === "bells" ? 0.42 : tune === "dhol" ? 0.3 : 0.55;
  let i = 0;
  for (let t = 0.6; t < seconds - 1; t += beat, i++) {
    const at = t0 + t;
    if (tune === "dhol") {
      // dha / na drum pattern: low thump on 1 and 3, high tap otherwise
      const low = i % 4 === 0 || i % 8 === 6;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(low ? 110 : 320, at); o.frequency.exponentialRampToValueAtTime(low ? 50 : 180, at + 0.15);
      g.gain.setValueAtTime(low ? 0.6 : 0.25, at); g.gain.exponentialRampToValueAtTime(0.001, at + (low ? 0.35 : 0.12));
      o.connect(g).connect(out); o.start(at); o.stop(at + 0.4);
      if (i % 2 === 0) {
        const n = scale[phrase[(i / 2) % phrase.length]] + 12;
        const m = ac.createOscillator(), mg = ac.createGain();
        m.type = "triangle"; m.frequency.value = midi(n);
        mg.gain.setValueAtTime(0.08, at); mg.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
        m.connect(mg).connect(out); m.start(at); m.stop(at + 0.55);
      }
      continue;
    }
    const n = scale[phrase[i % phrase.length]] + (tune === "bells" ? 12 : 0);
    const len = tune === "bells" ? 1.6 : beat * (i % 4 === 3 ? 2 : 1.05);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = tune === "bells" ? "sine" : "square";
    o.frequency.setValueAtTime(midi(n), at);
    if (tune === "shehnai") {
      // reedy tone with a slight slide and vibrato
      o.frequency.setValueAtTime(midi(n) * 0.97, at); o.frequency.linearRampToValueAtTime(midi(n), at + 0.08);
      const lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = 5.5; lg.gain.value = midi(n) * 0.008;
      lfo.connect(lg).connect(o.frequency); lfo.start(at); lfo.stop(at + len);
    }
    const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = tune === "bells" ? 4000 : 1800;
    const peak = tune === "bells" ? 0.16 : 0.07;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + 0.02);
    g.gain.exponentialRampToValueAtTime(tune === "bells" ? 0.001 : peak * 0.6, at + len * 0.9);
    g.gain.linearRampToValueAtTime(0, at + len);
    o.connect(f).connect(g).connect(out); o.start(at); o.stop(at + len + 0.05);
    if (tune === "bells") { // bell overtone
      const o2 = ac.createOscillator(), g2 = ac.createGain();
      o2.frequency.value = midi(n) * 2.76; g2.gain.setValueAtTime(0.04, at); g2.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      o2.connect(g2).connect(out); o2.start(at); o2.stop(at + 0.65);
    }
  }
}

const probed = new Map<string, boolean>();

/**
 * First recording format that really works. Some browsers (and Electron builds without AAC) say they
 * support MP4 + AAC but the encoder fails, so each candidate is tried for a moment first.
 */
async function workingMime(types: string[], withAudio: boolean): Promise<string | undefined> {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of types) {
    if (!MediaRecorder.isTypeSupported(m)) continue;
    if (!probed.has(m)) probed.set(m, await probe(m, withAudio));
    if (probed.get(m)) return m;
  }
  return undefined;
}

async function probe(mime: string, withAudio: boolean): Promise<boolean> {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const x = c.getContext("2d")!;
  const stream = c.captureStream(30);
  let ac: AudioContext | null = null;
  try {
    if (withAudio) {
      ac = new AudioContext();
      const dest = ac.createMediaStreamDestination(), g = ac.createGain(), o = ac.createOscillator();
      g.gain.value = 0; o.connect(g).connect(dest); o.start();
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    }
    const rec = new MediaRecorder(stream, { mimeType: mime });
    let bytes = 0, failed = false;
    rec.ondataavailable = (e) => { bytes += e.data.size; };
    rec.onerror = () => { failed = true; };
    const stopped = new Promise<void>((res) => (rec.onstop = () => res()));
    rec.start(100);
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? "#000" : "#fff"; x.fillRect(0, 0, 64, 64); await new Promise((r) => setTimeout(r, 40)); }
    if (rec.state !== "inactive") rec.stop();
    await Promise.race([stopped, new Promise((r) => setTimeout(r, 1500))]);
    return !failed && bytes > 0;
  } catch {
    return false;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    await ac?.close().catch(() => undefined);
  }
}

interface Petal { x: number; y: number; r: number; vy: number; vx: number; a: number; va: number; c: string }

/**
 * Records an animated slideshow of the chosen designs (vertical, 720x1280) with fades, a slow zoom,
 * falling petals and optional music. Returns MP4 where the browser records MP4, else WebM.
 */
export async function recordVideo(
  frames: HTMLCanvasElement[], seconds: number, onProgress: (p: number) => void,
  opts: { music?: Music; petals?: string[] } = {},
): Promise<{ blob: Blob; ext: string }> {
  const W = 720, H = 1280;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const music = opts.music ?? { kind: "none" };
  const withAudio = music.kind !== "none";
  const types = withAudio
    ? ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1,opus", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mime = await workingMime(types, withAudio);
  if (!mime) throw new Error("This browser cannot record video. Try Chrome or Edge.");

  const stream = c.captureStream(30);
  let ac: AudioContext | null = null;
  if (withAudio) {
    ac = new AudioContext();
    await ac.resume();
    const dest = ac.createMediaStreamDestination();
    const master = ac.createGain();
    master.connect(dest);
    if (music.kind === "tune") scheduleTune(ac, master, music.tune, seconds);
    else {
      const buf = await ac.decodeAudioData(music.data.slice(0)).catch(() => { throw new Error("That song file could not be read. Try an MP3 or M4A file."); });
      const src = ac.createBufferSource();
      src.buffer = buf; src.loop = buf.duration < seconds;
      const t0 = ac.currentTime;
      master.gain.setValueAtTime(0, t0); master.gain.linearRampToValueAtTime(0.9, t0 + 1);
      master.gain.setValueAtTime(0.9, t0 + seconds - 2); master.gain.linearRampToValueAtTime(0, t0 + seconds);
      src.connect(master); src.start(t0); src.stop(t0 + seconds + 0.1);
    }
    for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
  }

  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  let failure: unknown = null;
  rec.onerror = (e) => { failure = (e as unknown as { error?: unknown }).error ?? e; };
  const done = new Promise<void>((res) => (rec.onstop = () => res()));
  const per = (seconds * 1000) / frames.length, fade = Math.min(700, per * 0.3);
  const paint = (f: HTMLCanvasElement, local: number) => {
    const z = 1 + 0.06 * (local / per); // slow zoom in
    const s = Math.min(W / f.width, H / f.height) * z;
    ctx.drawImage(f, (W - f.width * s) / 2, (H - f.height * s) / 2, f.width * s, f.height * s);
  };
  const bg = frames[0].getContext("2d")!.getImageData(2, 2, 1, 1).data;
  const colours = opts.petals?.length ? opts.petals : ["#f6c445", "#e8743b", "#d8344c"];
  const petals: Petal[] = Array.from({ length: 34 }, () => ({
    x: Math.random() * W, y: Math.random() * -H, r: 7 + Math.random() * 9, vy: 60 + Math.random() * 70,
    vx: -20 + Math.random() * 40, a: Math.random() * 6, va: -2 + Math.random() * 4, c: colours[Math.floor(Math.random() * colours.length)],
  }));
  let last = 0;
  rec.start(250);
  const start = performance.now();
  await new Promise<void>((res) => {
    const tick = () => {
      const el = performance.now() - start;
      if (el >= seconds * 1000) return res();
      const dt = Math.min(0.1, (el - last) / 1000); last = el;
      const i = Math.min(frames.length - 1, Math.floor(el / per)), local = el - i * per;
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`; ctx.fillRect(0, 0, W, H);
      paint(frames[i], local);
      if (i + 1 < frames.length && local > per - fade) { ctx.globalAlpha = (local - (per - fade)) / fade; paint(frames[i + 1], 0); }
      // falling petals
      ctx.globalAlpha = 0.85;
      for (const p of petals) {
        p.y += p.vy * dt; p.x += (p.vx + Math.sin(p.y / 60) * 25) * dt; p.a += p.va * dt;
        if (p.y > H + 20) { p.y = -20; p.x = Math.random() * W; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, Math.PI * 2); ctx.fillStyle = p.c; ctx.fill();
        ctx.restore();
      }
      if (i === 0 && local < fade) { ctx.globalAlpha = 1 - local / fade; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
      const remain = seconds * 1000 - el;
      if (remain < fade) { ctx.globalAlpha = 1 - remain / fade; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
      ctx.globalAlpha = 1;
      onProgress(el / (seconds * 1000));
      next(tick);
    };
    // animation frames stop in a hidden tab or a covered window; a timer keeps the recording going
    // (less smoothly) there. Whichever fires first draws the next frame.
    const next = (fn: () => void) => {
      let ran = false;
      const go = () => { if (!ran) { ran = true; fn(); } };
      requestAnimationFrame(go);
      setTimeout(go, 40);
    };
    next(tick);
  });
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  await ac?.close();
  if (failure || !chunks.length) throw new Error("The video could not be recorded in this browser. Try Chrome or Edge, or choose No music.");
  return { blob: new Blob(chunks, { type: mime.split(";")[0] }), ext: mime.startsWith("video/mp4") ? "mp4" : "webm" };
}

// ---------------------------------------------------------------- photo background removal

/**
 * Removes the background around a person: starts from the photo's edges and clears every connected
 * pixel close to the edge colour (so similar colours inside the person stay), then softens the cut.
 * Works best on plain walls / studio backdrops. `tolerance` 0..100.
 */
export function cutout(src: Pic, tolerance = 30): HTMLCanvasElement {
  const k = Math.min(1, 1000 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d")!;
  x.drawImage(src, 0, 0, w, h);
  const img = x.getImageData(0, 0, w, h), d = img.data;
  // background colour = median of the border pixels
  const border: number[][] = [];
  for (let i = 0; i < w; i++) border.push([i, 0], [i, h - 1]);
  for (let j = 0; j < h; j++) border.push([0, j], [w - 1, j]);
  const ch = (c0: number) => border.map(([i, j]) => d[(j * w + i) * 4 + c0]).sort((a, b) => a - b)[border.length >> 1];
  const bg = [ch(0), ch(1), ch(2)];
  const limit = 18 + tolerance * 1.6;
  const dist = (p: number) => Math.hypot(d[p] - bg[0], d[p + 1] - bg[1], d[p + 2] - bg[2]);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const [i, j] of border) { const n = j * w + i; if (!seen[n] && dist(n * 4) < limit) { seen[n] = 1; stack.push(n); } }
  while (stack.length) {
    const n = stack.pop()!, i = n % w, j = (n / w) | 0;
    for (const m of [i > 0 ? n - 1 : -1, i < w - 1 ? n + 1 : -1, j > 0 ? n - w : -1, j < h - 1 ? n + w : -1]) {
      if (m < 0 || seen[m]) continue;
      // follow gentle gradients (lit walls) as well as the exact colour
      const p = m * 4, q = n * 4;
      const step = Math.hypot(d[p] - d[q], d[p + 1] - d[q + 1], d[p + 2] - d[q + 2]);
      if (dist(p) < limit * 1.35 && step < limit * 0.35) { seen[m] = 1; stack.push(m); }
    }
  }
  // alpha: 0 for background, soft 2px edge
  const a = new Float32Array(w * h);
  for (let n = 0; n < w * h; n++) a[n] = seen[n] ? 0 : 1;
  for (let pass = 0; pass < 2; pass++) {
    const b = a.slice();
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const n = j * w + i;
      b[n] = (a[n] * 4 + a[n - 1] + a[n + 1] + a[n - w] + a[n + w]) / 8;
    }
    a.set(b);
  }
  for (let n = 0; n < w * h; n++) d[n * 4 + 3] = Math.round(d[n * 4 + 3] * Math.min(1, a[n] * 1.6));
  x.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- print-shop export

/**
 * Re-draws a design for a print shop: at least `dpi` resolution, `bleedMm` of extra background around
 * the trim (edge pixels stretched outward) and crop marks in a white slug. Returns the canvas and its
 * physical size in points (1/72 in) for the PDF page.
 */
export function printSheet(paint: (ctx: CanvasRenderingContext2D) => void, w: number, h: number, trimIn: [number, number], dpi = 300, bleedMm = 3) {
  const scale = Math.max(1, (trimIn[0] * dpi) / w);
  const ppi = (w * scale) / trimIn[0];
  const bleed = Math.round((bleedMm / 25.4) * ppi), slug = Math.round((8 / 25.4) * ppi);
  const tw = Math.round(w * scale), th = Math.round(h * scale);
  const art = document.createElement("canvas");
  art.width = tw; art.height = th;
  const ax = art.getContext("2d")!;
  ax.scale(scale, scale);
  paint(ax);
  const c = document.createElement("canvas");
  c.width = tw + 2 * (bleed + slug); c.height = th + 2 * (bleed + slug);
  const x = c.getContext("2d")!;
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, c.width, c.height);
  const o = slug + bleed;
  // bleed: stretch the outermost pixels outward
  x.drawImage(art, 0, 0, tw, 1, o, slug, tw, bleed);
  x.drawImage(art, 0, th - 1, tw, 1, o, o + th, tw, bleed);
  x.drawImage(art, 0, 0, 1, th, slug, o, bleed, th);
  x.drawImage(art, tw - 1, 0, 1, th, o + tw, o, bleed, th);
  for (const [sx, sy, dx, dy] of [[0, 0, slug, slug], [tw - 1, 0, o + tw, slug], [0, th - 1, slug, o + th], [tw - 1, th - 1, o + tw, o + th]]) {
    x.drawImage(art, sx, sy, 1, 1, dx, dy, bleed, bleed);
  }
  x.drawImage(art, o, o);
  // crop marks at the trim lines, in the slug only
  x.strokeStyle = "#000000"; x.lineWidth = Math.max(1, ppi / 300);
  const len = slug - Math.round(ppi * 0.04);
  for (const tx of [o, o + tw]) for (const [y0, y1] of [[0, len], [c.height - len, c.height]]) { x.beginPath(); x.moveTo(tx, y0); x.lineTo(tx, y1); x.stroke(); }
  for (const ty of [o, o + th]) for (const [x0, x1] of [[0, len], [c.width - len, c.width]]) { x.beginPath(); x.moveTo(x0, ty); x.lineTo(x1, ty); x.stroke(); }
  const pt = (px: number) => (px / ppi) * 72;
  return { canvas: c, wPt: pt(c.width), hPt: pt(c.height), dpi: Math.round(ppi) };
}
