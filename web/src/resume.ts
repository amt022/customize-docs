/**
 * Resume & Career Studio: the career profile (entered once), resume versions, 10 templates laid out
 * as PDF pages (real text in the standard PDF fonts, so ATS software can read it), a canvas preview
 * of exactly those pages, Word (.docx) and plain-text versions. Everything runs in the browser.
 */
import { AFM } from "./afm";
import { zip } from "./wrap";

// ================================================================ data
export interface Edu { id: string; degree: string; school: string; board: string; year: string; score: string }
export interface Job { id: string; role: string; org: string; place: string; from: string; to: string; points: string }
export interface Project { id: string; name: string; tech: string; link: string; points: string }

/** The Career Profile Vault: everything about the person, typed once, reused by every resume and letter. */
export interface Profile {
  name: string; headline: string; email: string; phone: string; city: string; linkedin: string; website: string;
  summary: string;
  /** one group per line ("Programming: Java, Python") or just a comma list */
  skills: string;
  languages: string;
  /** one per line */
  certifications: string;
  achievements: string;
  interests: string;
  education: Edu[]; jobs: Job[]; projects: Project[];
  // personal details asked by government / PSU / school jobs (bio-data style)
  dob: string; father: string; gender: string; category: string; nationality: string; marital: string; address: string;
  declaration: string; place: string;
}

export type ResumeType = "fresher" | "experienced" | "cv" | "govt";
export type SectionId = "personal" | "summary" | "jobs" | "education" | "projects" | "skills" | "certifications" | "achievements" | "languages" | "interests" | "declaration";
export type TemplateId = "classic" | "professional" | "modern" | "minimal" | "sidebar" | "executive" | "compact" | "elegant" | "fresher" | "biodata"
  | "monogram" | "campus" | "contrast" | "banner" | "timeline" | "plain" | "soft" | "pill" | "latex";

/** One resume made from the profile: its own type, look, job description and left-out parts. */
export interface Version {
  id: string; name: string; type: ResumeType; template: TemplateId; accent: string;
  /** job description pasted for matching */
  jd: string;
  /** section ids or entry ids left out of this version */
  hidden: string[];
  photo: boolean;
}

export const uid = () => Math.random().toString(36).slice(2, 9);

export const DECLARATION = "I hereby declare that the information given above is true and correct to the best of my knowledge and belief.";

export function blankProfile(): Profile {
  return {
    name: "", headline: "", email: "", phone: "", city: "", linkedin: "", website: "", summary: "",
    skills: "", languages: "", certifications: "", achievements: "", interests: "",
    education: [], jobs: [], projects: [],
    dob: "", father: "", gender: "", category: "", nationality: "Indian", marital: "", address: "", declaration: DECLARATION, place: "",
  };
}

export const TYPES: [ResumeType, string, string][] = [
  ["fresher", "Fresher", "Education and projects first, one page."],
  ["experienced", "Experienced", "Work experience first, achievements with numbers."],
  ["cv", "Academic CV", "Education, research, publications; can run longer."],
  ["govt", "Government job", "Bio-data style: personal details, marks table, declaration."],
];

export const ORDER: Record<ResumeType, SectionId[]> = {
  fresher: ["summary", "education", "projects", "skills", "jobs", "certifications", "achievements", "languages", "interests"],
  experienced: ["summary", "jobs", "skills", "projects", "education", "certifications", "achievements", "languages", "interests"],
  cv: ["summary", "education", "jobs", "projects", "achievements", "certifications", "skills", "languages", "interests"],
  govt: ["summary", "personal", "education", "jobs", "skills", "certifications", "achievements", "languages", "declaration"],
};

export function sectionTitle(id: SectionId, type: ResumeType): string {
  switch (id) {
    case "personal": return "Personal Details";
    case "summary": return type === "fresher" || type === "govt" ? "Career Objective" : type === "cv" ? "Profile" : "Professional Summary";
    case "jobs": return type === "fresher" ? "Internships & Experience" : type === "cv" ? "Academic & Professional Experience" : "Work Experience";
    case "education": return type === "govt" ? "Educational Qualifications" : "Education";
    case "projects": return type === "cv" ? "Research & Projects" : "Projects";
    case "skills": return type === "govt" ? "Skills & Computer Knowledge" : "Skills";
    case "certifications": return type === "cv" ? "Courses & Certifications" : "Certifications";
    case "achievements": return type === "cv" ? "Awards, Publications & Achievements" : "Achievements";
    case "languages": return "Languages";
    case "interests": return "Interests";
    case "declaration": return "Declaration";
  }
}

// ================================================================ templates
type Fam = "sans" | "serif";
interface Tpl {
  id: TemplateId; name: string; note: string; fam: Fam;
  header: "center" | "left" | "band" | "split" | "biodata" | "monogram" | "campus" | "stack" | "photoband" | "softband" | "bigphoto" | "scholar";
  heading: "rule" | "caps" | "bar" | "shade" | "underline" | "plain" | "roman" | "pill" | "margin" | "smallcaps";
  sidebar?: "left" | "right";
  /** sidebar width (pt) and look; default 168, light tint of the accent */
  sideW?: number;
  sideBg?: "tint" | "grey" | "dark" | "none";
  /** sections that go in the sidebar (default skills, languages, certifications, interests) */
  sideIds?: SectionId[];
  /** education as a table on every resume type */
  eduTable?: boolean;
  /** soft circles in two corners */
  blobs?: boolean;
  /** has a place for a photo; switched on when the template is picked and a photo exists */
  likesPhoto?: boolean;
  accent: string;
  /** body font size */
  size: number;
  /** single column, standard headings: what ATS software reads best */
  ats: boolean;
}

export const TEMPLATES: Tpl[] = [
  { id: "classic", name: "Classic", note: "Serif, centred name. Safe for any job.", fam: "serif", header: "center", heading: "rule", accent: "#1f2937", size: 10.5, ats: true },
  { id: "professional", name: "Professional", note: "Clean sans-serif with coloured headings.", fam: "sans", header: "left", heading: "rule", accent: "#1d4ed8", size: 10, ats: true },
  { id: "modern", name: "Modern", note: "Colour band header.", fam: "sans", header: "band", heading: "bar", accent: "#0f766e", size: 10, ats: true },
  { id: "minimal", name: "Minimal", note: "Lots of white space, no lines.", fam: "sans", header: "left", heading: "caps", accent: "#111827", size: 10, ats: true },
  { id: "sidebar", name: "Sidebar", note: "Two columns. Looks good; some ATS read columns out of order.", fam: "sans", header: "left", heading: "underline", sidebar: "left", accent: "#334155", size: 9.5, ats: false },
  { id: "executive", name: "Executive", note: "Senior roles: shaded headings.", fam: "serif", header: "split", heading: "shade", accent: "#7c2d12", size: 10.5, ats: true },
  { id: "compact", name: "Compact", note: "Smaller type to fit one page.", fam: "sans", header: "left", heading: "rule", accent: "#4338ca", size: 9, ats: true },
  { id: "elegant", name: "Elegant", note: "Serif with thin accent lines.", fam: "serif", header: "center", heading: "underline", accent: "#9d174d", size: 10.5, ats: true },
  { id: "fresher", name: "Fresher", note: "Right column for skills; projects stand out.", fam: "sans", header: "left", heading: "bar", sidebar: "right", accent: "#c2410c", size: 9.5, ats: false },
  { id: "biodata", name: "Bio-data", note: "Government / PSU style with photo box and declaration.", fam: "serif", header: "biodata", heading: "shade", accent: "#111827", size: 10.5, ats: true, likesPhoto: true },
  { id: "monogram", name: "Monogram", note: "Initials in a circle, grey side column for contact, education and skills.", fam: "sans", header: "monogram", heading: "rule", sidebar: "left", sideW: 176, sideBg: "grey", sideIds: ["education", "skills", "languages", "certifications", "interests"], accent: "#4b5563", size: 9.5, ats: false },
  { id: "campus", name: "Campus (India)", note: "The common Indian college format: RESUME title, objective, Class X / XII, internships.", fam: "serif", header: "campus", heading: "plain", accent: "#111111", size: 10.5, ats: true },
  { id: "contrast", name: "Contrast", note: "Big stacked name, dark side column with white text.", fam: "sans", header: "stack", heading: "caps", sidebar: "right", sideW: 190, sideBg: "dark", sideIds: ["education", "skills", "languages", "certifications", "interests"], accent: "#312e81", size: 9.5, ats: false },
  { id: "banner", name: "Photo banner", note: "Dark banner with a round photo, numbered headings and a contact table.", fam: "sans", header: "photoband", heading: "roman", accent: "#1e3a5f", size: 10, ats: true, likesPhoto: true },
  { id: "timeline", name: "Side labels", note: "Stacked name; section names in the left margin, content on the right.", fam: "sans", header: "stack", heading: "margin", accent: "#334155", size: 9.5, ats: true },
  { id: "plain", name: "Plain ATS", note: "No colour, no columns: the safest file for online job portals.", fam: "sans", header: "center", heading: "plain", accent: "#000000", size: 10, ats: true },
  { id: "soft", name: "Soft banner", note: "Light banner, round photo, highlighted name; education as a table.", fam: "sans", header: "softband", heading: "roman", eduTable: true, accent: "#d97757", size: 10, ats: true, likesPhoto: true },
  { id: "pill", name: "Pill headings", note: "Large name, round photo, two columns with rounded headings.", fam: "sans", header: "bigphoto", heading: "pill", sidebar: "left", sideW: 206, sideBg: "none", sideIds: ["summary", "skills", "languages", "certifications", "interests"], blobs: true, accent: "#ea7a3b", size: 9.5, ats: false, likesPhoto: true },
  { id: "latex", name: "LaTeX style", note: "Dense serif with small capitals, like resumes made in LaTeX; good for tech roles.", fam: "serif", header: "scholar", heading: "smallcaps", accent: "#1e40af", size: 9.5, ats: true },
];
export const tplOf = (id: TemplateId) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
export const ACCENTS = ["#1f2937", "#1d4ed8", "#0f766e", "#15803d", "#7c2d12", "#9d174d", "#6d28d9", "#c2410c", "#0e7490", "#b91c1c"];

export function newVersion(name: string, type: ResumeType = "fresher", template: TemplateId = "professional"): Version {
  return { id: uid(), name, type, template, accent: tplOf(template).accent, jd: "", hidden: [], photo: !!tplOf(template).likesPhoto };
}

// ================================================================ content model (shared by PDF, Word and text)
export type Block =
  | { k: "para"; text: string }
  | { k: "bullets"; items: string[] }
  | { k: "entry"; title: string; right: string; sub: string; subRight: string; bullets: string[]; id: string }
  | { k: "pairs"; rows: [string, string][] }
  | { k: "table"; head: string[]; rows: string[][]; widths: number[] }
  | { k: "skills"; groups: { label: string; items: string[] }[] }
  | { k: "inline"; text: string }
  | { k: "sign"; text: string; place: string; name: string };
export interface Section { id: SectionId; title: string; blocks: Block[] }

export const lines = (s: string) => s.split(/\n/).map((l) => l.replace(/^\s*[•●▪◦\-*–·]\s*/, "").trim()).filter(Boolean);
export const items = (s: string) => s.split(/[,;\n•|]/).map((x) => x.trim()).filter(Boolean);
const dates = (a: string, b: string) => (a && b ? `${a} – ${b}` : a || b);

export function skillGroups(s: string): { label: string; items: string[] }[] {
  const out: { label: string; items: string[] }[] = [];
  const loose: string[] = [];
  for (const l of s.split(/\n/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([^:]{2,40}):\s*(.+)$/.exec(l);
    if (m) out.push({ label: m[1].trim(), items: items(m[2]) });
    else loose.push(...items(l));
  }
  if (loose.length) out.unshift({ label: "", items: loose });
  return out;
}

export function contactItems(p: Profile): string[] {
  return [p.phone, p.email, p.city, p.linkedin.replace(/^https?:\/\/(www\.)?/, ""), p.website.replace(/^https?:\/\//, "")].map((x) => x.trim()).filter(Boolean);
}

/** The resume's sections in order, with empty and left-out parts dropped. */
export function sections(p: Profile, v: Version): Section[] {
  const hide = new Set(v.hidden);
  const out: Section[] = [];
  for (const id of ORDER[v.type]) {
    if (hide.has(id)) continue;
    const blocks: Block[] = [];
    switch (id) {
      case "summary": if (p.summary.trim()) blocks.push({ k: "para", text: p.summary.trim() }); break;
      case "personal": {
        const rows: [string, string][] = ([
          ["Father's name", p.father], ["Date of birth", p.dob ? fmtDate(p.dob) : ""], ["Gender", p.gender], ["Category", p.category],
          ["Nationality", p.nationality], ["Marital status", p.marital], ["Languages known", p.languages], ["Address", p.address],
        ] as [string, string][]).filter(([, x]) => x.trim());
        if (rows.length) blocks.push({ k: "pairs", rows });
        break;
      }
      case "jobs":
        for (const j of p.jobs) if (!hide.has(j.id) && (j.role || j.org)) blocks.push({ k: "entry", id: j.id, title: j.role || j.org, right: dates(j.from, j.to), sub: j.role ? j.org : "", subRight: j.place, bullets: lines(j.points) });
        break;
      case "education": {
        const eds = p.education.filter((e) => !hide.has(e.id) && (e.degree || e.school));
        if (!eds.length) break;
        if (v.type !== "govt" && tplOf(v.template).eduTable) blocks.push({ k: "table", head: ["Institution", "Degree / Class", "Marks / CGPA", "Year"], widths: [0.38, 0.32, 0.16, 0.14], rows: eds.map((e) => [e.school + (e.board ? `, ${e.board}` : ""), e.degree, e.score, e.year]) });
        else if (v.type === "govt") blocks.push({ k: "table", head: ["Examination / Degree", "Board / University / Institute", "Year", "Marks / CGPA"], widths: [0.27, 0.43, 0.12, 0.18], rows: eds.map((e) => [e.degree, e.school + (e.board ? `, ${e.board}` : ""), e.year, e.score]) });
        else for (const e of eds) blocks.push({ k: "entry", id: e.id, title: e.degree || e.school, right: e.year, sub: [e.degree ? e.school : "", e.board].filter(Boolean).join(", "), subRight: e.score, bullets: [] });
        break;
      }
      case "projects":
        for (const pr of p.projects) if (!hide.has(pr.id) && pr.name) blocks.push({ k: "entry", id: pr.id, title: pr.name, right: pr.link.replace(/^https?:\/\/(www\.)?/, ""), sub: pr.tech ? `Tools: ${pr.tech}` : "", subRight: "", bullets: lines(pr.points) });
        break;
      case "skills": { const g = skillGroups(p.skills); if (g.length) blocks.push({ k: "skills", groups: g }); break; }
      case "certifications": case "achievements": { const l = lines(p[id]); if (l.length) blocks.push({ k: "bullets", items: l }); break; }
      case "languages": if (v.type !== "govt" && p.languages.trim()) blocks.push({ k: "inline", text: items(p.languages).join(", ") }); break;
      case "interests": if (p.interests.trim()) blocks.push({ k: "inline", text: items(p.interests).join(", ") }); break;
      case "declaration": blocks.push({ k: "sign", text: p.declaration.trim() || DECLARATION, place: p.place, name: p.name }); break;
    }
    if (blocks.length) out.push({ id, title: sectionTitle(id, v.type), blocks });
  }
  return out;
}

export function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ================================================================ fonts (PDF standard 14, WinAnsi)
type Sty = "r" | "b" | "i";
const FACE: Record<Fam, Record<Sty, string>> = {
  sans: { r: "Helvetica", b: "Helvetica-Bold", i: "Helvetica-Oblique" },
  serif: { r: "Times-Roman", b: "Times-Bold", i: "Times-Italic" },
};
const HIGH: Record<number, number> = {};
"€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ".split("").forEach((c, i) => { HIGH[c.charCodeAt(0)] = 0x80 + i; });

/** WinAnsi code of a character, or null when the standard PDF fonts cannot show it (Hindi, emoji…). */
export function winAnsi(ch: string): number | null {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c < 127) return c;
  if (c >= 160 && c <= 255) return c;
  return HIGH[c] ?? null;
}

/** Text as the PDF will show it: rupee sign spelled out, other unknown characters as "?". */
export function pdfSafe(s: string): string {
  s = s.replace(/₹\s?/g, "Rs. ").replace(/[‐‑−]/g, "-").replace(/[\t  ​]/g, " ");
  let o = "";
  for (const ch of s) o += winAnsi(ch) == null ? "?" : ch;
  return o;
}

/** Characters in the profile the PDF fonts cannot show. */
export function unsupported(p: Profile): string[] {
  const bad = new Set<string>();
  const scan = (s: string) => { for (const ch of s.replace(/₹/g, "")) if (ch !== "\n" && winAnsi(ch) == null && !/[\t  ​‐‑−]/.test(ch)) bad.add(ch); };
  JSON.stringify(p, (_k, v) => { if (typeof v === "string") scan(v); return v; });
  return [...bad];
}

export function textWidth(s: string, face: string, size: number, sp = 0): number {
  const w = AFM[face];
  let n = 0;
  for (const ch of s) {
    const c = winAnsi(ch) ?? 63;
    n += w[c - 32] || w[63 - 32];
  }
  return (n * size) / 1000 + sp * Math.max(0, [...s].length - 1);
}

function wrap(s: string, face: string, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(s).split("\n")) {
    let line = "";
    for (const word of para.split(/ +/)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (textWidth(tryLine, face, size) <= max) { line = tryLine; continue; }
      if (line) out.push(line);
      // a single word wider than the line is cut
      let w = word;
      while (textWidth(w, face, size) > max && w.length > 1) {
        let i = w.length - 1;
        while (i > 1 && textWidth(w.slice(0, i), face, size) > max) i--;
        out.push(w.slice(0, i));
        w = w.slice(i);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

// ================================================================ page layout
export const A4: [number, number] = [595.28, 841.89];
export type Op =
  | { k: "t"; x: number; y: number; s: string; size: number; face: string; color: string; sp?: number }
  | { k: "r"; x: number; y: number; w: number; h: number; color: string; rr?: number; stroke?: number }
  | { k: "c"; x: number; y: number; r: number; color: string; stroke?: number }
  | { k: "l"; x1: number; y1: number; x2: number; y2: number; w: number; color: string }
  | { k: "img"; x: number; y: number; w: number; h: number; url: string; clip?: { x: number; y: number; r: number } };
export type Page = Op[];

const INK = "#1f2328", MUTED = "#555b63";

export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** One column of flowing text that breaks onto new pages. */
class Col {
  n = 0;
  ink = INK;
  muted = MUTED;
  /** heading colour in this column (white on a dark sidebar) */
  head?: string;
  constructor(
    private pages: () => Page[], private page: (n: number) => Page,
    public x: number, public w: number, public y: number, private top: number, private bottom: number,
    private fam: Fam,
  ) {}
  face(s: Sty) { return FACE[this.fam][s]; }
  need(h: number) {
    if (this.y + h > this.bottom) { this.n++; this.y = this.top; this.page(this.n); }
  }
  get ops() { this.pages(); return this.page(this.n); }
  /** one line of text whose box top is the current y; returns nothing, moves nothing */
  put(s: string, x: number, size: number, sty: Sty, color?: string, sp?: number) {
    if (s) this.ops.push({ k: "t", x, y: this.y + size * 0.8, s: pdfSafe(s), size, face: this.face(sty), color: color ?? this.ink, sp });
  }
  /** small capitals: lower-case letters drawn as smaller capitals on the same baseline; returns the width */
  putSC(s: string, x: number, size: number, sty: Sty, color?: string, sp = 0, draw = true): number {
    let cx = x;
    for (const m of pdfSafe(s).match(/[a-z]+|[^a-z]+/g) ?? []) {
      const low = /^[a-z]/.test(m);
      const t = low ? m.toUpperCase() : m, z = low ? size * 0.78 : size;
      if (draw) this.ops.push({ k: "t", x: cx, y: this.y + size * 0.8, s: t, size: z, face: this.face(sty), color: color ?? this.ink, sp });
      cx += textWidth(t, this.face(sty), z, sp) + sp;
    }
    return cx - x - sp;
  }
  /** wrapped paragraph */
  para(s: string, size: number, sty: Sty = "r", color?: string, indent = 0, lead = 1.32, align: "left" | "center" | "right" = "left") {
    for (const l of wrap(s, this.face(sty), size, this.w - indent)) {
      this.need(size * lead);
      const lw = textWidth(l, this.face(sty), size);
      const x = align === "center" ? this.x + (this.w - lw) / 2 : align === "right" ? this.x + this.w - lw : this.x + indent;
      this.put(l, x, size, sty, color);
      this.y += size * lead;
    }
  }
  /** text on the left and the right of one line (title + dates); the left side wraps if they collide */
  pair(left: string, right: string, size: number, ls: Sty, rs: Sty, lc?: string, rc?: string) {
    rc = rc ?? this.muted;
    const rw = right ? textWidth(pdfSafe(right), this.face(rs), size) : 0;
    const room = this.w - (rw ? rw + 10 : 0);
    const ll = left ? wrap(left, this.face(ls), size, room) : [""];
    this.need(size * 1.3 * Math.min(ll.length, 2));
    if (right) this.put(right, this.x + this.w - rw, size, rs, rc);
    ll.forEach((l, i) => { if (i) this.need(size * 1.3); this.put(l, this.x, size, ls, lc); this.y += size * 1.3; });
  }
  bullets(list: string[], size: number, color?: string) {
    const face = this.face("r");
    for (const b of list) {
      const ls = wrap(b, face, size, this.w - 12);
      ls.forEach((l, i) => {
        this.need(size * 1.3);
        if (!i) this.put("•", this.x + 2, size, "r", color);
        this.put(l, this.x + 12, size, "r", color);
        this.y += size * 1.3;
      });
      this.y += size * 0.12;
    }
  }
  rect(x: number, y: number, w: number, h: number, color: string, rr?: number, stroke?: number) { this.ops.push({ k: "r", x, y, w, h, color, rr, stroke }); }
  circle(x: number, y: number, r: number, color: string, stroke?: number) { this.ops.push({ k: "c", x, y, r, color, stroke }); }
  line(x1: number, y1: number, x2: number, y2: number, w: number, color: string) { this.ops.push({ k: "l", x1, y1, x2, y2, w, color }); }
}

export interface Layout { pages: Page[]; size: [number, number] }

/** Lay the resume out on A4 pages. `photo` is a JPEG data URL (35×45 ratio) or null. */
export function layoutResume(p: Profile, v: Version, photo: string | null): Layout {
  const tpl = tplOf(v.template);
  const [W, H] = A4;
  const acc = v.accent || tpl.accent;
  const accent = acc;
  const pages: Page[] = [];
  const side = tpl.sidebar;
  const sideW = side ? tpl.sideW ?? 168 : 0;
  const bg = tpl.sideBg ?? "tint";
  const M = tpl.id === "compact" ? 34 : 42;
  const page = (n: number) => {
    while (pages.length <= n) {
      const pg: Page = [];
      pages.push(pg);
      if (tpl.blobs) {
        pg.push({ k: "c", x: -18, y: -22, r: 78, color: tint(acc, 0.78) }, { k: "c", x: 62, y: -48, r: 46, color: tint(acc, 0.88) });
        pg.push({ k: "c", x: W + 24, y: H + 18, r: 92, color: tint(acc, 0.8) });
      }
      if (side && bg !== "none") {
        pg.push({ k: "r", x: side === "left" ? 0 : W - sideW, y: 0, w: sideW, h: H,
          color: bg === "dark" ? acc : bg === "grey" ? "#ececec" : side === "left" ? tint(acc, 0.9) : tint(acc, 0.93) });
      }
    }
    return pages[n];
  };
  page(0);
  const base = tpl.size;
  const hsize = base + 1.6;
  const showPhoto = !!(v.photo && photo);
  const ph = { w: 72, h: 92 };
  // ---------------------------------------------------------- columns
  const LABEL = tpl.heading === "margin" ? 112 : 0;
  const mainX = side === "left" ? sideW + (bg === "none" ? 8 : 26) : M + LABEL;
  const mainW = side === "left" ? W - mainX - M : side === "right" ? W - sideW - M - 22 : W - 2 * M - LABEL;
  const m = new Col(() => pages, page, mainX, mainW, M, M, H - M, tpl.fam);
  const s = side ? new Col(() => pages, page, side === "left" ? (bg === "none" ? M : 22) : W - sideW + 18, side === "left" && bg === "none" ? sideW - M - 10 : sideW - 40, M, M, H - M, tpl.fam) : null;
  if (s && bg === "dark") { s.ink = "#ffffff"; s.muted = tint(acc, 0.72); s.head = "#ffffff"; }
  const initials = (p.name || "Your Name").split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase());
  const mono = initials.length > 1 ? `${initials[0]} | ${initials[initials.length - 1]}` : initials[0] ?? "";
  /** a round photo (cropped from the 35:45 passport picture), or the initials in a circle */
  const roundPhoto = (c: Col, cx: number, cy: number, r: number, ring: string, fill: string, ink: string) => {
    if (showPhoto) {
      const w = 2 * r, h = w * 45 / 35;
      c.ops.push({ k: "img", x: cx - r, y: cy - r - (h - w) * 0.3, w, h, url: photo!, clip: { x: cx, y: cy, r } });
    } else {
      c.circle(cx, cy, r, fill);
      const t = initials.slice(0, 2).join("");
      const z = r * 0.72, f = FACE[tpl.fam].b;
      const y0 = c.y; c.y = cy - z * 0.42;
      c.put(t, cx - textWidth(t, f, z) / 2, z, "b", ink);
      c.y = y0;
    }
    c.circle(cx, cy, r + 1.5, ring, 2);
  };
  /** two-column bordered table of label / value rows (contact table) */
  const kvTable = (c: Col, rows: [string, string][]) => {
    const lw = Math.min(110, c.w * 0.26), size = base - 0.5, pad = 4;
    for (const [k, val] of rows) {
      const ls = wrap(val, c.face("r"), size, c.w - lw - 2 * pad);
      const h = ls.length * size * 1.3 + 2 * pad;
      c.need(h);
      const y0 = c.y;
      c.rect(c.x, y0, lw, h, "#f3f4f6");
      c.y = y0 + pad; c.put(k + ":", c.x + pad, size, "b");
      ls.forEach((l) => { c.put(l, c.x + lw + pad, size, "r"); c.y += size * 1.3; });
      c.rect(c.x, y0, c.w, h, "#c4c8ce", 0, 0.6);
      c.line(c.x + lw, y0, c.x + lw, y0 + h, 0.6, "#c4c8ce");
      c.y = y0 + h;
    }
    c.y += 10;
  };

  // ---------------------------------------------------------- header
  const contacts = contactItems(p);
  const name = p.name || "Your Name";
  const nameFace = FACE[tpl.fam].b;
  const contactRows = ([["Address", [p.address && v.type === "govt" ? p.address : "", p.city].filter(Boolean).join(", ")], ["Phone", p.phone], ["Email", p.email],
    ["LinkedIn", p.linkedin.replace(/^https?:\/\/(www\.)?/, "")], ["Website", p.website.replace(/^https?:\/\//, "")]] as [string, string][]).filter(([, x]) => x.trim());
  const docTitle = `${p.headline ? p.headline.replace(/\s+resume$/i, "") + " " : ""}Resume`;
  if (tpl.header === "monogram") {
    // initials in a ring at the top of the grey column, spaced capitals for the name
    const r = 44, cx = sideW / 2, cy = M + r;
    m.circle(cx, cy, r, INK, 1.6);
    const z = 24, f = FACE[tpl.fam].r;
    m.y = cy - z * 0.42;
    m.put(mono, cx - textWidth(mono, f, z) / 2, z, "r", INK);
    s!.y = cy + r + 26;
    m.rect(sideW, 0, W - sideW, 112, "#f6f6f6");
    m.y = M + 4;
    const nm = name.toUpperCase();
    let nz = 26;
    while (nz > 14 && textWidth(nm, f, nz, 3) > mainW) nz -= 1;
    m.put(nm, mainX, nz, "r", INK, 3);
    m.y += nz * 1.3;
    if (p.headline) { m.put(p.headline.toUpperCase(), mainX, base, "r", MUTED, 1.2); m.y += base * 1.6; }
    m.y = Math.max(m.y, 112) + 18;
  } else if (tpl.header === "campus") {
    const f = FACE.sans.b;
    m.ops.push({ k: "t", x: (W - textWidth("RESUME", f, 24)) / 2, y: m.y + 20, s: "RESUME", size: 24, face: f, color: INK });
    m.y += 40;
    m.para(name, 13, "b");
    m.y += 2;
    const l1 = [p.address && v.type === "govt" ? p.address : "", p.city].filter(Boolean).join(" | ");
    const l2 = [p.email, p.phone, p.linkedin.replace(/^https?:\/\/(www\.)?/, ""), p.website.replace(/^https?:\/\//, "")].filter(Boolean).join(" | ");
    if (l1) m.para(l1, base, "r");
    if (l2) m.para(l2, base, "r");
    m.line(mainX, m.y + 1, mainX + mainW, m.y + 1, 0.8, INK);
    m.y += 10;
  } else if (tpl.header === "stack") {
    const parts = name.trim().split(/\s+/);
    const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0], last = parts.length > 1 ? parts[parts.length - 1] : "";
    const cw = side ? 0 : 190;
    const room = mainW + LABEL - cw;
    const x0 = side ? mainX : M;
    let nz = 32;
    while (nz > 16 && Math.max(textWidth(pdfSafe(first.toUpperCase()), FACE[tpl.fam].b, nz, 1), textWidth(pdfSafe(last.toUpperCase()), FACE[tpl.fam].b, nz, 1)) > room) nz -= 1;
    const top = m.y;
    m.put(first.toUpperCase(), x0, nz, "b", side ? INK : acc, 1); m.y += nz * 1.05;
    if (last) { m.put(last.toUpperCase(), x0, nz, "b", side ? acc : INK, 1); m.y += nz * 1.15; }
    if (p.headline) { m.put(p.headline.toUpperCase(), x0, base, "r", MUTED, 1.6); m.y += base * 1.7; }
    const ly = m.y;
    if (!side) {
      m.y = top + 4;
      for (const c of contacts) {
        for (const l of wrap(c, FACE[tpl.fam].r, base - 0.5, cw)) {
          m.put(l, W - M - textWidth(l, FACE[tpl.fam].r, base - 0.5), base - 0.5, "r", INK);
          m.y += (base - 0.5) * 1.45;
        }
      }
    }
    m.y = Math.max(ly, m.y) + 8;
    if (!side) { m.line(M, m.y, W - M, m.y, 2, acc); m.y += 6; } else m.y += 6;
  } else if (tpl.header === "photoband" || tpl.header === "softband") {
    const soft = tpl.header === "softband";
    const bh = soft ? 118 : 122, r = 44;
    m.rect(0, 0, W, bh, soft ? tint(acc, 0.8) : acc);
    if (soft) m.rect(0, bh - 4, W, 4, acc);
    roundPhoto(m, M + r, bh / 2, r, soft ? "#ffffff" : tint(acc, 0.5), soft ? tint(acc, 0.55) : tint(acc, 0.25), "#ffffff");
    const tx = M + 2 * r + 24, tw = W - tx - M;
    let nz = 26;
    const nm = soft ? name : `${name.toUpperCase()}`;
    while (nz > 15 && textWidth(pdfSafe(nm), FACE[tpl.fam].b, nz) > tw - 16) nz -= 1;
    m.y = bh / 2 - nz * 0.75 - (p.headline ? 8 : 0);
    if (!soft && p.headline) { m.put(p.headline, tx, base, "r", tint(acc, 0.7)); m.y += base * 1.5; }
    if (soft) {
      const nw = textWidth(pdfSafe(nm), FACE[tpl.fam].b, nz);
      m.rect(tx - 6, m.y - 3, nw + 12, nz * 1.25, tint(acc, 0.55), 3);
    }
    m.put(nm, tx, nz, "b", soft ? INK : "#ffffff");
    m.y += nz * 1.35;
    if (soft && p.headline) {
      const hw = textWidth(pdfSafe(p.headline), FACE[tpl.fam].r, base);
      m.rect(tx, m.y, hw + 16, base * 1.7, acc, base * 0.85, 0.9);
      m.y += base * 0.35;
      m.put(p.headline, tx + 8, base, "r", INK);
    }
    m.y = bh + 22;
    m.para(docTitle, 17, "b", INK, 0, 1.3, "center");
    m.y += 8;
    if (contactRows.length) kvTable(m, contactRows);
  } else if (tpl.header === "bigphoto") {
    const r = showPhoto ? 50 : 0;
    const room = W - 2 * M - (r ? 2 * r + 20 : 0);
    m.y = M + 6;
    if (p.headline) { m.put(p.headline, M, base + 1, "r", MUTED); m.y += base * 1.7; }
    let nz = 34;
    const nm = name.toUpperCase();
    while (nz > 16 && textWidth(pdfSafe(nm), FACE[tpl.fam].b, nz) > room) nz -= 1;
    m.put(nm, M, nz, "b", INK);
    m.y += nz * 1.3;
    if (r) roundPhoto(m, W - M - r, M + r + 4, r, acc, tint(acc, 0.8), acc);
    m.y = Math.max(m.y, r ? M + 2 * r + 16 : 0) + 8;
    s!.y = m.y;
  } else if (tpl.header === "scholar") {
    m.y += 2;
    const nw = m.putSC(name, 0, 24, "r", INK, 0.5, false);
    m.putSC(name, (W - nw) / 2, 24, "r", INK, 0.5);
    m.y += 30;
    if (p.headline) m.para(p.headline, base + 1, "i", MUTED, 0, 1.35, "center");
    m.para(contacts.join("  |  "), base - 0.5, "r", INK, 0, 1.35, "center");
    m.y += 4;
  } else if (tpl.header === "band") {
    const bandH = 30 + 28 + (p.headline ? 18 : 0) + 30 + (showPhoto ? 6 : 0);
    const bh = Math.max(bandH, showPhoto ? ph.h + 30 : 0);
    m.rect(0, 0, W, bh, acc);
    const right = showPhoto ? ph.w + 14 : 0;
    m.y = 28;
    m.put(name, M, 25, "b", "#ffffff"); m.y += 32;
    if (p.headline) { m.put(p.headline, M, 12, "r", tint(acc, 0.82)); m.y += 18; }
    const cw = W - 2 * M - right;
    for (const l of wrap(contacts.join("   |   "), FACE[tpl.fam].r, base - 0.5, cw)) { m.put(l, M, base - 0.5, "r", "#ffffff"); m.y += (base - 0.5) * 1.35; }
    if (showPhoto) m.ops.push({ k: "img", x: W - M - ph.w, y: (bh - ph.h) / 2, w: ph.w, h: ph.h, url: photo! });
    m.y = bh + 18;
  } else if (tpl.header === "biodata") {
    const title = "RESUME";
    const tw = textWidth(title, nameFace, 15, 3);
    m.put(title, (W - tw) / 2, 15, "b", acc, 3);
    m.y += 20;
    m.line((W - tw) / 2, m.y, (W + tw) / 2, m.y, 1, acc);
    m.y += 16;
    const top = m.y;
    const room = showPhoto ? mainW - ph.w - 16 : mainW;
    const saveW = m.w; m.w = room;
    m.para(name, 18, "b", INK, 0, 1.25);
    if (p.headline) m.para(p.headline, base + 0.5, "i", MUTED);
    m.y += 3;
    for (const [k, val] of [["Mobile", p.phone], ["Email", p.email], ["Address", p.city]] as const) if (val) m.para(`${k}: ${val}`, base, "r", INK, 0, 1.4);
    m.w = saveW;
    if (showPhoto) {
      m.ops.push({ k: "img", x: mainX + mainW - ph.w, y: top - 4, w: ph.w, h: ph.h, url: photo! });
      m.line(mainX + mainW - ph.w, top - 4, mainX + mainW, top - 4, 0.6, INK);
      m.y = Math.max(m.y, top + ph.h + 2);
    }
    m.y += 6;
    m.line(mainX, m.y, mainX + mainW, m.y, 1.2, acc);
    m.y += 12;
  } else if (tpl.header === "center") {
    if (showPhoto) m.ops.push({ k: "img", x: mainX + mainW - ph.w, y: M - 6, w: ph.w, h: ph.h, url: photo! });
    const room = showPhoto ? mainW - 2 * (ph.w + 10) : mainW;
    const sx = m.x, sw = m.w; m.x = mainX + (mainW - room) / 2; m.w = room;
    m.para(tpl.id === "elegant" ? name.toUpperCase() : name, 23, "b", tpl.id === "elegant" ? acc : INK, 0, 1.2, "center");
    if (p.headline) m.para(p.headline, base + 1.5, "i", MUTED, 0, 1.4, "center");
    m.y += 2;
    m.para(contacts.join("  •  "), base - 0.5, "r", INK, 0, 1.35, "center");
    m.x = sx; m.w = sw;
    if (showPhoto) m.y = Math.max(m.y, M - 6 + ph.h);
    m.y += 6;
    if (tpl.id === "classic") { m.line(mainX, m.y, mainX + mainW, m.y, 1.4, acc); m.line(mainX, m.y + 2.5, mainX + mainW, m.y + 2.5, 0.5, acc); m.y += 14; }
    else { m.line(W / 2 - 40, m.y, W / 2 + 40, m.y, 1, acc); m.y += 14; }
  } else if (tpl.header === "split") {
    const top = m.y;
    const cw = Math.min(200, mainW * 0.4);
    const sw = m.w; m.w = mainW - cw - 12 - (showPhoto ? ph.w + 12 : 0);
    m.para(name, 24, "b", acc, 0, 1.15);
    if (p.headline) m.para(p.headline, base + 1.5, "r", MUTED, 0, 1.4);
    const ly = m.y;
    m.w = sw;
    if (showPhoto) m.ops.push({ k: "img", x: mainX + mainW - ph.w, y: top - 6, w: ph.w, h: ph.h, url: photo! });
    m.y = top + 2;
    const cx = mainX + mainW - (showPhoto ? ph.w + 12 : 0);
    for (const c of contacts) {
      for (const l of wrap(c, FACE[tpl.fam].r, base - 0.5, cw)) {
        m.put(l, cx - textWidth(l, FACE[tpl.fam].r, base - 0.5), base - 0.5, "r", INK);
        m.y += (base - 0.5) * 1.4;
      }
    }
    m.y = Math.max(m.y, ly, showPhoto ? top - 6 + ph.h : 0) + 6;
    m.rect(mainX, m.y, mainW, 2.5, acc);
    m.y += 16;
  } else {
    // left
    const top = m.y;
    const sw = m.w;
    if (showPhoto && !side) { m.ops.push({ k: "img", x: mainX + mainW - ph.w, y: top - 6, w: ph.w, h: ph.h, url: photo! }); m.w = mainW - ph.w - 14; }
    const big = tpl.id === "compact" ? 20 : 24;
    m.para(name, big, "b", tpl.id === "professional" || tpl.id === "fresher" ? acc : INK, 0, 1.15);
    if (p.headline) m.para(p.headline, base + 2, tpl.id === "minimal" ? "r" : "b", tpl.id === "professional" ? INK : tpl.id === "minimal" ? MUTED : acc, 0, 1.4);
    if (!side) { m.y += 1; m.para(contacts.join("   |   "), base - 0.5, "r", MUTED, 0, 1.4); }
    m.w = sw;
    if (showPhoto && !side) m.y = Math.max(m.y, top - 6 + ph.h);
    m.y += tpl.id === "minimal" ? 16 : 6;
    if (tpl.id !== "minimal") { m.line(mainX, m.y, mainX + mainW, m.y, tpl.id === "compact" ? 0.8 : 1.2, side ? tint(acc, 0.5) : acc); m.y += 14; }
  }

  // ---------------------------------------------------------- headings
  let roman = 0;
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  const heading = (c: Col, title: string, narrow = false) => {
    c.y += c.y > M + 4 ? (tpl.id === "compact" ? 6 : 9) : 0;
    c.need(hsize * 1.6 + base * 3);
    const face = c.face("b");
    const acc = c.head ?? accent;
    // a long title in a narrow column gets smaller instead of running off the page
    const fit = (t: string, size: number, sp: number, room: number) => {
      let z = size;
      while (z > 6.5 && textWidth(pdfSafe(t), face, z, sp) > room) z -= 0.25;
      return z;
    };
    switch (tpl.heading) {
      case "rule": {
        const t = title.toUpperCase();
        c.put(t, c.x, fit(t, hsize, 0.6, c.w), "b", acc, 0.6);
        c.y += hsize * 1.25;
        c.line(c.x, c.y, c.x + c.w, c.y, 0.7, tint(acc, 0.35));
        c.y += 5;
        break;
      }
      case "caps": {
        const t = title.toUpperCase();
        c.put(t, c.x, fit(t, hsize - 1.5, 1.6, c.w), "b", acc, 1.6);
        c.y += hsize * 1.55;
        break;
      }
      case "bar":
        c.rect(c.x, c.y - 1, 3.5, hsize + 3, acc);
        c.put(title, c.x + 10, fit(title, hsize + 0.5, 0, c.w - 10), "b", c.head ?? INK);
        c.y += hsize * 1.65;
        break;
      case "shade": {
        const h = hsize * 1.75;
        c.rect(c.x, c.y, c.w, h, tpl.id === "biodata" ? "#e5e7eb" : tint(acc, 0.88));
        c.y += (h - hsize) / 2;
        const tt = tpl.id === "biodata" ? title.toUpperCase() : title;
        c.put(tt, c.x + 7, fit(tt, hsize, tpl.id === "biodata" ? 0.5 : 0, c.w - 14), "b", tpl.id === "biodata" ? INK : acc, tpl.id === "biodata" ? 0.5 : 0);
        c.y += hsize + (h - hsize) / 2 + 6;
        break;
      }
      case "underline": {
        const t = title.toUpperCase();
        c.put(t, c.x, fit(t, hsize - (narrow ? 1 : 0.5), 1, c.w), "b", acc, 1);
        c.y += hsize * 1.3;
        c.line(c.x, c.y, c.x + Math.min(36, textWidth(t, face, hsize, 1)), c.y, 1.6, acc);
        c.y += 7;
        break;
      }
      case "plain":
        c.put(title, c.x, fit(title, hsize + 0.5, 0, c.w), "b", acc === "#000000" ? INK : acc);
        c.y += hsize * 1.4;
        c.line(c.x, c.y, c.x + c.w, c.y, 0.8, acc === "#000000" ? INK : acc);
        c.y += 6;
        break;
      case "roman": {
        const t = c === m ? `${ROMAN[roman++] ?? roman}. ${title}` : title;
        c.put(t, c.x, fit(t, hsize + 1, 0, c.w), "b", INK);
        c.y += hsize * 1.45;
        c.line(c.x, c.y, c.x + c.w, c.y, 0.8, tint(acc, 0.45));
        c.y += 7;
        break;
      }
      case "pill": {
        const t = title.toUpperCase();
        const z = fit(t, hsize - 1, 1.2, c.w - 28);
        const h = z * 2;
        c.rect(c.x, c.y, Math.min(c.w, textWidth(pdfSafe(t), face, z, 1.2) + 30), h, acc, h / 2, 1.2);
        c.y += (h - z) / 2;
        c.put(t, c.x + 15, z, "b", acc, 1.2);
        c.y += z + (h - z) / 2 + 8;
        break;
      }
      case "margin": {
        // the section name sits in the left margin, level with its first line
        c.y += 2;
        c.line(M, c.y, W - M, c.y, 0.6, "#d4d7dc");
        c.y += 9;
        const t = title.toUpperCase();
        const ls = wrap(t, face, hsize - 2.5, LABEL - 12);
        const y0 = c.y;
        ls.forEach((l, i) => { c.y = y0 + i * (hsize - 1.5) * 1.15; c.put(l, M, hsize - 2.5, "b", acc, 0.8); });
        c.y = y0;
        break;
      }
      case "smallcaps":
        c.putSC(title, c.x, hsize + 1.5, "r", acc, 0.4);
        c.y += (hsize + 1.5) * 1.25;
        c.line(c.x, c.y, c.x + c.w, c.y, 0.7, acc);
        c.y += 5;
        break;
    }
  };

  // ---------------------------------------------------------- blocks
  const block = (c: Col, b: Block, narrow: boolean) => {
    const size = narrow ? base - 0.5 : base;
    switch (b.k) {
      case "para": c.para(b.text, size); c.y += 2; break;
      case "inline": c.para(b.text, size); c.y += 2; break;
      case "bullets": c.bullets(b.items, size); break;
      case "skills":
        if (narrow) {
          for (const g of b.groups) {
            if (g.label) { c.para(g.label, size, "b", undefined, 0, 1.35); }
            for (const it of g.items) c.para(it, size, "r", undefined, 0, 1.35);
            c.y += 4;
          }
        } else {
          for (const g of b.groups) {
            if (!g.label) { c.para(g.items.join(", "), size); continue; }
            const lw = textWidth(pdfSafe(g.label + ": "), c.face("b"), size);
            const rest = wrap(g.items.join(", "), c.face("r"), size, c.w - lw);
            c.need(size * 1.32);
            c.put(g.label + ":", c.x, size, "b");
            rest.forEach((l, i) => { if (i) c.need(size * 1.32); c.put(l, c.x + lw, size, "r"); c.y += size * 1.32; });
            c.y += 1;
          }
        }
        c.y += 2;
        break;
      case "entry":
        c.need(size * 3.2);
        c.pair(b.title, b.right, size + 0.5, "b", "r", undefined, c.muted);
        if (b.sub || b.subRight) c.pair(b.sub, b.subRight, size, "i", "r", c.head ? c.muted : tpl.heading === "caps" || tpl.heading === "plain" || tpl.heading === "smallcaps" ? MUTED : tint(acc, 0.05), c.muted);
        c.y += 1.5;
        if (b.bullets.length) c.bullets(b.bullets, size);
        c.y += tpl.id === "compact" ? 3 : 5;
        break;
      case "pairs": {
        const lw = Math.min(130, c.w * 0.32);
        for (const [k, val] of b.rows) {
          const ls = wrap(val, c.face("r"), size, c.w - lw - 10);
          c.need(size * 1.4);
          c.put(k, c.x, size, "b");
          c.put(":", c.x + lw - 6, size, "r");
          ls.forEach((l, i) => { if (i) c.need(size * 1.4); c.put(l, c.x + lw + 4, size, "r"); c.y += size * 1.45; });
        }
        c.y += 3;
        break;
      }
      case "table": {
        const ws = b.widths.map((f) => f * c.w);
        const pad = 4;
        const row = (cells: string[], bold: boolean) => {
          const wrapped = cells.map((t, i) => wrap(t || "-", c.face(bold ? "b" : "r"), size - 0.5, ws[i] - 2 * pad));
          const h = Math.max(...wrapped.map((w) => w.length)) * (size - 0.5) * 1.3 + 2 * pad;
          c.need(h);
          const y0 = c.y;
          if (bold) c.rect(c.x, y0, c.w, h, tpl.eduTable ? tint(acc, 0.85) : "#f1f2f4");
          let x = c.x;
          wrapped.forEach((ls, i) => {
            c.y = y0 + pad;
            for (const l of ls) { c.put(l, x + pad, size - 0.5, bold ? "b" : "r"); c.y += (size - 0.5) * 1.3; }
            x += ws[i];
          });
          // borders
          c.line(c.x, y0, c.x + c.w, y0, 0.6, "#8b9097");
          c.line(c.x, y0 + h, c.x + c.w, y0 + h, 0.6, "#8b9097");
          x = c.x;
          for (const w of [0, ...ws]) { x += w; c.line(x, y0, x, y0 + h, 0.6, "#8b9097"); }
          c.y = y0 + h;
        };
        row(b.head, true);
        for (const r of b.rows) row(r, false);
        c.y += 8;
        break;
      }
      case "sign": {
        c.para(b.text, size);
        c.need(size * 6);
        c.y += size * 1.6;
        const y0 = c.y;
        c.put(`Place: ${b.place}`, c.x, size, "r");
        c.y += size * 1.6;
        c.put("Date:", c.x, size, "r");
        const sig = `(${b.name || "Signature"})`;
        const sw = textWidth(pdfSafe(sig), c.face("b"), size);
        c.put(sig, c.x + c.w - sw, size, "b");
        c.y = y0 - size * 0.6;
        c.put("Signature", c.x + c.w - Math.max(sw, 60), size - 1, "r", c.muted);
        c.y = y0 + size * 3;
        break;
      }
    }
  };

  // ---------------------------------------------------------- body
  const SIDE_IDS: SectionId[] = tpl.sideIds ?? ["skills", "languages", "certifications", "interests"];
  const all = sections(p, v);
  if (s) {
    if (showPhoto && tpl.header !== "bigphoto") {
      if (tpl.header === "monogram") { /* the ring holds the initials; no photo box */ }
      else { s.ops.push({ k: "img", x: s.x + (s.w - 96) / 2, y: s.y, w: 96, h: 123, url: photo! }); s.y += 123 + 16; }
    }
    heading(s, "Contact", true);
    for (const cItem of contacts) { s.para(cItem, base - 0.5, "r", undefined, 0, 1.35); s.y += 3; }
    s.y += 4;
  }
  if (tpl.header === "bigphoto" || (tpl.header === "stack" && side)) m.y = Math.max(m.y, M);
  for (const sec of all) {
    const c = s && SIDE_IDS.includes(sec.id) ? s : m;
    heading(c, sec.title, c === s);
    for (const b of sec.blocks) block(c, b, c === s);
  }
  if (pages.length > 1) {
    pages.forEach((pg, i) => {
      const t = `${pdfSafe(name)}  ·  page ${i + 1} of ${pages.length}`;
      pg.push({ k: "t", x: W - M - textWidth(t, FACE[tpl.fam].r, 7.5), y: H - 20, s: t, size: 7.5, face: FACE[tpl.fam].r, color: "#9097a0" });
    });
  }
  return { pages, size: [W, H] };
}

// ================================================================ cover letter layout
export type LetterStyle = "simple" | "framed";
export function layoutLetter(p: Profile, body: string, v: Version, style: LetterStyle = "simple"): Layout {
  const tpl = tplOf(v.template);
  const [W, H] = A4;
  const acc = v.accent || tpl.accent;
  const pages: Page[] = [];
  const framed = style === "framed";
  const page = (n: number) => {
    while (pages.length <= n) pages.push(framed ? [{ k: "r", x: 24, y: 24, w: W - 48, h: H - 48, color: INK, stroke: 1.4 }] : []);
    return pages[n];
  };
  page(0);
  const M = 62;
  const c = new Col(() => pages, page, M, W - 2 * M, M - 8, M, H - M, tpl.fam);
  if (framed) {
    const nm = (p.name || "Your Name").toUpperCase(), f = FACE[tpl.fam].r;
    let nz = 28;
    while (nz > 16 && textWidth(pdfSafe(nm), f, nz, 4) > W - 2 * M) nz -= 1;
    c.y += 6;
    c.put(nm, (W - textWidth(pdfSafe(nm), f, nz, 4)) / 2, nz, "r", INK, 4);
    c.y += nz * 1.4;
    if (p.headline) { const h = p.headline.toUpperCase(); c.put(h, (W - textWidth(pdfSafe(h), f, 10, 2)) / 2, 10, "r", MUTED, 2); c.y += 18; }
    c.para(contactItems(p).join("  |  "), 9.5, "r", INK, 0, 1.4, "center");
    c.y += 6;
    c.line(W / 2 - 60, c.y, W / 2 + 60, c.y, 0.8, INK);
    c.y += 22;
  } else {
    c.para(p.name || "Your Name", 20, "b", acc, 0, 1.2);
    if (p.headline) c.para(p.headline, 11, "i", MUTED);
    c.para(contactItems(p).join("  |  "), 9.5, "r", MUTED, 0, 1.4);
    c.y += 6;
    c.line(M, c.y, W - M, c.y, 1, acc);
    c.y += 20;
  }
  for (const para of body.split(/\n/)) {
    if (!para.trim()) { c.y += 7; continue; }
    c.para(para, 11, "r", INK, 0, 1.42);
  }
  return { pages, size: [W, H] };
}

// ================================================================ painting
const STACK: Record<string, string> = {
  Helvetica: "Arial, 'Liberation Sans', Arimo, Helvetica, sans-serif",
  "Times-Roman": "'Times New Roman', 'Liberation Serif', Tinos, Times, serif",
};
function cssFont(face: string, size: number) {
  const fam = face.startsWith("Times") ? STACK["Times-Roman"] : STACK.Helvetica;
  const w = /Bold/.test(face) ? "bold " : "";
  const i = /Italic|Oblique/.test(face) ? "italic " : "";
  return `${i}${w}${size}px ${fam}`;
}

export function paintPage(ctx: CanvasRenderingContext2D, pg: Page, scale: number, imgs: Map<string, HTMLImageElement>, size: [number, number] = A4) {
  const sp = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size[0], size[1]);
  ctx.textBaseline = "alphabetic";
  for (const o of pg) {
    if (o.k === "r") {
      ctx.beginPath();
      if (o.rr) ctx.roundRect(o.x, o.y, o.w, o.h, o.rr); else ctx.rect(o.x, o.y, o.w, o.h);
      if (o.stroke) { ctx.strokeStyle = o.color; ctx.lineWidth = o.stroke; ctx.stroke(); } else { ctx.fillStyle = o.color; ctx.fill(); }
    } else if (o.k === "c") {
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      if (o.stroke) { ctx.strokeStyle = o.color; ctx.lineWidth = o.stroke; ctx.stroke(); } else { ctx.fillStyle = o.color; ctx.fill(); }
    }
    else if (o.k === "l") { ctx.strokeStyle = o.color; ctx.lineWidth = o.w; ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke(); }
    else if (o.k === "img") {
      const im = imgs.get(o.url);
      ctx.save();
      if (o.clip) { ctx.beginPath(); ctx.arc(o.clip.x, o.clip.y, o.clip.r, 0, Math.PI * 2); ctx.clip(); }
      if (im?.complete) ctx.drawImage(im, o.x, o.y, o.w, o.h); else { ctx.strokeStyle = "#999"; ctx.strokeRect(o.x, o.y, o.w, o.h); }
      ctx.restore();
    }
    else {
      ctx.font = cssFont(o.face, o.size);
      ctx.fillStyle = o.color;
      if ("letterSpacing" in sp) sp.letterSpacing = `${o.sp ?? 0}px`;
      ctx.fillText(o.s, o.x, o.y);
    }
  }
  if ("letterSpacing" in sp) sp.letterSpacing = "0px";
}

// ================================================================ PDF writer (text stays text)
const enc = new TextEncoder();
function concat(parts: (Uint8Array | string)[]): Uint8Array {
  const bufs = parts.map((x) => (typeof x === "string" ? enc.encode(x) : x));
  const out = new Uint8Array(bufs.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of bufs) { out.set(b, o); o += b.length; }
  return out;
}
function pdfStr(s: string): string {
  let o = "(";
  for (const ch of s) {
    const c = winAnsi(ch) ?? 63;
    if (c === 40 || c === 41 || c === 92) o += "\\" + ch;
    else if (c < 32 || c > 126) o += "\\" + c.toString(8).padStart(3, "0");
    else o += ch;
  }
  return o + ")";
}
const num = (n: number) => (Math.round(n * 100) / 100).toString();
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => num(v / 255)).join(" ");
};
function dataUrlBytes(url: string): Uint8Array {
  const b = atob(url.slice(url.indexOf(",") + 1));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function jpegSize(b: Uint8Array): [number, number] {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return [1, 1];
}

/** Circle as four Bézier curves (PDF coordinates). */
function circlePath(cx: number, cy: number, r: number): string {
  const k = r * 0.5523;
  return `${num(cx + r)} ${num(cy)} m ${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c `
    + `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c `
    + `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c `
    + `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c h`;
}
/** Rounded rectangle; x, y = bottom-left in PDF coordinates. */
function roundRectPath(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h / 2);
  const k = r * 0.5523;
  return `${num(x + r)} ${num(y)} m ${num(x + w - r)} ${num(y)} l ${num(x + w - r + k)} ${num(y)} ${num(x + w)} ${num(y + r - k)} ${num(x + w)} ${num(y + r)} c `
    + `${num(x + w)} ${num(y + h - r)} l ${num(x + w)} ${num(y + h - r + k)} ${num(x + w - r + k)} ${num(y + h)} ${num(x + w - r)} ${num(y + h)} c `
    + `${num(x + r)} ${num(y + h)} l ${num(x + r - k)} ${num(y + h)} ${num(x)} ${num(y + h - r + k)} ${num(x)} ${num(y + h - r)} c `
    + `${num(x)} ${num(y + r)} l ${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c h`;
}

export function pagesToPdf(layout: Layout, title: string, author: string): Blob {
  const [W, H] = layout.size;
  const objs: (Uint8Array | string)[][] = [];
  const add = (...o: (Uint8Array | string)[]) => { objs.push(o); return objs.length; };
  const catalog = add(""), pagesId = add("");
  const fonts = new Map<string, number>();
  const images = new Map<string, number>();
  const pageIds: number[] = [];
  for (const pg of layout.pages) {
    let s = "";
    for (const o of pg) {
      if (o.k === "r") {
        const path = o.rr ? roundRectPath(o.x, H - o.y - o.h, o.w, o.h, o.rr) : `${num(o.x)} ${num(H - o.y - o.h)} ${num(o.w)} ${num(o.h)} re`;
        s += o.stroke ? `${rgb(o.color)} RG ${num(o.stroke)} w ${path} S\n` : `${rgb(o.color)} rg ${path} f\n`;
      } else if (o.k === "c") {
        s += o.stroke ? `${rgb(o.color)} RG ${num(o.stroke)} w ${circlePath(o.x, H - o.y, o.r)} S\n` : `${rgb(o.color)} rg ${circlePath(o.x, H - o.y, o.r)} f\n`;
      }
      else if (o.k === "l") s += `${rgb(o.color)} RG ${num(o.w)} w ${num(o.x1)} ${num(H - o.y1)} m ${num(o.x2)} ${num(H - o.y2)} l S\n`;
      else if (o.k === "img") {
        if (!images.has(o.url)) {
          const b = dataUrlBytes(o.url);
          const [iw, ih] = jpegSize(b);
          images.set(o.url, add(`<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${b.length} >>\nstream\n`, b, "\nendstream"));
        }
        s += `q ${o.clip ? `${circlePath(o.clip.x, H - o.clip.y, o.clip.r)} W n ` : ""}${num(o.w)} 0 0 ${num(o.h)} ${num(o.x)} ${num(H - o.y - o.h)} cm /Im${images.get(o.url)} Do Q\n`;
      } else {
        if (!fonts.has(o.face)) fonts.set(o.face, add(`<< /Type /Font /Subtype /Type1 /BaseFont /${o.face} /Encoding /WinAnsiEncoding >>`));
        s += `BT /F${fonts.get(o.face)} ${num(o.size)} Tf ${rgb(o.color)} rg ${num(o.sp ?? 0)} Tc ${num(o.x)} ${num(H - o.y)} Td ${pdfStr(o.s)} Tj ET\n`;
      }
    }
    const content = add(`<< /Length ${s.length} >>\nstream\n${s}endstream`);
    pageIds.push(add(`__PAGE__${content}`));
  }
  const res = `<< /Font << ${[...fonts.values()].map((id) => `/F${id} ${id} 0 R`).join(" ")} >> /XObject << ${[...images.values()].map((id) => `/Im${id} ${id} 0 R`).join(" ")} >> >>`;
  for (const id of pageIds) {
    const content = (objs[id - 1][0] as string).slice(8);
    objs[id - 1] = [`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources ${res} /Contents ${content} 0 R >>`];
  }
  objs[catalog - 1] = [`<< /Type /Catalog /Pages ${pagesId} 0 R >>`];
  objs[pagesId - 1] = [`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`];
  const info = add(`<< /Title ${pdfStr(pdfSafe(title))} /Author ${pdfStr(pdfSafe(author))} /Producer (FormEasy) >>`);
  const parts: (Uint8Array | string)[] = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"];
  const offsets: number[] = [];
  let pos = concat(parts).length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const chunk = concat([`${i + 1} 0 obj\n`, ...o, "\nendobj\n"]);
    parts.push(chunk);
    pos += chunk.length;
  });
  parts.push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join(""));
  parts.push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`);
  return new Blob([concat(parts)], { type: "application/pdf" });
}

// ================================================================ Word (.docx): one column, real headings, Unicode
const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
interface Run { t: string; b?: boolean; i?: boolean; color?: string; size?: number }
function run(r: Run, font: string): string {
  const pr = `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="Nirmala UI"/>${r.b ? "<w:b/>" : ""}${r.i ? "<w:i/>" : ""}${r.color ? `<w:color w:val="${r.color.slice(1)}"/>` : ""}${r.size ? `<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>` : ""}</w:rPr>`;
  return r.t.split("\t").map((part, i) => `<w:r>${pr}${i ? "<w:tab/>" : ""}<w:t xml:space="preserve">${x(part)}</w:t></w:r>`).join("");
}
interface ParaOpt { align?: "center" | "left"; after?: number; before?: number; border?: string; tabRight?: boolean; hanging?: boolean; keep?: boolean; tabAt?: number }
function para(runs: Run[], font: string, o: ParaOpt = {}): string {
  const pPr = `<w:pPr>${o.keep ? "<w:keepNext/>" : ""}${o.border ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${o.border.slice(1)}"/></w:pBdr>` : ""}`
    + `${o.tabRight ? '<w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs>' : o.tabAt ? `<w:tabs><w:tab w:val="left" w:pos="${o.tabAt}"/></w:tabs>` : ""}`
    + `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 60}"/>${o.hanging ? '<w:ind w:left="284" w:hanging="284"/>' : ""}${o.align === "center" ? '<w:jc w:val="center"/>' : ""}</w:pPr>`;
  return `<w:p>${pPr}${runs.map((r) => run(r, font)).join("")}</w:p>`;
}

function docxPackage(body: string, title: string): Blob {
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const doc = X + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1134" w:bottom="1000" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const data = zip([
    { name: "[Content_Types].xml", data: X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: "_rels/.rels", data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: "docProps/core.xml", data: X + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
      + `<dc:title>${x(title)}</dc:title></cp:coreProperties>` },
    { name: "word/document.xml", data: doc },
  ]);
  return new Blob([data], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

export function resumeDocx(p: Profile, v: Version): Blob {
  const tpl = tplOf(v.template);
  const font = tpl.fam === "serif" ? "Times New Roman" : "Arial";
  const acc = v.accent || tpl.accent;
  const sz = tpl.size + 0.5;
  let body = "";
  body += para([{ t: p.name || "Your Name", b: true, size: 22, color: tpl.header === "center" || tpl.header === "biodata" ? undefined : acc }], font, { align: tpl.header === "center" || tpl.header === "biodata" ? "center" : "left", after: 40 });
  if (p.headline) body += para([{ t: p.headline, i: true, size: sz + 1 }], font, { align: tpl.header === "center" || tpl.header === "biodata" ? "center" : "left", after: 40 });
  body += para([{ t: contactItems(p).join("  |  "), size: sz - 0.5 }], font, { align: tpl.header === "center" || tpl.header === "biodata" ? "center" : "left", after: 160, border: acc });
  for (const sec of sections(p, v)) {
    body += para([{ t: sec.title.toUpperCase(), b: true, color: acc, size: sz + 1.5 }], font, { before: 200, after: 80, border: tint(acc, 0.4), keep: true });
    for (const b of sec.blocks) {
      switch (b.k) {
        case "para": case "inline": body += para([{ t: b.text, size: sz }], font); break;
        case "bullets": for (const it of b.items) body += para([{ t: `•\t${it}`, size: sz }], font, { hanging: true, after: 30 }); break;
        case "skills":
          for (const g of b.groups) body += para(g.label ? [{ t: g.label + ": ", b: true, size: sz }, { t: g.items.join(", "), size: sz }] : [{ t: g.items.join(", "), size: sz }], font, { after: 40 });
          break;
        case "entry":
          body += para([{ t: b.title, b: true, size: sz + 0.5 }, ...(b.right ? [{ t: `\t${b.right}`, size: sz }] : [])], font, { tabRight: true, after: 0, before: 80, keep: true });
          if (b.sub || b.subRight) body += para([{ t: b.sub, i: true, size: sz }, ...(b.subRight ? [{ t: `\t${b.subRight}`, size: sz }] : [])], font, { tabRight: true, after: 40, keep: !!b.bullets.length });
          for (const it of b.bullets) body += para([{ t: `•\t${it}`, size: sz }], font, { hanging: true, after: 30 });
          break;
        case "pairs": for (const [k, val] of b.rows) body += para([{ t: k, b: true, size: sz }, { t: `\t: ${val}`, size: sz }], font, { tabAt: 2600, after: 40 }); break;
        case "table": {
          const tw = 9638;
          const cell = (t: string, w: number, bold: boolean) => `<w:tc><w:tcPr><w:tcW w:w="${Math.round(w * tw)}" w:type="dxa"/>${bold ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F2F4"/>' : ""}</w:tcPr>${para([{ t: t || "-", b: bold, size: sz - 0.5 }], font, { after: 0 })}</w:tc>`;
          const border = '<w:top w:val="single" w:sz="4" w:color="8B9097"/><w:left w:val="single" w:sz="4" w:color="8B9097"/><w:bottom w:val="single" w:sz="4" w:color="8B9097"/><w:right w:val="single" w:sz="4" w:color="8B9097"/><w:insideH w:val="single" w:sz="4" w:color="8B9097"/><w:insideV w:val="single" w:sz="4" w:color="8B9097"/>';
          body += `<w:tbl><w:tblPr><w:tblW w:w="${tw}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`
            + `<w:tblGrid>${b.widths.map((w) => `<w:gridCol w:w="${Math.round(w * tw)}"/>`).join("")}</w:tblGrid>`
            + [b.head, ...b.rows].map((r, ri) => `<w:tr>${r.map((t, i) => cell(t, b.widths[i], ri === 0)).join("")}</w:tr>`).join("") + "</w:tbl>";
          body += para([{ t: "" }], font, { after: 0 });
          break;
        }
        case "sign":
          body += para([{ t: b.text, size: sz }], font, { after: 300 });
          body += para([{ t: `Place: ${b.place}`, size: sz }], font, { after: 60 });
          body += para([{ t: "Date:", size: sz }, { t: `\t(${b.name || "Signature"})`, b: true, size: sz }], font, { tabRight: true });
          break;
      }
    }
  }
  return docxPackage(body, `${p.name} resume`);
}

export function letterDocx(p: Profile, text: string, v: Version): Blob {
  const tpl = tplOf(v.template);
  const font = tpl.fam === "serif" ? "Times New Roman" : "Arial";
  let body = para([{ t: p.name || "Your Name", b: true, size: 18, color: v.accent || tpl.accent }], font, { after: 40 });
  body += para([{ t: contactItems(p).join("  |  "), size: 10 }], font, { after: 240, border: v.accent || tpl.accent });
  for (const l of text.split("\n")) body += para([{ t: l, size: 11 }], font, { after: l.trim() ? 0 : 120 });
  return docxPackage(body, `${p.name} cover letter`);
}

// ================================================================ plain text (for pasting into job portals)
export function resumeText(p: Profile, v: Version): string {
  const out: string[] = [p.name || "Your Name"];
  if (p.headline) out.push(p.headline);
  out.push(contactItems(p).join(" | "), "");
  for (const sec of sections(p, v)) {
    out.push(sec.title.toUpperCase());
    for (const b of sec.blocks) {
      switch (b.k) {
        case "para": case "inline": out.push(b.text); break;
        case "bullets": out.push(...b.items.map((i) => `- ${i}`)); break;
        case "skills": out.push(...b.groups.map((g) => (g.label ? `${g.label}: ` : "") + g.items.join(", "))); break;
        case "entry":
          out.push(b.title + (b.right ? ` (${b.right})` : ""));
          if (b.sub || b.subRight) out.push([b.sub, b.subRight].filter(Boolean).join(", "));
          out.push(...b.bullets.map((i) => `- ${i}`));
          break;
        case "pairs": out.push(...b.rows.map(([k, val]) => `${k}: ${val}`)); break;
        case "table": out.push(...b.rows.map((r) => r.filter(Boolean).join(" | "))); break;
        case "sign": out.push(b.text, `Place: ${b.place}`, "Date:", `(${b.name})`); break;
      }
    }
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}
