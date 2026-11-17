// Creative Studio: posters and business print needs (sale, hiring, admission, notice, to-let…),
// visiting cards and certificates. Same on-card editing as the other designs (say / place in cards.ts).
import {
  SCRIPT, SERIF, drawQr, edited, formatDate, formatTime, place, quiet, say, wrap,
  type Item, type Lang, type Overrides, type Pic, type Theme,
} from "./cards";

export const SANS = `"Segoe UI", "Noto Sans Devanagari", "Nirmala UI", Mangal, Arial, sans-serif`;

export type PromoId = "sale" | "hiring" | "admission" | "coaching" | "event" | "notice" | "tolet" | "missing" | "service" | "visiting" | "certificate";

export interface Promo {
  kind: PromoId;
  title: string; titleHi: string;
  highlight: string;  // offer / salary / session / rent / reward; designation on a visiting card; signers on a certificate
  name: string;       // person: missing person, chief guest, signed by, card holder, certificate recipient
  points: string;     // one item per line (a paragraph for notices and certificates)
  org: string;
  phone: string;
  address: string;
  date: string; time: string;
  qr: string;
  lang: Lang;
  theme: string;
  size: string;              // id from PROMO_SIZES, or "custom"
  cw: number; ch: number;    // custom size
  unit: Unit;
}

export type Unit = "in" | "cm" | "mm" | "ft" | "px";

type Shape = "poster" | "card" | "cert";
interface PromoKind {
  en: string; hi: string;
  shape: Shape;
  highlightLabel: string;
  nameLabel?: string;
  pointsLabel: string;
  paragraph?: boolean;
  dateLabel?: [string, string];
  time?: boolean;
  defaultTheme: string;
}

export const PROMO_KINDS: Record<PromoId, PromoKind> = {
  sale: { en: "Sale / Offer", hi: "सेल / ऑफ़र", shape: "poster", highlightLabel: "Offer (e.g. FLAT 50% OFF)", pointsLabel: "What is on offer (one per line)", dateLabel: ["Offer valid till", "ऑफ़र अंतिम तिथि"], defaultTheme: "red" },
  hiring: { en: "We are Hiring", hi: "भर्ती", shape: "poster", highlightLabel: "Salary or highlight", pointsLabel: "Posts (one per line)", dateLabel: ["Apply by", "आवेदन की अंतिम तिथि"], defaultTheme: "blue" },
  admission: { en: "Admission Open", hi: "प्रवेश प्रारंभ", shape: "poster", highlightLabel: "Session", pointsLabel: "Classes and features (one per line)", dateLabel: ["Admissions close", "प्रवेश की अंतिम तिथि"], defaultTheme: "green" },
  coaching: { en: "Coaching / New Batch", hi: "कोचिंग / नया बैच", shape: "poster", highlightLabel: "Courses or exams", pointsLabel: "Features (one per line)", dateLabel: ["Batch starts", "बैच प्रारंभ"], time: true, defaultTheme: "purple" },
  event: { en: "Event / Seminar", hi: "कार्यक्रम / सेमिनार", shape: "poster", highlightLabel: "Highlight (e.g. Free entry)", nameLabel: "Chief guest or speaker", pointsLabel: "Programme (one per line)", dateLabel: ["Date", "दिनांक"], time: true, defaultTheme: "black" },
  notice: { en: "Notice", hi: "सूचना", shape: "poster", highlightLabel: "Subject (optional)", nameLabel: "Signed by", pointsLabel: "Notice text", paragraph: true, dateLabel: ["Date", "दिनांक"], defaultTheme: "white" },
  tolet: { en: "To-Let / For Rent", hi: "किराये के लिए", shape: "poster", highlightLabel: "Rent", pointsLabel: "Details (one per line)", defaultTheme: "yellow" },
  missing: { en: "Missing / Lost", hi: "गुमशुदा / खोया", shape: "poster", highlightLabel: "Reward (optional)", nameLabel: "Name and age (or the lost item)", pointsLabel: "Description (one per line)", dateLabel: ["Missing since", "कब से लापता"], defaultTheme: "white" },
  service: { en: "Shop / Service Ad", hi: "दुकान / सेवा विज्ञापन", shape: "poster", highlightLabel: "Offer or price", pointsLabel: "Services (one per line)", defaultTheme: "teal" },
  visiting: { en: "Visiting Card", hi: "विज़िटिंग कार्ड", shape: "card", highlightLabel: "Designation", nameLabel: "Name", pointsLabel: "Email, website (one per line)", defaultTheme: "blue" },
  certificate: { en: "Certificate", hi: "प्रमाण पत्र", shape: "cert", highlightLabel: "Signed by (comma separated)", nameLabel: "Presented to", pointsLabel: "For (reason)", paragraph: true, dateLabel: ["Date", "दिनांक"], defaultTheme: "blue" },
};
export const PROMO_ORDER = Object.keys(PROMO_KINDS) as PromoId[];

const P = (id: string, name: string, bg: [string, string], ink: string, accent: string, soft: string): Theme => ({ id, name, bg, ink, accent, soft, motif: "line" });
export const PROMO_THEMES: Theme[] = [
  P("red", "Bold Red", ["#e63946", "#9d0208"], "#ffffff", "#ffd60a", "#ffb4a2"),
  P("yellow", "Sunny Yellow", ["#ffd60a", "#ffb703"], "#1b1b1b", "#d62828", "#7a4a00"),
  P("blue", "Royal Blue", ["#1d4ed8", "#0b1f5c"], "#ffffff", "#ffb703", "#9ec5ff"),
  P("green", "Fresh Green", ["#1b8a4b", "#0b3d20"], "#ffffff", "#ffe066", "#a7e8bd"),
  P("black", "Black & Gold", ["#1f1f1f", "#000000"], "#ffffff", "#f5c518", "#bfbfbf"),
  P("white", "Clean White", ["#ffffff", "#eef1f5"], "#14213d", "#e63946", "#5c677d"),
  P("purple", "Purple Pop", ["#6d28d9", "#2e1065"], "#ffffff", "#ff9e00", "#d8b4fe"),
  P("orange", "Orange Burst", ["#fb8500", "#c2410c"], "#ffffff", "#023047", "#ffe3c2"),
  P("teal", "Teal Pro", ["#0f766e", "#053b37"], "#ffffff", "#ffd166", "#99f6e4"),
  P("pink", "Hot Pink", ["#db2777", "#7a0f3f"], "#ffffff", "#fde047", "#fbcfe8"),
  P("sky", "Sky & Navy", ["#e0f2fe", "#bae6fd"], "#0c2d57", "#1d4ed8", "#3b6ea8"),
  P("cream", "Cream & Maroon", ["#fff8e7", "#f3e4c3"], "#4a0d12", "#a4161a", "#8a6a3b"),
];
export const promoTheme = (id: string) => PROMO_THEMES.find((t) => t.id === id) ?? PROMO_THEMES[0];

const later = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const BASE: Omit<Promo, "kind" | "size"> = {
  title: "", titleHi: "", highlight: "", name: "", points: "", org: "", phone: "98765 43210",
  address: "Civil Lines, Prayagraj", date: "", time: "", qr: "", lang: "en", theme: "red",
  cw: 3, ch: 2, unit: "ft",
};
const SAMPLES: Record<PromoId, Partial<Promo>> = {
  sale: { org: "Sharma Garments", title: "MEGA SALE", titleHi: "महा सेल", highlight: "FLAT 50% OFF", points: "Sarees, suits and kurtis\nKids wear from ₹199\nFree alteration", address: "Shop 12, Civil Lines, Prayagraj", date: later(10) },
  hiring: { org: "Sharma Sweets & Bakery", title: "WE ARE HIRING", titleHi: "भर्ती जारी है", highlight: "Salary ₹12,000 – ₹18,000", points: "Sales staff (2)\nDelivery boy with bike (3)\nCashier, 12th pass (1)", date: later(15) },
  admission: { org: "Saraswati Public School", title: "ADMISSION OPEN", titleHi: "प्रवेश प्रारंभ", highlight: "Session 2027-28", points: "Nursery to Class 12\nSmart classes and labs\nTransport available\nScholarship for toppers", date: later(45) },
  coaching: { org: "Success Point Academy", title: "NEW BATCH", titleHi: "नया बैच", highlight: "SSC · Banking · Railway", points: "Daily tests and doubt classes\nExperienced faculty\nLibrary 7 AM – 10 PM", date: later(7), time: "08:00" },
  event: { org: "Prayagraj Yuva Manch", title: "CAREER SEMINAR", titleHi: "कैरियर सेमिनार", highlight: "Free entry", name: "Dr. A. K. Mishra", points: "Government job preparation tips\nResume and interview skills\nQuestion and answer session", date: later(12), time: "11:00", address: "Town Hall, Civil Lines, Prayagraj" },
  notice: { org: "Shanti Kunj Residents' Welfare Association", title: "NOTICE", titleHi: "सूचना", highlight: "Water supply shutdown", name: "Secretary", points: "Water supply will remain closed on Sunday from 10 AM to 4 PM for cleaning of the overhead tank. All residents are requested to store water in advance and cooperate.", date: later(0), phone: "", address: "" },
  tolet: { title: "TO LET", titleHi: "किराये के लिए खाली", highlight: "₹12,000 / month", points: "2 BHK, first floor\nParking and 24-hour water\nFamily preferred", address: "14 Ashok Nagar, Prayagraj" },
  missing: { title: "MISSING", titleHi: "गुमशुदा की तलाश", highlight: "Reward ₹5,000", name: "Rahul Kumar, age 12", points: "Last seen near Civil Lines bus stand\nBlue shirt and black jeans\nHeight 4 ft 8 in", date: later(-2) },
  service: { org: "Gupta AC & Fridge Repair", title: "AC REPAIR & SERVICE", titleHi: "एसी रिपेयर व सर्विस", highlight: "Home visit ₹199", points: "All brands, split and window\nGas filling and installation\nSame-day service" },
  visiting: { org: "Verma Electricals", name: "Rohit Verma", highlight: "Proprietor", points: "rohit@example.com\nwww.example.com", address: "Shop 5, Katra Market, Prayagraj" },
  certificate: { org: "Saraswati Public School", title: "Certificate of Appreciation", titleHi: "प्रशंसा प्रमाण पत्र", name: "Priya Singh", highlight: "Principal, Class Teacher", points: "for securing first position in the inter-school quiz competition.", date: later(0), phone: "", address: "" },
};
export const promoSample = (k: PromoId): Promo => ({
  ...BASE, ...SAMPLES[k], kind: k, theme: PROMO_KINDS[k].defaultTheme,
  size: PROMO_KINDS[k].shape === "card" ? "card" : PROMO_KINDS[k].shape === "cert" ? "cert" : "a4",
});

export interface PromoSize {
  id: string; label: string; group: string;
  px: [number, number];
  /** finished size in inches + print resolution; none = screen only */
  print?: [number, number, number];
  shape: Shape;
}
const PORTRAIT_A: [number, number] = [1080, 1528];
export const PROMO_SIZES: PromoSize[] = [
  { id: "a4", label: "A4 portrait (21 × 29.7 cm)", group: "Print", px: PORTRAIT_A, print: [8.27, 11.69, 200], shape: "poster" },
  { id: "a4l", label: "A4 landscape", group: "Print", px: [1528, 1080], print: [11.69, 8.27, 200], shape: "poster" },
  { id: "a3", label: "A3 portrait (29.7 × 42 cm)", group: "Print", px: PORTRAIT_A, print: [11.69, 16.54, 150], shape: "poster" },
  { id: "a3l", label: "A3 landscape", group: "Print", px: [1528, 1080], print: [16.54, 11.69, 150], shape: "poster" },
  { id: "a5", label: "A5 handbill / pamphlet (14.8 × 21 cm)", group: "Print", px: PORTRAIT_A, print: [5.83, 8.27, 300], shape: "poster" },
  { id: "letter", label: "Letter (8.5 × 11 in)", group: "Print", px: [1080, 1398], print: [8.5, 11, 200], shape: "poster" },
  { id: "story", label: "WhatsApp status / Instagram story (9:16)", group: "Social media", px: [1080, 1920], shape: "poster" },
  { id: "square", label: "Instagram / WhatsApp post (1:1)", group: "Social media", px: [1080, 1080], shape: "poster" },
  { id: "insta45", label: "Instagram portrait post (4:5)", group: "Social media", px: [1080, 1350], shape: "poster" },
  { id: "facebook", label: "Facebook / link post (1.91:1)", group: "Social media", px: [1200, 628], shape: "poster" },
  { id: "youtube", label: "YouTube thumbnail (16:9)", group: "Social media", px: [1280, 720], shape: "poster" },
  { id: "flex63", label: "Flex banner 6 × 3 ft", group: "Banners and boards", px: [2160, 1080], print: [72, 36, 60], shape: "poster" },
  { id: "flex104", label: "Flex banner 10 × 4 ft", group: "Banners and boards", px: [2700, 1080], print: [120, 48, 40], shape: "poster" },
  { id: "board82", label: "Shop board 8 × 2 ft", group: "Banners and boards", px: [3200, 800], print: [96, 24, 50], shape: "poster" },
  { id: "standee", label: "Roll-up standee 2.75 × 6.6 ft", group: "Banners and boards", px: [1080, 2618], print: [33, 80, 60], shape: "poster" },
  { id: "poster1824", label: "Wall poster 18 × 24 in", group: "Banners and boards", px: [1080, 1440], print: [18, 24, 150], shape: "poster" },
  { id: "card", label: "Visiting card 3.5 × 2 in", group: "Card", px: [1050, 600], print: [3.5, 2, 300], shape: "card" },
  { id: "card8555", label: "Visiting card 85 × 55 mm", group: "Card", px: [1004, 650], print: [3.35, 2.17, 300], shape: "card" },
  { id: "cert", label: "A4 landscape", group: "Certificate", px: [1754, 1240], print: [11.69, 8.27, 200], shape: "cert" },
  { id: "certa3", label: "A3 landscape", group: "Certificate", px: [1754, 1240], print: [16.54, 11.69, 150], shape: "cert" },
  { id: "certletter", label: "Letter landscape (11 × 8.5 in)", group: "Certificate", px: [1754, 1356], print: [11, 8.5, 200], shape: "cert" },
];
export const sizesFor = (k: PromoId) => PROMO_SIZES.filter((z) => z.shape === PROMO_KINDS[k].shape);
const TO_IN: Record<Unit, number> = { in: 1, cm: 1 / 2.54, mm: 1 / 25.4, ft: 12, px: 0 };

/** The size a design is drawn at, in pixels, and its print size (inches + dpi) when it has one. */
export function promoFormat(p: Promo, vertical = false): { px: [number, number]; print?: [number, number, number]; label: string } {
  if (vertical && PROMO_KINDS[p.kind].shape === "poster") return { px: [1080, 1920], label: "9:16" };
  if (p.size === "custom" && PROMO_KINDS[p.kind].shape === "poster") {
    const cw = Math.max(0.1, +p.cw || 1), ch = Math.max(0.1, +p.ch || 1);
    if (p.unit === "px") {
      const k = Math.min(1, 5000 / Math.max(cw, ch));
      return { px: [Math.max(100, Math.round(cw * k)), Math.max(100, Math.round(ch * k))], label: `${cw} × ${ch} px` };
    }
    const wi = cw * TO_IN[p.unit], hi = ch * TO_IN[p.unit], r = wi / hi;
    // short side 1080 px on screen; very long shapes are capped at 4320 px
    let pw = r >= 1 ? 1080 * r : 1080, ph = r >= 1 ? 1080 : 1080 / r;
    const cap = Math.max(pw, ph) / 4320;
    if (cap > 1) { pw /= cap; ph /= cap; }
    const dpi = Math.max(20, Math.min(300, Math.round(6000 / Math.max(wi, hi))));
    return { px: [Math.round(pw), Math.round(ph)], print: [wi, hi, dpi], label: `${cw} × ${ch} ${p.unit}` };
  }
  const z = sizesFor(p.kind).find((x) => x.id === p.size) ?? sizesFor(p.kind)[0];
  return { px: z.px, print: z.print, label: z.label };
}
export const promoSize = (p: Promo, vertical = false) => promoFormat(p, vertical).px;

// ---------------------------------------------------------------- helpers

function lum(hex: string): number {
  const m = hex.replace("#", "").match(/^(..)(..)(..)$/);
  if (!m) return 0.5;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const on = (hex: string) => (lum(hex) > 0.55 ? "#111111" : "#ffffff");

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2, d = i % 2 ? r * inner : r;
    ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
}

function photoBox(ctx: CanvasRenderingContext2D, img: Pic, x: number, y: number, w: number, h: number, border: string, radius: number) {
  ctx.save();
  rr(ctx, x, y, w, h, radius); ctx.clip();
  ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y, w, h);
  const s = Math.max(w / img.width, h / img.height);
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
  ctx.restore();
  ctx.strokeStyle = border; ctx.lineWidth = Math.max(4, w * 0.025);
  rr(ctx, x, y, w, h, radius); ctx.stroke();
}

function photoRound(ctx: CanvasRenderingContext2D, img: Pic, cx: number, cy: number, r: number, border: string) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "#ffffff"; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  const s = Math.max((2 * r) / img.width, (2 * r) / img.height);
  ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
  ctx.restore();
  ctx.strokeStyle = border; ctx.lineWidth = r * 0.07;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
}

/** Simple icon for each poster kind, drawn in the accent colour. */
function art(ctx: CanvasRenderingContext2D, k: PromoId, cx: number, cy: number, s: number, t: Theme) {
  const fg = t.accent, cut = t.bg[0];
  ctx.save();
  ctx.fillStyle = fg; ctx.strokeStyle = fg; ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (k === "sale") {
    ctx.translate(cx, cy); ctx.rotate(-0.5);
    ctx.beginPath(); ctx.moveTo(-s * 0.5, 0); ctx.lineTo(-s * 0.22, -s * 0.28); ctx.lineTo(s * 0.5, -s * 0.28); ctx.lineTo(s * 0.5, s * 0.28); ctx.lineTo(-s * 0.22, s * 0.28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = cut; ctx.beginPath(); ctx.arc(-s * 0.24, 0, s * 0.07, 0, 7); ctx.fill();
    ctx.fillStyle = on(fg); ctx.font = `900 ${s * 0.36}px ${SANS}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("%", s * 0.16, s * 0.02);
  } else if (k === "hiring" || k === "notice") {
    // megaphone
    ctx.beginPath(); ctx.moveTo(-s * 0.4 + cx, cy - s * 0.12); ctx.lineTo(cx + s * 0.3, cy - s * 0.38); ctx.lineTo(cx + s * 0.3, cy + s * 0.38); ctx.lineTo(cx - s * 0.4, cy + s * 0.12); ctx.closePath(); ctx.fill();
    rr(ctx, cx - s * 0.5, cy - s * 0.14, s * 0.14, s * 0.28, s * 0.04); ctx.fill();
    ctx.lineWidth = s * 0.07; ctx.beginPath(); ctx.moveTo(cx - s * 0.3, cy + s * 0.12); ctx.lineTo(cx - s * 0.22, cy + s * 0.42); ctx.stroke();
    ctx.lineWidth = s * 0.05;
    for (const r of [0.48, 0.62]) { ctx.beginPath(); ctx.arc(cx + s * 0.2, cy, s * r, -0.5, 0.5); ctx.stroke(); }
  } else if (k === "admission") {
    ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.35); ctx.lineTo(cx + s * 0.55, cy - s * 0.1); ctx.lineTo(cx, cy + s * 0.15); ctx.lineTo(cx - s * 0.55, cy - s * 0.1); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - s * 0.32, cy); ctx.lineTo(cx - s * 0.32, cy + s * 0.25); ctx.quadraticCurveTo(cx, cy + s * 0.42, cx + s * 0.32, cy + s * 0.25); ctx.lineTo(cx + s * 0.32, cy); ctx.lineTo(cx, cy + s * 0.15); ctx.closePath(); ctx.fill();
    ctx.lineWidth = s * 0.035; ctx.beginPath(); ctx.moveTo(cx + s * 0.45, cy - s * 0.06); ctx.lineTo(cx + s * 0.45, cy + s * 0.3); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + s * 0.45, cy + s * 0.33, s * 0.05, 0, 7); ctx.fill();
  } else if (k === "coaching") {
    // open book
    for (const sd of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.22); ctx.quadraticCurveTo(cx + sd * s * 0.25, cy - s * 0.36, cx + sd * s * 0.55, cy - s * 0.28);
      ctx.lineTo(cx + sd * s * 0.55, cy + s * 0.3); ctx.quadraticCurveTo(cx + sd * s * 0.25, cy + s * 0.22, cx, cy + s * 0.36); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = cut; ctx.lineWidth = s * 0.025;
    for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) { const y = cy - s * 0.12 + i * s * 0.13; ctx.beginPath(); ctx.moveTo(cx + sd * s * 0.1, y); ctx.lineTo(cx + sd * s * 0.44, y - s * 0.03); ctx.stroke(); }
  } else if (k === "event") {
    rr(ctx, cx - s * 0.14, cy - s * 0.45, s * 0.28, s * 0.5, s * 0.14); ctx.fill();
    ctx.lineWidth = s * 0.06; ctx.beginPath(); ctx.arc(cx, cy - s * 0.1, s * 0.25, 0.1, Math.PI - 0.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + s * 0.15); ctx.lineTo(cx, cy + s * 0.38); ctx.moveTo(cx - s * 0.18, cy + s * 0.4); ctx.lineTo(cx + s * 0.18, cy + s * 0.4); ctx.stroke();
    for (const [dx, dy, r] of [[-0.5, -0.3, 0.08], [0.5, -0.25, 0.07], [0.42, 0.25, 0.05], [-0.45, 0.2, 0.05]]) { star(ctx, cx + dx * s, cy + dy * s, r * s); ctx.fill(); }
  } else if (k === "tolet") {
    ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.45); ctx.lineTo(cx + s * 0.5, cy - s * 0.02); ctx.lineTo(cx - s * 0.5, cy - s * 0.02); ctx.closePath(); ctx.fill();
    ctx.fillRect(cx - s * 0.36, cy - s * 0.04, s * 0.72, s * 0.44);
    ctx.fillStyle = cut; rr(ctx, cx - s * 0.09, cy + s * 0.12, s * 0.18, s * 0.28, s * 0.03); ctx.fill();
    ctx.fillRect(cx + s * 0.16, cy + s * 0.06, s * 0.13, s * 0.12); ctx.fillRect(cx - s * 0.29, cy + s * 0.06, s * 0.13, s * 0.12);
  } else if (k === "missing") {
    ctx.lineWidth = s * 0.09; ctx.beginPath(); ctx.arc(cx - s * 0.08, cy - s * 0.08, s * 0.26, 0, 7); ctx.stroke();
    ctx.lineWidth = s * 0.13; ctx.beginPath(); ctx.moveTo(cx + s * 0.13, cy + s * 0.13); ctx.lineTo(cx + s * 0.4, cy + s * 0.4); ctx.stroke();
    ctx.fillStyle = fg; ctx.font = `900 ${s * 0.3}px ${SANS}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("?", cx - s * 0.08, cy - s * 0.06);
  } else if (k === "service") {
    star(ctx, cx, cy, s * 0.42, 9, 0.78); ctx.fill();
    ctx.fillStyle = cut; ctx.beginPath(); ctx.arc(cx, cy, s * 0.15, 0, 7); ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the designs

export function drawPromo(ctx: CanvasRenderingContext2D, p: Promo, photo: Pic | null, vertical: boolean, ov?: Overrides): Item[] {
  return edited(ov, () => {
    const shape = PROMO_KINDS[p.kind].shape;
    ctx.save();
    if (shape === "card") visiting(ctx, p, photo);
    else if (shape === "cert") certificate(ctx, p, photo);
    else poster(ctx, p, photo, vertical);
    ctx.restore();
  });
}

function poster(ctx: CanvasRenderingContext2D, p: Promo, photo: Pic | null, vertical: boolean) {
  const [w, h] = promoSize(p, vertical);
  const k = PROMO_KINDS[p.kind], t = promoTheme(p.theme);
  const hi = p.lang !== "en", en = p.lang !== "hi";
  const wide = w / h > 1.15;
  // one design unit: 1 px on a 1080-wide portrait poster; wide sizes are measured by their height
  const U = wide ? Math.min(h / 900, w / 1500) : Math.min(w / 1080, h / 1000);
  const cx = w / 2;
  ctx.clearRect(0, 0, w, h);

  // backdrop: gradient, two soft circles and a slanted band
  const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, t.bg[0]); g.addColorStop(1, t.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const R = Math.max(w, h);
  ctx.globalAlpha = 0.16; ctx.fillStyle = t.accent;
  ctx.beginPath(); ctx.arc(w * 0.98, h * 0.02, R * 0.3, 0, 7); ctx.fill();
  ctx.globalAlpha = 0.1; ctx.fillStyle = t.ink;
  ctx.beginPath(); ctx.arc(w * 0.02, h * 0.72, Math.min(w, h) * 0.3, 0, 7); ctx.fill();
  ctx.globalAlpha = 0.08;
  ctx.beginPath(); ctx.moveTo(0, h * 0.2); ctx.lineTo(w, h * 0.08); ctx.lineTo(w, h * 0.13); ctx.lineTo(0, h * 0.25); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = t.accent; ctx.fillRect(0, 0, w, 14 * U);

  // footer: phone + address on an accent band, QR on the right
  const hasFoot = !!(p.phone || p.address);
  const oneLine = wide && w / h > 1.6;
  const footH = !hasFoot ? 0 : (p.phone && p.address && !oneLine ? 190 : 130) * U;
  const qrSize = (wide ? 170 : 190) * U, hasQr = !!p.qr;
  const footW = hasQr ? w - qrSize - 120 * U : w - 120 * U;
  const footCx = hasQr ? (w - qrSize - 60 * U) / 2 + 20 * U : cx;
  if (hasFoot) {
    ctx.fillStyle = t.accent;
    ctx.beginPath(); ctx.moveTo(0, h - footH); ctx.lineTo(w, h - footH - 40 * U); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = on(t.accent);
    if (oneLine) {
      const y = h - footH / 2 + 18 * U;
      if (p.phone && p.address) {
        ctx.textAlign = "right"; fitFont(ctx, `☎ ${p.phone}`, (px) => `800 ${px}px ${SANS}`, 60 * U, footW * 0.42); say(ctx, "phone", `☎ ${p.phone}`, footCx - 30 * U, y);
        ctx.textAlign = "left"; fitFont(ctx, p.address, (px) => `600 ${px}px ${SANS}`, 36 * U, footW * 0.5); say(ctx, "addr", p.address, footCx + 30 * U, y - 4 * U);
        ctx.fillRect(footCx - 2 * U, y - 46 * U, 4 * U, 56 * U);
      } else {
        ctx.textAlign = "center"; const s = p.phone ? `☎ ${p.phone}` : p.address;
        fitFont(ctx, s, (px) => `800 ${px}px ${SANS}`, 60 * U, footW); say(ctx, p.phone ? "phone" : "addr", s, footCx, y);
      }
    } else {
      ctx.textAlign = "center";
      let fy = h - footH + (p.address ? 82 : 86) * U;
      if (p.phone) { fitFont(ctx, `☎ ${p.phone}`, (px) => `800 ${px}px ${SANS}`, 68 * U, footW); say(ctx, "phone", `☎ ${p.phone}`, footCx, fy); fy += 64 * U; }
      if (p.address) { fitFont(ctx, p.address, (px) => `600 ${px}px ${SANS}`, 34 * U, footW); say(ctx, "addr", p.address, footCx, fy); }
    }
  }
  if (hasQr) {
    const q = place("qr", w - qrSize - 50 * U, h - footH - qrSize * 0.55 - (hasFoot ? 20 * U : 50 * U), qrSize, qrSize);
    if (!q.hidden) drawQr(ctx, p.qr, q.x, q.y, q.w, t);
  }

  const top = (h / w > 1.6 ? 120 : wide ? 50 : 70) * U;
  const limit = h - footH - (hasQr ? qrSize * 0.6 + 50 * U : 50 * U);
  const scratch = document.createElement("canvas").getContext("2d")!;
  // lay out a column, shrinking when it would hit the footer and growing (up to 1.4×) to fill the space
  const column = (part: (c: CanvasRenderingContext2D, s: number, x: number, width: number, y: number) => number, x: number, width: number, bottom = limit) => {
    const end = quiet(() => part(scratch, 1, x, width, top));
    if (end <= top) return;
    let s = Math.max(0.4, Math.min(1.4, (bottom - top) / (end - top)));
    let e2 = quiet(() => part(scratch, s, x, width, top));
    for (let i = 0; i < 8 && e2 > bottom && s > 0.4; i++) { s *= 0.95; e2 = quiet(() => part(scratch, s, x, width, top)); }
    const extra = e2 < bottom ? (bottom - e2) * 0.4 : 0;
    part(ctx, s, x, width, top + extra);
  };
  if (wide) {
    const colW = w * 0.46;
    column(head, w * 0.27, colW);
    // the QR sits bottom-right, so the right column stops above it
    column(rest, w * 0.73, colW * 0.95, hasQr ? h - footH - qrSize - 60 * U : limit);
  } else {
    column((c, s, x, width, y) => rest(c, s, x, width, head(c, s, x, width, y)), cx, w * 0.84);
  }

  function head(ctx: CanvasRenderingContext2D, s: number, cx: number, inner: number, y: number): number {
    const u = U * s;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    if (p.kind !== "notice") { art(ctx, p.kind, cx, y + 60 * u, 130 * u, t); y += 150 * u; }
    if (p.org) {
      ctx.fillStyle = t.ink;
      ctx.font = `700 ${40 * u}px ${SANS}`;
      wrap(ctx, p.org.toUpperCase(), inner).forEach((l, i) => { say(ctx, `org.${i}`, l, cx, y + 20 * u); y += 50 * u; });
      y += 24 * u;
      if (p.kind === "notice") { ctx.fillStyle = t.accent; ctx.fillRect(cx - inner / 2, y - 10 * u, inner, 5 * u); y += 50 * u; }
    }
    const main = hi && !en ? p.titleHi || p.title : p.title || p.titleHi;
    if (main) {
      ctx.fillStyle = p.kind === "notice" || p.kind === "missing" ? t.accent : t.ink;
      let px = (h / w > 1.6 ? 190 : 170) * u, lines: string[] = [];
      for (;;) {
        ctx.font = `900 ${px}px ${SANS}`;
        lines = wrap(ctx, main, inner);
        if ((lines.length <= 2 && lines.every((l) => ctx.measureText(l).width <= inner)) || px < 40 * u) break;
        px *= 0.92;
      }
      y += px * 0.78;
      lines.forEach((l, i) => { say(ctx, `title.${i}`, l, cx, y); y += px * 0.98; });
      y -= px * 0.98; y += 30 * u;
    }
    if (hi && en && p.titleHi && p.titleHi !== main) {
      ctx.fillStyle = t.accent;
      const px = fitFont(ctx, p.titleHi, (n) => `800 ${n}px ${SANS}`, 66 * u, inner);
      y += px * 0.9; say(ctx, "title.hi", p.titleHi, cx, y); y += px * 0.5;
    }
    y += 20 * u;
    if (p.highlight) {
      const px = fitFont(ctx, p.highlight, (n) => `800 ${n}px ${SANS}`, 62 * u, inner - 120 * u);
      const tw = ctx.measureText(p.highlight).width, bw = tw + 110 * u, bh = px * 1.7, bx = cx - bw / 2;
      ctx.fillStyle = t.accent;
      ctx.beginPath(); ctx.moveTo(bx + 30 * u, y); ctx.lineTo(bx + bw + 10 * u, y); ctx.lineTo(bx + bw - 30 * u, y + bh); ctx.lineTo(bx - 10 * u, y + bh); ctx.closePath(); ctx.fill();
      ctx.fillStyle = on(t.accent);
      say(ctx, "highlight", p.highlight, cx, y + bh / 2 + px * 0.36);
      y += bh + 44 * u;
    }
    return y;
  }

  function rest(ctx: CanvasRenderingContext2D, s: number, cx: number, inner: number, y: number): number {
    const u = U * s;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    if (photo) {
      if (p.kind === "missing") {
        const pw = 400 * u, ph = 480 * u;
        const b = place("photo", cx - pw / 2, y, pw, ph);
        if (!b.hidden) photoBox(ctx, photo, b.x, b.y, b.w, b.h, t.accent, 18 * u);
        y += ph + 50 * u;
      } else {
        const r = 130 * u;
        const b = place("photo", cx - r, y, r * 2, r * 2);
        if (!b.hidden) photoRound(ctx, photo, b.x + b.w / 2, b.y + b.h / 2, b.w / 2, t.accent);
        y += r * 2 + 44 * u;
      }
    }
    if (k.nameLabel && p.name && p.kind !== "notice") {
      if (p.kind === "event") { ctx.fillStyle = t.soft; ctx.font = `600 ${30 * u}px ${SANS}`; say(ctx, "name.label", hi && !en ? "मुख्य अतिथि / वक्ता" : "Chief guest / Speaker", cx, y + 10 * u); y += 54 * u; }
      ctx.fillStyle = p.kind === "missing" ? t.ink : t.accent;
      const px = fitFont(ctx, p.name, (n) => `800 ${n}px ${SANS}`, 56 * u, inner);
      y += px * 0.6; say(ctx, "name", p.name, cx, y); y += px * 0.9;
    }
    const dateLine = k.dateLabel && p.date
      ? `${hi && !en ? k.dateLabel[1] : k.dateLabel[0]}: ${[formatDate(p.date, hi && !en), k.time ? formatTime(p.time, hi && !en) : ""].filter(Boolean).join(" · ")}`
      : "";
    if (p.kind === "notice" && dateLine) {
      ctx.textAlign = "right"; ctx.fillStyle = t.ink; ctx.font = `600 ${32 * u}px ${SANS}`;
      say(ctx, "date", dateLine, cx + inner / 2, y); y += 70 * u; ctx.textAlign = "center";
    }
    const items = p.points.split("\n").map((x) => x.trim()).filter(Boolean);
    if (items.length && k.paragraph) {
      ctx.fillStyle = t.ink; ctx.font = `500 ${38 * u}px ${SANS}`; ctx.textAlign = "left";
      wrap(ctx, items.join(" "), inner).forEach((l, i) => { say(ctx, `text.${i}`, l, cx - inner / 2, y + 30 * u); y += 56 * u; });
      y += 40 * u; ctx.textAlign = "center";
    } else if (items.length) {
      ctx.font = `600 ${42 * u}px ${SANS}`;
      const rows = items.map((it) => wrap(ctx, it, inner - 70 * u));
      const widest = Math.max(...rows.flat().map((l) => ctx.measureText(l).width));
      const x0 = cx - (widest + 62 * u) / 2;
      ctx.textAlign = "left";
      rows.forEach((lines, i) => {
        ctx.fillStyle = t.accent;
        ctx.beginPath(); ctx.arc(x0 + 16 * u, y + 16 * u, 15 * u, 0, 7); ctx.fill();
        ctx.strokeStyle = on(t.accent); ctx.lineWidth = 4.5 * u;
        ctx.beginPath(); ctx.moveTo(x0 + 9 * u, y + 16 * u); ctx.lineTo(x0 + 14 * u, y + 22 * u); ctx.lineTo(x0 + 24 * u, y + 9 * u); ctx.stroke();
        ctx.fillStyle = t.ink;
        lines.forEach((l, j) => { say(ctx, `pt.${i}.${j}`, l, x0 + 62 * u, y + 30 * u); y += 56 * u; });
        y += 10 * u;
      });
      y += 24 * u; ctx.textAlign = "center";
    }
    if (p.kind === "notice" && p.name) {
      ctx.textAlign = "right"; ctx.fillStyle = t.ink; ctx.font = `700 ${36 * u}px ${SANS}`;
      say(ctx, "name", p.name, cx + inner / 2, y + 20 * u); y += 70 * u; ctx.textAlign = "center";
    }
    if (dateLine && p.kind !== "notice") {
      ctx.fillStyle = t.accent;
      const px = fitFont(ctx, dateLine, (n) => `700 ${n}px ${SANS}`, 40 * u, inner);
      y += px * 0.8; say(ctx, "date", dateLine, cx, y); y += px * 0.8;
    }
    return y;
  }
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, px: number, maxW: number): number {
  let s = px;
  ctx.font = font(s);
  while (s > 10 && ctx.measureText(text).width > maxW) { s *= 0.94; ctx.font = font(s); }
  return s;
}

function visiting(ctx: CanvasRenderingContext2D, p: Promo, photo: Pic | null) {
  const [w, h] = promoSize(p), U = w / 1050, t = promoTheme(p.theme);
  const panel = lum(t.bg[0]) > 0.6 ? t.accent : t.bg[0], panel2 = lum(t.bg[0]) > 0.6 ? t.accent : t.bg[1];
  const stripe = lum(t.bg[0]) > 0.6 ? t.ink : t.accent;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
  const pw = w * 0.36;
  const g = ctx.createLinearGradient(0, 0, pw, h); g.addColorStop(0, panel); g.addColorStop(1, panel2);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(pw + 50 * U, 0); ctx.lineTo(pw - 30 * U, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = stripe;
  ctx.beginPath(); ctx.moveTo(pw + 50 * U, 0); ctx.lineTo(pw + 66 * U, 0); ctx.lineTo(pw - 14 * U, h); ctx.lineTo(pw - 30 * U, h); ctx.closePath(); ctx.fill();

  // left: logo / photo or initials, then the business name
  const lx = pw / 2 - 10 * U, ink = on(panel);
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const r = 92 * U;
  if (photo) {
    const b = place("photo", lx - r, 120 * U, r * 2, r * 2);
    if (!b.hidden) photoRound(ctx, photo, b.x + b.w / 2, b.y + b.h / 2, b.w / 2, stripe);
  } else {
    const initials = (p.org || p.name || "?").split(/\s+/).filter((x) => /\p{L}/u.test(x)).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
    ctx.strokeStyle = stripe; ctx.lineWidth = 7 * U;
    ctx.beginPath(); ctx.arc(lx, 120 * U + r, r, 0, 7); ctx.stroke();
    ctx.fillStyle = ink; ctx.font = `800 ${80 * U}px ${SANS}`;
    say(ctx, "initials", initials, lx, 120 * U + r + 28 * U);
  }
  if (p.org) {
    ctx.fillStyle = ink; ctx.font = `700 ${34 * U}px ${SANS}`;
    wrap(ctx, p.org, pw - 70 * U).slice(0, 3).forEach((l, i) => say(ctx, `org.${i}`, l, lx, 380 * U + i * 42 * U));
  }

  // right: name, designation, contact lines
  const x = pw + 100 * U, right = w - 50 * U;
  const qrSize = 150 * U, hasQr = !!p.qr;
  ctx.textAlign = "left";
  ctx.fillStyle = "#1b1b1b";
  fitFont(ctx, p.name || "Your Name", (n) => `800 ${n}px ${SANS}`, 58 * U, right - x);
  say(ctx, "name", p.name || "Your Name", x, 140 * U);
  if (p.highlight) { ctx.fillStyle = panel === "#ffffff" ? t.ink : panel; ctx.font = `600 ${30 * U}px ${SANS}`; say(ctx, "highlight", p.highlight, x, 188 * U); }
  ctx.fillStyle = stripe; ctx.fillRect(x, 216 * U, 90 * U, 6 * U);
  const rows: [string, string][] = [];
  if (p.phone) rows.push(["☎", p.phone]);
  for (const l of p.points.split("\n").map((s) => s.trim()).filter(Boolean)) rows.push([l.includes("@") ? "✉" : "◉", l]);
  if (p.address) rows.push(["⌂", p.address]);
  let y = 290 * U;
  rows.slice(0, 5).forEach(([icon, text], i) => {
    const maxW = right - x - 50 * U - (hasQr && y > h - qrSize - 80 * U ? qrSize + 20 * U : 0);
    ctx.fillStyle = panel === "#ffffff" ? t.ink : panel;
    ctx.beginPath(); ctx.arc(x + 16 * U, y - 10 * U, 19 * U, 0, 7); ctx.fill();
    ctx.fillStyle = on(panel === "#ffffff" ? t.ink : panel); ctx.font = `700 ${20 * U}px ${SANS}`; ctx.textAlign = "center";
    ctx.fillText(icon, x + 16 * U, y - 3 * U);
    ctx.textAlign = "left"; ctx.fillStyle = "#333333";
    fitFont(ctx, text, (n) => `500 ${n}px ${SANS}`, 28 * U, maxW);
    say(ctx, `row.${i}`, text, x + 50 * U, y);
    y += 58 * U;
  });
  if (hasQr) {
    const q = place("qr", w - qrSize - 36 * U, h - qrSize - 36 * U, qrSize, qrSize);
    if (!q.hidden) drawQr(ctx, p.qr, q.x, q.y, q.w, { ...t, accent: stripe });
  }
}

function certificate(ctx: CanvasRenderingContext2D, p: Promo, photo: Pic | null) {
  const [w, h] = promoSize(p), U = w / 1754, t = promoTheme(p.theme);
  const light = lum(t.bg[0]) > 0.6;
  const paper: [string, string] = light ? t.bg : ["#fffdf6", "#f4ead2"];
  const frame = light ? t.accent : t.bg[0], gold = light ? t.soft : t.accent, ink = light ? t.ink : "#2a2a2a";
  const hi = p.lang !== "en", en = p.lang !== "hi";
  const cx = w / 2;
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createRadialGradient(cx, h / 2, h * 0.1, cx, h / 2, w * 0.7);
  g.addColorStop(0, paper[0]); g.addColorStop(1, paper[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // borders and corner diamonds
  ctx.strokeStyle = frame; ctx.lineWidth = 22 * U; ctx.strokeRect(34 * U, 34 * U, w - 68 * U, h - 68 * U);
  ctx.strokeStyle = gold; ctx.lineWidth = 4 * U; ctx.strokeRect(66 * U, 66 * U, w - 132 * U, h - 132 * U);
  ctx.lineWidth = 2 * U; ctx.strokeRect(78 * U, 78 * U, w - 156 * U, h - 156 * U);
  ctx.fillStyle = gold;
  for (const [x, y] of [[72, 72], [w / U - 72, 72], [72, h / U - 72], [w / U - 72, h / U - 72]]) {
    ctx.beginPath(); ctx.moveTo(x * U, (y - 26) * U); ctx.lineTo((x + 26) * U, y * U); ctx.lineTo(x * U, (y + 26) * U); ctx.lineTo((x - 26) * U, y * U); ctx.closePath(); ctx.fill();
  }

  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  let y = 170 * U;
  if (photo) {
    const r = 62 * U;
    const b = place("photo", cx - r, 110 * U, r * 2, r * 2);
    if (!b.hidden) photoRound(ctx, photo, b.x + b.w / 2, b.y + b.h / 2, b.w / 2, gold);
    y = 300 * U;
  }
  if (p.org) { ctx.fillStyle = frame; fitFont(ctx, p.org.toUpperCase(), (n) => `700 ${n}px ${SERIF}`, 44 * U, w * 0.7); say(ctx, "org", p.org.toUpperCase(), cx, y); y += 110 * U; }
  else y += 50 * U;

  const title = hi && !en ? p.titleHi || p.title : p.title || "Certificate";
  const m = title.match(/^certificate\s+(of\s+.+)$/i);
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if (m) {
    ctx.fillStyle = ink;
    if ("letterSpacing" in ctx) spaced.letterSpacing = `${14 * U}px`;
    ctx.font = `800 ${104 * U}px ${SERIF}`;
    say(ctx, "title", "CERTIFICATE", cx, y);
    if ("letterSpacing" in ctx) spaced.letterSpacing = "0px";
    y += 92 * U;
    ctx.fillStyle = gold; ctx.font = `${78 * U}px ${SCRIPT}`;
    say(ctx, "title.of", m[1].replace(/^of/i, "of"), cx, y); y += 60 * U;
  } else {
    ctx.fillStyle = ink;
    fitFont(ctx, title, (n) => `800 ${n}px ${SERIF}`, 96 * U, w * 0.72);
    say(ctx, "title", title, cx, y); y += 70 * U;
  }
  if (hi && en && p.titleHi) { ctx.fillStyle = frame; ctx.font = `600 ${42 * U}px ${SERIF}`; say(ctx, "title.hi", p.titleHi, cx, y + 10 * U); y += 60 * U; }
  y += 40 * U;
  ctx.fillStyle = ink; ctx.font = `italic 400 ${34 * U}px ${SERIF}`;
  say(ctx, "presented", en ? "This certificate is proudly presented to" : "यह प्रमाण पत्र सम्मानपूर्वक प्रदान किया जाता है", cx, y);
  y += 120 * U;
  ctx.fillStyle = frame;
  const name = p.name || "Name";
  fitFont(ctx, name, (n) => `${n}px ${SCRIPT}`, 130 * U, w * 0.6);
  say(ctx, "name", name, cx, y);
  ctx.fillStyle = gold; ctx.fillRect(cx - 420 * U, y + 26 * U, 840 * U, 3 * U);
  y += 90 * U;
  const reason = p.points.split("\n").map((s) => s.trim()).filter(Boolean).join(" ");
  if (reason) {
    ctx.fillStyle = ink; ctx.font = `italic 400 ${34 * U}px ${SERIF}`;
    wrap(ctx, reason, w * 0.62).slice(0, 3).forEach((l, i) => { say(ctx, `reason.${i}`, l, cx, y); y += 48 * U; });
  }

  // bottom: date and signature lines, seal in the middle or the top corner
  const slots: { id: string; value: string; label: string }[] = [];
  if (p.date) slots.push({ id: "date", value: formatDate(p.date, hi && !en).replace(/^[^,]+,\s*/, ""), label: hi && !en ? "दिनांक" : "Date" });
  p.highlight.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3).forEach((s, i) => slots.push({ id: `sign.${i}`, value: "", label: s }));
  const base = h - 200 * U;
  const xs = slots.length <= 2 ? [0.24, 0.76] : slots.length === 3 ? [0.2, 0.5, 0.8] : [0.17, 0.39, 0.61, 0.83];
  const xsUsed = slots.length === 1 ? [0.24] : xs;
  slots.forEach((s, i) => {
    const x = w * xsUsed[i];
    ctx.strokeStyle = ink; ctx.lineWidth = 2 * U;
    ctx.beginPath(); ctx.moveTo(x - 170 * U, base); ctx.lineTo(x + 170 * U, base); ctx.stroke();
    if (s.value) { ctx.fillStyle = ink; ctx.font = `600 ${30 * U}px ${SERIF}`; say(ctx, `${s.id}.value`, s.value, x, base - 16 * U); }
    ctx.fillStyle = ink; ctx.font = `400 ${28 * U}px ${SERIF}`; say(ctx, s.id, s.label, x, base + 42 * U);
  });
  const seal = slots.length <= 2 ? place("seal", cx - 95 * U, base - 150 * U, 190 * U, 190 * U) : place("seal", w - 330 * U, 120 * U, 190 * U, 190 * U);
  if (!seal.hidden) {
    const sx = seal.x + seal.w / 2, sy = seal.y + seal.h / 2, sr = seal.w / 2;
    ctx.fillStyle = frame;
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx + sd * sr * 0.2, sy); ctx.lineTo(sx + sd * sr * 0.65, sy + sr * 1.35); ctx.lineTo(sx + sd * sr * 0.4, sy + sr * 1.2); ctx.lineTo(sx + sd * sr * 0.1, sy + sr * 1.4); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = gold; star(ctx, sx, sy, sr, 24, 0.88); ctx.fill();
    ctx.strokeStyle = on(gold) === "#111111" ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.6)"; ctx.lineWidth = 3 * U;
    ctx.beginPath(); ctx.arc(sx, sy, sr * 0.72, 0, 7); ctx.stroke();
    ctx.fillStyle = frame; star(ctx, sx, sy, sr * 0.42, 5, 0.45); ctx.fill();
  }
}
