/**
 * Resume checks that run in the browser: ATS-style quality report, job-description matching,
 * wording tips for bullet points, summary / cover-letter drafts made only from the user's own facts,
 * and reading an old resume (PDF or Word) back into the profile.
 * Nothing here invents experience: suggestions only reorder or reword what the user typed.
 */
import { DECLARATION, blankProfile, items, lines, skillGroups, uid, type Profile, type ResumeType, type TemplateId, type Version, tplOf, sections, resumeText } from "./resume";

// ================================================================ wording tips
const WEAK: [RegExp, string[]][] = [
  [/^(worked on|working on)\b/i, ["Developed", "Built", "Delivered"]],
  [/^(was )?responsible for\b/i, ["Managed", "Led", "Owned"]],
  [/^(helped( in| with)?|assisted( in| with)?)\b/i, ["Supported", "Contributed to", "Coordinated"]],
  [/^(handled|handling)\b/i, ["Managed", "Resolved", "Processed"]],
  [/^(did|done|doing)\b/i, ["Completed", "Carried out", "Performed"]],
  [/^(made|making)\b/i, ["Created", "Prepared", "Designed"]],
  [/^(was )?(a )?part of\b/i, ["Collaborated on", "Contributed to"]],
  [/^(was )?involved in\b/i, ["Contributed to", "Took part in"]],
  [/^(in charge of|tasked with|duties included)\b/i, ["Led", "Supervised", "Managed"]],
  [/^(learn(ed|t)|got knowledge of)\b/i, ["Gained hands-on experience in", "Applied"]],
  [/^(used|using)\b/i, ["Applied", "Implemented with", "Automated with"]],
  [/^(looked after|took care of)\b/i, ["Maintained", "Managed", "Oversaw"]],
];

export const STRONG_VERBS = ["Achieved", "Analysed", "Automated", "Built", "Coordinated", "Created", "Delivered", "Designed", "Developed", "Improved", "Increased", "Launched", "Led", "Managed", "Mentored", "Organised", "Reduced", "Resolved", "Streamlined", "Trained"];

export interface Tip { text: string; replace?: { label: string; value: string }[] }

/** Tips for one bullet line. Rewrites only swap the opening phrase; the facts stay the user's. */
export function bulletTips(line: string): Tip[] {
  const l = line.trim();
  const out: Tip[] = [];
  if (!l) return out;
  for (const [re, verbs] of WEAK) {
    const m = re.exec(l);
    if (m) {
      const rest = l.slice(m[0].length).trim();
      out.push({ text: `"${m[0]}" sounds passive. Start with what you did:`, replace: verbs.map((v) => ({ label: v, value: `${v} ${rest}`.trim() })) });
      break;
    }
  }
  if (/^(i|my|me)\b/i.test(l)) out.push({ text: "Leave out \"I\" / \"my\": resumes start lines with the action." });
  if (!/\d/.test(l) && l.split(/\s+/).length >= 4) out.push({ text: "Add a number if you have a true one: how many, how much, how fast, or % change." });
  if (l.split(/\s+/).length > 32) out.push({ text: "Long line: keep each point under about 30 words." });
  return out;
}

// ================================================================ spelling and grammar (small, offline)
const MISSPELT: Record<string, string> = {
  recieve: "receive", recieved: "received", acheive: "achieve", acheived: "achieved", achivement: "achievement", achievment: "achievement",
  managment: "management", responsibilty: "responsibility", responsibilites: "responsibilities", experiance: "experience", enviroment: "environment",
  developement: "development", devlopment: "development", sucessful: "successful", sucessfully: "successfully", succesful: "successful", knowlege: "knowledge",
  comunication: "communication", communcation: "communication", seperate: "separate", occured: "occurred", begining: "beginning", grammer: "grammar",
  definately: "definitely", goverment: "government", govt: "government", bussiness: "business", buisness: "business", calender: "calendar", commited: "committed",
  independant: "independent", maintainance: "maintenance", maintenence: "maintenance", neccessary: "necessary", necessery: "necessary", occurence: "occurrence",
  persue: "pursue", persuing: "pursuing", prefered: "preferred", proffesional: "professional", profesional: "professional", refered: "referred",
  relevent: "relevant", untill: "until", wich: "which", writting: "writing", adress: "address", accomodate: "accommodate", analysys: "analysis",
  certificaion: "certification", cordinate: "coordinate", eficient: "efficient", efficent: "efficient", graduaton: "graduation", intrested: "interested",
  oppurtunity: "opportunity", oppertunity: "opportunity", organisaton: "organisation", qualifcation: "qualification", technolgy: "technology",
  hardwork: "hard work", knowledgable: "knowledgeable", carrer: "career", carreer: "career", objectve: "objective", skils: "skills", teh: "the",
  langauge: "language", languge: "language", priviledge: "privilege", lisence: "licence", liscense: "licence", reponsible: "responsible",
  performace: "performance", acurate: "accurate", accuracte: "accurate", excelent: "excellent", collegue: "colleague", appraoch: "approach",
};

export interface Issue { where: string; text: string }

export function spelling(text: string, where: string): Issue[] {
  const out: Issue[] = [];
  const seen = new Set<string>();
  for (const w of text.match(/[A-Za-z]+/g) ?? []) {
    const fix = MISSPELT[w.toLowerCase()];
    if (fix && !seen.has(w.toLowerCase()) && !(w === "Govt" || w === "govt")) { seen.add(w.toLowerCase()); out.push({ where, text: `"${w}" → "${fix}"` }); }
  }
  const dbl = /\b(\w+)\s+\1\b/i.exec(text);
  if (dbl && !/^\d+$/.test(dbl[1])) out.push({ where, text: `Repeated word "${dbl[1]} ${dbl[1]}"` });
  if (/ {2,}/.test(text)) out.push({ where, text: "Double spaces" });
  if (/\bi\b/.test(text)) out.push({ where, text: "Small \"i\" should be \"I\"" });
  if (/\s[,.;:]/.test(text)) out.push({ where, text: "Space before a comma or full stop" });
  return out;
}

// ================================================================ ATS / quality report
export type Level = "good" | "warn" | "bad";
export interface Check { level: Level; title: string; detail: string; fixes?: string[] }
export interface Report { score: number; checks: Check[]; words: number; cats: { name: string; score: number }[] }

/** Which part of the dashboard each check belongs to. */
const CAT: Record<string, string> = {
  "Contact details": "Format & ATS", "ATS readability": "Format & ATS", "Sections": "Format & ATS", "Length": "Format & ATS", "Readable text": "Format & ATS", "Standard headings": "Format & ATS",
  "Summary length": "Content", "Measurable achievements": "Content", "Action words": "Content", "Long points": "Content", "Experience / project points": "Content", "Dates": "Content", "Repeated lines": "Content",
  "Spelling and grammar": "Language",
  "Match with the job description": "Job match",
};
const WEIGHT: Record<Level, number> = { good: 1, warn: 0.5, bad: 0 };
function finish(checks: Check[], words: number): Report {
  const names = [...new Set(checks.map((c) => CAT[c.title] ?? "Content"))];
  const cats = names.map((name) => {
    const cs = checks.filter((c) => (CAT[c.title] ?? "Content") === name);
    return { name, score: Math.round((cs.reduce((n, c) => n + WEIGHT[c.level], 0) / cs.length) * 100) };
  });
  const score = checks.length ? Math.round((checks.reduce((n, c) => n + WEIGHT[c.level], 0) / checks.length) * 100) : 0;
  return { score, checks, words, cats };
}

const MONTHY = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/i;
function dateStyle(s: string): string {
  if (!s.trim() || /present|current|now|till date/i.test(s)) return "";
  if (MONTHY.test(s)) return "Mon YYYY";
  if (/^\d{1,2}[/.-]\d{4}$/.test(s.trim())) return "MM/YYYY";
  if (/^\d{4}$/.test(s.trim())) return "YYYY";
  return "other";
}

export function checkResume(p: Profile, v: Version, pages: number): Report {
  const checks: Check[] = [];
  const add = (level: Level, title: string, detail: string, fixes?: string[]) => checks.push({ level, title, detail, fixes });
  const text = resumeText(p, v);
  const words = (text.match(/\S+/g) ?? []).length;
  const tpl = tplOf(v.template);
  const secs = sections(p, v).map((s) => s.id);

  // contact
  const miss: string[] = [];
  if (!p.name.trim()) miss.push("name");
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(p.email.trim())) miss.push("a working email");
  if ((p.phone.replace(/\D/g, "").length) < 10) miss.push("a 10-digit mobile number");
  if (!p.city.trim()) miss.push("city");
  add(miss.length ? "bad" : "good", "Contact details", miss.length ? `Add ${miss.join(", ")}.` : "Name, email, mobile and city are there.");

  // layout readability
  add(tpl.ats ? "good" : "warn", "ATS readability", tpl.ats
    ? "One column, standard headings, real text in the PDF: applicant tracking systems can read it."
    : `"${tpl.name}" has two columns. Many ATS read it fine, some mix up the columns; for online job portals pick a one-column template or upload the Word file.`);

  // sections
  const need: [string, boolean][] = [["Summary / objective", secs.includes("summary")], ["Education", secs.includes("education")], ["Skills", secs.includes("skills")]];
  if (v.type === "experienced") need.push(["Work experience", secs.includes("jobs")]);
  if (v.type === "fresher") need.push(["Projects or internships", secs.includes("projects") || secs.includes("jobs")]);
  if (v.type === "govt") need.push(["Personal details", secs.includes("personal")], ["Declaration", secs.includes("declaration")]);
  const gone = need.filter(([, ok]) => !ok).map(([n]) => n);
  add(gone.length ? (gone.length > 1 ? "bad" : "warn") : "good", "Sections", gone.length ? `Missing: ${gone.join(", ")}.` : "All the usual sections are there.");

  // summary
  const sw = (p.summary.match(/\S+/g) ?? []).length;
  if (secs.includes("summary")) add(sw < 20 ? "warn" : sw > 90 ? "warn" : "good", "Summary length", sw < 20 ? `${sw} words: write 2–3 sentences (30–70 words) on who you are and what you offer.` : sw > 90 ? `${sw} words: keep it under about 70 words.` : `${sw} words.`);

  // achievements with numbers, weak openings
  const bullets = [...p.jobs.filter((j) => !v.hidden.includes(j.id)).flatMap((j) => lines(j.points)), ...p.projects.filter((x) => !v.hidden.includes(x.id)).flatMap((x) => lines(x.points))];
  if (bullets.length) {
    const withNum = bullets.filter((b) => /\d/.test(b)).length;
    const share = withNum / bullets.length;
    add(share >= 0.4 ? "good" : share >= 0.2 ? "warn" : "bad", "Measurable achievements", `${withNum} of ${bullets.length} points have a number (target: about half). Add real figures where you have them: users, sales, marks, time saved, team size.`);
    const weak = bullets.filter((b) => WEAK.some(([re]) => re.test(b)) || /^(i|my)\b/i.test(b));
    add(weak.length ? "warn" : "good", "Action words", weak.length ? `${weak.length} point(s) start weakly, e.g. "${weak[0].slice(0, 60)}". Tips appear under each point in the Profile tab.` : "Points start with action words.");
    const long = bullets.filter((b) => b.split(/\s+/).length > 32);
    if (long.length) add("warn", "Long points", `${long.length} point(s) are over 30 words; split them.`);
  } else if (v.type !== "govt") add("warn", "Experience / project points", "Add 2–4 points under each job or project describing what you did and the result.");

  // dates
  const styles = new Set([...p.jobs.flatMap((j) => [j.from, j.to])].map(dateStyle).filter(Boolean));
  const noDate = p.jobs.filter((j) => (j.role || j.org) && !j.from.trim()).length;
  add(styles.size > 1 || noDate ? "warn" : "good", "Dates", styles.size > 1 ? `Dates are written in ${styles.size} ways (${[...styles].join(", ")}); use one style, e.g. "Jun 2022 – Present".` : noDate ? `${noDate} job(s) have no start date.` : "Dates are consistent.");

  // duplicates
  const seen = new Map<string, number>();
  for (const l of text.split("\n").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 25)) seen.set(l, (seen.get(l) ?? 0) + 1);
  const dup = [...seen].filter(([, n]) => n > 1).length;
  add(dup ? "warn" : "good", "Repeated lines", dup ? `${dup} line(s) appear more than once.` : "No repeated lines.");

  // length
  const maxPages = v.type === "fresher" ? 1 : v.type === "cv" ? 4 : 2;
  add(pages > maxPages ? "warn" : words < 150 ? "warn" : "good", "Length", pages > maxPages
    ? `${pages} pages: ${v.type === "fresher" ? "freshers should fit one page" : "keep it to two pages"}. Try the Compact template or hide older items.`
    : words < 150 ? `${words} words: looks thin; add projects, skills or points.` : `${pages} page(s), ${words} words.`);

  // spelling
  const issues = [
    ...spelling(p.summary, "Summary"),
    ...p.jobs.flatMap((j) => spelling(`${j.role} ${j.org} ${j.points}`, j.role || "Job")),
    ...p.projects.flatMap((x) => spelling(`${x.name} ${x.points}`, x.name || "Project")),
    ...spelling(`${p.skills} ${p.certifications} ${p.achievements}`, "Skills / lists"),
  ];
  add(issues.length ? "warn" : "good", "Spelling and grammar", issues.length ? `${issues.length} thing(s) to fix.` : "No common mistakes found (this is a basic check, read it once more yourself).", issues.slice(0, 12).map((i) => `${i.where}: ${i.text}`));

  // job description
  if (v.jd.trim()) {
    const m = matchJob(text, v.jd);
    add(m.score >= 70 ? "good" : m.score >= 45 ? "warn" : "bad", "Match with the job description", `${m.score}% of the job's key terms appear. ${m.missing.length ? `Missing: ${m.missing.slice(0, 8).join(", ")}.` : ""}`);
  }

  return finish(checks, words);
}

/** Text-only checks for an uploaded resume file. */
export function checkText(text: string, jd: string): Report {
  const checks: Check[] = [];
  const add = (level: Level, title: string, detail: string, fixes?: string[]) => checks.push({ level, title, detail, fixes });
  const words = (text.match(/\S+/g) ?? []).length;
  if (words < 30) {
    add("bad", "Readable text", "Almost no text could be read. If this is a scanned picture, ATS software cannot read it either: make it from text (Word or this builder).");
    return { ...finish(checks, words), score: 0 };
  }
  add("good", "Readable text", `${words} words read from the file.`);
  const email = /[^@\s]+@[^@\s]+\.[a-z]{2,}/i.test(text), phone = /(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/.test(text);
  add(email && phone ? "good" : "bad", "Contact details", email && phone ? "Email and mobile found." : `Not found: ${[!email && "email", !phone && "mobile number"].filter(Boolean).join(", ")}.`);
  const heads = Object.entries(HEADINGS).filter(([, re]) => text.split("\n").some((l) => re.test(l.trim()) && l.trim().split(/\s+/).length <= 5)).map(([k]) => k);
  const wanted = ["summary", "experience", "education", "skills"];
  const missing = wanted.filter((h) => !heads.includes(h));
  add(missing.length > 1 ? "bad" : missing.length ? "warn" : "good", "Standard headings", missing.length ? `Could not find headings for: ${missing.join(", ")}. ATS look for plain headings like "Experience", "Education", "Skills".` : "Standard headings found.");
  const bl = text.split("\n").filter((l) => /^\s*[•●▪\-*–]/.test(l));
  if (bl.length) {
    const share = bl.filter((b) => /\d/.test(b)).length / bl.length;
    add(share >= 0.4 ? "good" : share >= 0.2 ? "warn" : "bad", "Measurable achievements", `${Math.round(share * 100)}% of bullet points have a number (target: about half).`);
  }
  const issues = spelling(text, "Resume");
  add(issues.length ? "warn" : "good", "Spelling and grammar", issues.length ? `${issues.length} thing(s) to fix.` : "No common mistakes found.", issues.slice(0, 12).map((i) => i.text));
  add(words > 1100 ? "warn" : words < 180 ? "warn" : "good", "Length", `${words} words${words > 1100 ? ": long for most jobs" : words < 180 ? ": looks thin" : ""}.`);
  if (jd.trim()) {
    const m = matchJob(text, jd);
    add(m.score >= 70 ? "good" : m.score >= 45 ? "warn" : "bad", "Match with the job description", `${m.score}% of the job's key terms appear. ${m.missing.length ? `Missing: ${m.missing.slice(0, 8).join(", ")}.` : ""}`);
  }
  return finish(checks, words);
}

// ================================================================ job description matching
const SKILLS = [
  // software
  "java", "python", "javascript", "typescript", "c++", "c#", "golang", "kotlin", "swift", "php", "ruby", "rust", "scala", "sql", "nosql", "html", "css",
  "react", "angular", "vue", "node.js", "express", "next.js", "spring", "spring boot", "hibernate", "django", "flask", "fastapi", ".net", "laravel",
  "rest api", "rest apis", "graphql", "microservices", "mysql", "postgresql", "mongodb", "redis", "oracle", "kafka", "rabbitmq", "elasticsearch",
  "aws", "azure", "gcp", "docker", "kubernetes", "jenkins", "ci/cd", "git", "github", "linux", "terraform", "devops", "agile", "scrum", "jira",
  "unit testing", "junit", "selenium", "automation testing", "manual testing", "api testing", "postman",
  "machine learning", "deep learning", "data analysis", "data science", "pandas", "numpy", "tensorflow", "pytorch", "nlp", "computer vision",
  "power bi", "tableau", "excel", "advanced excel", "vba", "statistics", "data visualization", "etl", "big data", "spark", "hadoop",
  "android", "ios", "flutter", "react native", "figma", "ui/ux", "photoshop", "illustrator", "canva", "autocad", "solidworks", "matlab",
  // business / finance / office
  "tally", "tally erp", "gst", "tds", "income tax", "accounts payable", "accounts receivable", "bank reconciliation", "financial reporting", "auditing",
  "budgeting", "forecasting", "financial analysis", "sap", "sap fico", "ms office", "ms word", "powerpoint", "bookkeeping", "payroll", "invoicing",
  "kyc", "aml", "credit appraisal", "loan processing", "banking operations", "customer service", "cross-selling", "retail banking", "risk management", "compliance",
  "sales", "b2b", "b2c", "lead generation", "crm", "salesforce", "negotiation", "digital marketing", "seo", "sem", "social media", "content writing",
  "google analytics", "google ads", "email marketing", "market research", "brand management", "business development", "key account management",
  "project management", "stakeholder management", "pmp", "prince2", "risk assessment", "resource planning", "vendor management", "procurement",
  "supply chain", "inventory management", "logistics", "operations", "quality control", "six sigma", "lean", "hr", "recruitment", "onboarding",
  // teaching / govt
  "lesson planning", "classroom management", "curriculum", "cbse", "icse", "b.ed", "ctet", "tet", "smart class", "assessment", "mentoring",
  "typing", "hindi typing", "english typing", "data entry", "noting and drafting", "file management", "rti", "o level", "ccc", "computer knowledge",
  // soft
  "communication", "leadership", "teamwork", "problem solving", "time management", "presentation", "analytical skills", "attention to detail",
];
const ALIAS: Record<string, string[]> = {
  javascript: ["js"], typescript: ["ts"], "node.js": ["nodejs", "node js", "node"], postgresql: ["postgres"], "rest api": ["restful", "rest apis", "rest"],
  "rest apis": ["rest api", "restful", "rest"], "ci/cd": ["cicd", "ci cd", "continuous integration"], excel: ["ms excel", "microsoft excel", "advanced excel"],
  "ms office": ["microsoft office", "ms-office"], "machine learning": ["ml"], kubernetes: ["k8s"], "ui/ux": ["ui ux", "user experience", "ux"],
  "tally erp": ["tally prime", "tally"], tally: ["tally erp", "tally prime"], gcp: ["google cloud"], aws: ["amazon web services"], "power bi": ["powerbi"],
  "spring boot": ["springboot"], "c++": ["cpp"], communication: ["communication skills"], hr: ["human resources"], "b.ed": ["bed", "b ed"],
};
const STOP = new Set("a an the and or of to in on for with at by from as is are be will can you your we our us their they this that these those it its who what which have has had should must may able ability across using use etc per about into over within all any other such also more most good strong excellent work working job role candidate candidates looking requirements required preferred plus years year experience knowledge skills skill team company opportunity responsibilities including include includes understanding hands related relevant based new well least minimum degree position apply join help day days need needs make ensure day-to-day like want".split(" "));

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9+#./ -]/g, " ").replace(/\s+/g, " ")} `;
function has(text: string, term: string): boolean {
  const all = [term, ...(ALIAS[term] ?? [])];
  return all.some((t) => {
    const esc = t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9+#])`).test(text);
  });
}

export interface Match { score: number; matched: string[]; missing: string[]; terms: string[] }

/** Key terms of a job description and which of them the resume has. */
export function matchJob(resume: string, jd: string): Match {
  const j = norm(jd), r = norm(resume);
  const terms = new Map<string, number>();
  for (const s of SKILLS) if (has(j, s)) {
    // keep the longer phrase when a shorter one is inside it (spring / spring boot)
    terms.set(s, (j.split(` ${s} `).length - 1) + 2);
  }
  for (const k of [...terms.keys()]) {
    let rest = j;
    for (const o of terms.keys()) if (o !== k && o.includes(k)) rest = rest.split(o).join(" ");
    if (rest !== j && !has(rest, k)) terms.delete(k);
  }
  // acronyms and repeated words the dictionary does not know
  for (const a of jd.match(/\b[A-Z][A-Z0-9+#.]{1,7}\b/g) ?? []) {
    const k = a.toLowerCase();
    if (!STOP.has(k) && k.length > 1 && !/^\d+$/.test(k) && ![...terms.keys()].some((t) => has(norm(t), k))) terms.set(k, (terms.get(k) ?? 0) + 1);
  }
  const freq = new Map<string, number>();
  for (const w of j.split(" ")) if (w.length > 3 && !STOP.has(w) && !/^\d/.test(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  for (const [w, n] of freq) if (n >= 3 && ![...terms.keys()].some((t) => t.includes(w))) terms.set(w, n);
  const list = [...terms].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 30);
  const matched = list.filter((t) => has(r, t));
  const missing = list.filter((t) => !has(r, t));
  return { score: list.length ? Math.round((matched.length / list.length) * 100) : 0, matched, missing, terms: list };
}

/** Jobs and projects whose points mention the job's terms: what to put first. */
export function relevant(p: Profile, m: Match): string[] {
  const out: [string, number][] = [];
  for (const j of p.jobs) { const t = norm(`${j.role} ${j.points}`); const n = m.matched.filter((k) => has(t, k)).length; if (n) out.push([`${j.role}${j.org ? `, ${j.org}` : ""}`, n]); }
  for (const x of p.projects) { const t = norm(`${x.name} ${x.tech} ${x.points}`); const n = m.matched.filter((k) => has(t, k)).length; if (n) out.push([x.name, n]); }
  return out.sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} (${n} matching term${n > 1 ? "s" : ""})`);
}

// ================================================================ drafts from the user's own facts
function years(p: Profile): number {
  let months = 0;
  const parse = (s: string): number | null => {
    if (/present|current|now|till/i.test(s)) { const d = new Date(); return d.getFullYear() * 12 + d.getMonth(); }
    const y = /(\d{4})/.exec(s);
    if (!y) return null;
    const mm = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.exec(s);
    return +y[1] * 12 + (mm ? "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(mm[1].toLowerCase()) / 3 : 0);
  };
  for (const j of p.jobs) { const a = parse(j.from), b = parse(j.to || "present"); if (a != null && b != null && b > a) months += b - a; }
  return Math.floor(months / 12);
}

const RANK: [RegExp, number][] = [
  [/ph\.?d|doctor/i, 9], [/\b(m\.?\s?tech|m\.?e\b|m\.?sc|m\.?com|m\.?a\b|mba|mca|master|post ?grad|ll\.?m|pgdm)/i, 8],
  [/\b(b\.?\s?tech|b\.?e\b|b\.?sc|b\.?com|b\.?a\b|bba|bca|bachelor|graduat|ll\.?b|b\.?ed|mbbs|b\.?pharm)/i, 7],
  [/diploma|polytechnic|\biti\b/i, 5], [/xii|12th|intermediate|higher secondary|hsc|senior secondary/i, 3], [/\bx\b|10th|high school|matric|ssc|secondary/i, 2],
];
const rank = (s: string) => RANK.find(([re]) => re.test(s))?.[1] ?? 6;
/** The highest qualification, whatever order the user typed them in. */
export const topEducation = (p: Profile) => [...p.education].filter((e) => e.degree || e.school).sort((a, b) => rank(b.degree) - rank(a.degree))[0];
const noDot = (s: string) => s.replace(/\.$/, "");

export function draftSummary(p: Profile, type: ResumeType): string {
  const sk = skillGroups(p.skills).flatMap((g) => g.items).slice(0, 4);
  const y = years(p);
  const ed = topEducation(p);
  const role = p.headline || p.jobs[0]?.role || "";
  const skillTxt = sk.length ? sk.slice(0, -1).join(", ") + (sk.length > 1 ? " and " : "") + sk[sk.length - 1] : "";
  if (type === "fresher" || type === "govt" || (!p.jobs.length && ed)) {
    const s1 = ed ? `${ed.degree || "Graduate"}${ed.school ? ` from ${ed.school}` : ""}${ed.score ? ` (${ed.score})` : ""}` : "Recent graduate";
    // a headline like "B.Sc. Graduate" is a qualification, not a job to seek
    const asRole = role && !/graduate|student|fresher|passed|class|\b[bm]\.?\s?(sc|com|a|tech|e)\b/i.test(role);
    return `${s1}${skillTxt ? ` with working knowledge of ${skillTxt}` : ""}. Seeking ${type === "govt" ? "a position" : asRole ? `a ${role} role` : "an entry-level role"} where I can apply my skills, learn quickly and contribute to the organisation's goals.`;
  }
  const last = p.jobs[0];
  return `${role || "Professional"}${y ? ` with ${y}+ year${y > 1 ? "s" : ""} of experience` : ""}${last?.org ? `, currently at ${noDot(last.org)}` : ""}${skillTxt ? `. Skilled in ${skillTxt}` : ""}. ${lines(last?.points ?? "").find((l) => /\d/.test(l)) ? `Recent work: ${lines(last.points).find((l) => /\d/.test(l))!.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}.` : ""}`.replace(/\s+/g, " ").trim();
}

export interface LetterInput { company: string; manager: string; role: string; city: string; tone: "formal" | "short" | "fresher"; jd: string; style?: "simple" | "framed" }

export function draftLetter(p: Profile, li: LetterInput): string {
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const to = li.manager.trim() || "Hiring Manager";
  const role = (li.role.trim() || p.headline || "the advertised position").replace(/^(applicant|application|applying)\s+for\s+(the\s+)?(post|position)\s+of\s+/i, "");
  const company = li.company.trim() || "your organisation";
  const m = li.jd.trim() ? matchJob(resumeTextQuick(p), li.jd) : null;
  const own = skillGroups(p.skills).flatMap((g) => g.items);
  // a matched term written the way the user (or else the advert) wrote it: "MS Office", not "ms office"
  const cased = (term: string) => {
    const mine = own.find((s) => norm(s).trim() === term || has(norm(s), term) && s.length <= term.length + 12);
    if (mine) return mine;
    const esc = term.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return new RegExp(esc, "i").exec(li.jd)?.[0] ?? term;
  };
  const skills = [...new Set((m?.matched.length ? m.matched.map(cased) : own))].slice(0, 4);
  const skillTxt = skills.length ? skills.slice(0, -1).join(", ") + (skills.length > 1 ? " and " : "") + skills[skills.length - 1] : "";
  const proof = [...p.jobs.flatMap((j) => lines(j.points)), ...p.projects.flatMap((x) => lines(x.points))].find((l) => /\d/.test(l));
  const last = p.jobs[0], ed = topEducation(p);
  const y = years(p);
  const intro = li.tone === "fresher" || !last
    ? `I recently completed ${ed?.degree || "my studies"}${ed?.school ? ` at ${ed.school}` : ""}${ed?.score ? ` with ${ed.score}` : ""}, and I am keen to begin my career with ${company}.`
    : `I am currently ${/^[aeiou]/i.test(last.role) ? "an" : "a"} ${last.role}${last.org ? ` at ${noDot(last.org)}` : ""}${y ? `, with ${y}+ year${y > 1 ? "s" : ""} of experience` : ""}.`;
  const head = [today, "", to, li.company.trim(), li.city.trim(), "", `Subject: Application for the post of ${role}`, "", `Dear ${to},`, ""].filter((l, i, a) => l || a[i - 1] !== "");
  const body = li.tone === "short"
    ? [
      `I would like to apply for the ${role} position at ${company}. ${intro}`,
      skillTxt ? `My skills in ${skillTxt} match what this role needs.${proof ? ` For example: ${proof.replace(/\.$/, "")}.` : ""}` : proof ? `For example: ${proof.replace(/\.$/, "")}.` : "",
      "My resume is attached. I would be glad to discuss how I can help your team.",
    ]
    : [
      `I am writing to apply for the ${role} position at ${company}. ${intro}`,
      skillTxt ? `I bring practical skills in ${skillTxt}.${proof ? ` In my recent work, I ${proof.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}.` : ""}` : proof ? `In my recent work, I ${proof.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}.` : "",
      `I am confident that my ${li.tone === "fresher" ? "training, eagerness to learn" : "experience"} and commitment would let me contribute to ${company} from the start. My resume is attached for your consideration.`,
      "Thank you for your time. I look forward to the opportunity to discuss my application with you.",
    ];
  const sign = ["", "Yours sincerely,", p.name || "Your Name", [p.phone, p.email].filter(Boolean).join(" | ")];
  return [...head, ...body.filter(Boolean).flatMap((b) => [b, ""]), ...sign.slice(1)].join("\n").replace(/\n{3,}/g, "\n\n");
}

function resumeTextQuick(p: Profile): string {
  return [p.headline, p.summary, p.skills, p.certifications, p.achievements, ...p.jobs.map((j) => `${j.role} ${j.org} ${j.points}`), ...p.projects.map((x) => `${x.name} ${x.tech} ${x.points}`), ...p.education.map((e) => `${e.degree} ${e.school}`)].join("\n");
}

// ================================================================ reading an old resume
const HEADINGS: Record<string, RegExp> = {
  summary: /^(professional |career )?(summary|objective|profile|about me|career objective)\b/i,
  experience: /^(work |professional |employment |job )?(experience|history|employment)|^internships?\b|^work history/i,
  education: /^(education(al)?( qualifications?| details| background)?|academic( qualifications?| details| profile)?|qualifications?)\b/i,
  projects: /^(academic |key |personal )?projects?\b/i,
  skills: /^(technical |key |core |it |computer )?(skills|competencies|expertise|proficiency|computer knowledge)\b/i,
  certifications: /^(certifications?|courses?|trainings?|certificates?)\b/i,
  achievements: /^(achievements?|awards?|honou?rs?|accomplishments?|extra[- ]curricular)/i,
  languages: /^languages?( known)?\b/i,
  interests: /^(interests?|hobbies)\b/i,
  personal: /^(personal (details|information|profile)|bio[- ]?data)\b/i,
  declaration: /^declaration\b/i,
};
const RANGE = /((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*[''`]?\d{2,4}|\d{1,2}[/.-]\d{2,4}|\b(19|20)\d{2}\b)\s*(-|–|—|to|till)\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*[''`]?\d{2,4}|\d{1,2}[/.-]\d{2,4}|\b(19|20)\d{2}\b|present|current|now|till date|date)/i;

export function parseResume(text: string): { profile: Profile; found: string[] } {
  const p = blankProfile();
  p.declaration = DECLARATION;
  const all = text.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  const found: string[] = [];
  const email = /[^\s@|,;:()]+@[^\s@|,;:()]+\.[a-z]{2,}/i.exec(text); if (email) { p.email = email[0]; found.push("email"); }
  const phone = /(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/.exec(text); if (phone) { p.phone = phone[0].trim(); found.push("mobile"); }
  const li = /(https?:\/\/)?(www\.)?linkedin\.com\/[^\s|,]+/i.exec(text); if (li) { p.linkedin = li[0]; found.push("LinkedIn"); }
  const web = /(https?:\/\/)?(www\.)?(github\.com|[a-z0-9-]+\.(dev|io|me|in|com))\/?[^\s|,]*/i.exec(text.replace(li?.[0] ?? "\u0000", "").replace(email?.[0] ?? "\u0000", ""));
  if (web && !/gmail|yahoo|outlook|hotmail|rediff/i.test(web[0])) p.website = web[0];
  const nameLine = all.find((l) => l && !/@|\d|resume|curriculum|bio-?data/i.test(l) && l.split(" ").length <= 5 && /^[A-Za-z .'-]+$/.test(l));
  if (nameLine) { p.name = nameLine.replace(/\b([A-Z])([A-Z]+)\b/g, (_m, a: string, b: string) => a + b.toLowerCase()); found.push("name"); }

  // split into sections
  const parts: Record<string, string[]> = { head: [] };
  let cur = "head";
  for (const l of all) {
    if (!l) continue;
    const short = l.replace(/[:\-–_]+$/, "").trim();
    const hit = short.split(/\s+/).length <= 5 ? Object.entries(HEADINGS).find(([, re]) => re.test(short)) : undefined;
    if (hit) { cur = hit[0]; parts[cur] = parts[cur] ?? []; const rest = l.replace(/^[^:]*:\s*/, ""); if (rest !== l && rest) parts[cur].push(rest); continue; }
    (parts[cur] = parts[cur] ?? []).push(l);
  }
  const head = parts.head.filter((l) => l !== nameLine && !l.includes(p.email || "\u0000") && !(p.phone && l.includes(p.phone)));
  const hl = head.find((l) => !/[|@]/.test(l) && l.split(" ").length <= 8 && !/\d{3}/.test(l));
  if (hl) p.headline = hl;
  const city = /\b(Delhi|New Delhi|Mumbai|Bengaluru|Bangalore|Hyderabad|Chennai|Kolkata|Pune|Ahmedabad|Jaipur|Lucknow|Noida|Gurugram|Gurgaon|Prayagraj|Allahabad|Kanpur|Varanasi|Patna|Bhopal|Indore|Nagpur|Chandigarh|Dehradun|Ranchi|Bhubaneswar|Guwahati|Kochi|Coimbatore|Surat|Vadodara|Agra|Meerut|Ghaziabad|Gorakhpur)\b/i.exec(head.join(" "));
  if (city) p.city = city[0];
  const bullet = (l: string) => l.replace(/^[•●▪◦\-*–·]\s*/, "");
  if (parts.summary) { p.summary = parts.summary.join(" "); found.push("summary"); }
  if (parts.skills) { p.skills = parts.skills.map(bullet).join("\n"); found.push("skills"); }
  if (parts.certifications) { p.certifications = parts.certifications.map(bullet).join("\n"); found.push("certifications"); }
  if (parts.achievements) { p.achievements = parts.achievements.map(bullet).join("\n"); found.push("achievements"); }
  if (parts.languages) p.languages = items(parts.languages.join(", ")).join(", ");
  if (parts.interests) p.interests = items(parts.interests.join(", ")).join(", ");
  if (parts.declaration) p.declaration = parts.declaration.filter((l) => !/^(place|date)\b/i.test(l) && !/^\(.*\)$/.test(l)).join(" ") || DECLARATION;
  if (parts.personal) for (const l of parts.personal) {
    const m = /^([^:]+?)\s*[:\-–]\s*(.+)$/.exec(l);
    if (!m) continue;
    const k = m[1].toLowerCase(), val = m[2].trim();
    if (/father/.test(k)) p.father = val; else if (/birth|dob/.test(k)) p.dob = val; else if (/gender|sex/.test(k)) p.gender = val;
    else if (/category|caste/.test(k)) p.category = val; else if (/nationality/.test(k)) p.nationality = val; else if (/marital/.test(k)) p.marital = val;
    else if (/address/.test(k)) p.address = val; else if (/language/.test(k)) p.languages = val;
  }

  // experience: a line with a date range starts a job
  if (parts.experience) {
    let j: Profile["jobs"][number] | null = null;
    for (const l of parts.experience) {
      const r = RANGE.exec(l);
      if (r && !/^[•●▪\-*–]/.test(l)) {
        const rest = l.replace(r[0], "").replace(/[|,(–\-\s]+$/, "").replace(/^[|,\s]+/, "").replace(/\(\s*\)/, "").trim();
        const [role, org] = rest.split(/\s+(?:at|@)\s+|\s*[|,–—]\s*/);
        j = { id: uid(), role: role ?? "", org: org ?? "", place: "", from: r[1], to: r[5].replace(/^./, (c) => c.toUpperCase()), points: "" };
        p.jobs.push(j);
      } else if (j && !j.org && !/^[•●▪\-*–]/.test(l) && l.split(" ").length <= 8 && !j.points) {
        j.org = l;
      } else if (j) j.points += (j.points ? "\n" : "") + bullet(l);
      else { j = { id: uid(), role: l, org: "", place: "", from: "", to: "", points: "" }; p.jobs.push(j); }
    }
    if (p.jobs.length) found.push(`${p.jobs.length} job(s)`);
  }
  if (parts.education) {
    let e: Profile["education"][number] | null = null;
    const strip = (l: string, yr: RegExpExecArray | null, sc: RegExpExecArray | null) =>
      l.replace(yr?.[0] ?? "\u0000", "").replace(sc?.[0] ?? "\u0000", "").replace(/\(\s*\)/g, "").replace(/[|,–\-:\s]+$/, "").trim();
    for (const l of parts.education.map(bullet)) {
      // a marks-table row: Examination | Board / University | Year | Marks
      const cells = l.split(/\s+\|\s+|\t+/).map((c) => c.trim()).filter(Boolean);
      const yi = cells.findIndex((c) => /^(19|20)\d{2}$/.test(c));
      // the marks table's header row ("Examination | Board | Year | Marks")
      if (/\byear\b/i.test(l) && /marks|cgpa|percentage|division|%/i.test(l) && !/\b(19|20)\d{2}\b/.test(l)) continue;
      if (cells.length >= 3 && yi > 0) {
        const si = cells.findIndex((c, i) => i !== yi && /%|cgpa|sgpa|^\d{1,2}(\.\d+)?$/i.test(c));
        e = { id: uid(), degree: cells[0], school: yi > 1 ? cells[1] : "", board: "", year: cells[yi], score: si > 0 ? cells[si] : "" };
        p.education.push(e);
        continue;
      }
      const yr = /\b(19|20)\d{2}\b(?!.*\b(19|20)\d{2}\b)/.exec(l);
      const sc = /(\d{1,2}(\.\d+)?\s*(%|cgpa|sgpa|percent)|cgpa[:\s]*\d+(\.\d+)?)/i.exec(l);
      const degreeish = /\b(b\.?\s?tech|m\.?\s?tech|b\.?e\b|b\.?sc|m\.?sc|b\.?com|m\.?com|b\.?a\b|m\.?a\b|bca|mca|mba|bba|ph\.?d|diploma|class|12th|10th|xii|x\b|intermediate|high school|matric|hsc|ssc|b\.?ed|ll\.?b|graduation|post graduation)/i.test(l);
      if (degreeish || !e) {
        e = { id: uid(), degree: strip(l, yr, sc), school: "", board: "", year: yr?.[0] ?? "", score: sc?.[0] ?? "" };
        p.education.push(e);
      } else {
        if (!e.school) e.school = strip(l, yr, sc);
        if (!e.year && yr) e.year = yr[0];
        if (!e.score && sc) e.score = sc[0];
      }
    }
    if (p.education.length) found.push(`${p.education.length} education item(s)`);
  }
  if (parts.projects) {
    let pr: Profile["projects"][number] | null = null;
    for (const l of parts.projects) {
      const isBullet = /^[•●▪◦\-*–·]/.test(l);
      if (!isBullet && (!pr || l.split(" ").length <= 9) && !/^(tech|tools|technologies)\s*[:\-]/i.test(l)) { pr = { id: uid(), name: l.replace(/[:\-–]+$/, ""), tech: "", link: "", points: "" }; p.projects.push(pr); }
      else if (pr && /^(tech|tools|technologies)\s*[:\-]/i.test(l)) pr.tech = l.replace(/^[^:\-]+[:\-]\s*/, "");
      else if (pr) pr.points += (pr.points ? "\n" : "") + bullet(l);
    }
    if (p.projects.length) found.push(`${p.projects.length} project(s)`);
  }
  return { profile: p, found };
}

/** Plain text of a PDF (text layer) or a Word .docx, read in the browser. */
export async function fileText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise;
    const out: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 8); n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      let line = "", lastY: number | null = null;
      for (const it of tc.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
        const y = it.transform?.[5];
        if (lastY != null && y != null && Math.abs(y - lastY) > 2 && line) { out.push(line); line = ""; }
        line += (line && !line.endsWith(" ") && it.str && !it.str.startsWith(" ") ? " " : "") + it.str;
        lastY = y ?? lastY;
        if (it.hasEOL) { out.push(line); line = ""; lastY = null; }
      }
      if (line) out.push(line);
    }
    return out.map((l) => l.replace(/\s+/g, " ").trim()).join("\n");
  }
  if (/\.docx$/i.test(file.name)) return docxText(buf);
  if (/\.(txt|text)$/i.test(file.name) || file.type.startsWith("text/")) return new TextDecoder().decode(buf);
  throw new Error("Choose a PDF, Word (.docx) or text file.");
}

async function docxText(b: Uint8Array): Promise<string> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("This Word file looks damaged.");
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
    if (name === "word/document.xml") {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      let data = b.subarray(start, start + size);
      if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      const xml = new TextDecoder().decode(data);
      return xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
    }
    p += 46 + nl + xl + cl;
  }
  throw new Error("No text found in this Word file.");
}

// ================================================================ examples by profession
const E = (degree: string, school: string, board: string, year: string, score: string) => ({ id: uid(), degree, school, board, year, score });
const J = (role: string, org: string, place: string, from: string, to: string, points: string) => ({ id: uid(), role, org, place, from, to, points });
const P = (name: string, tech: string, link: string, points: string) => ({ id: uid(), name, tech, link, points });

export interface Sample { id: string; label: string; type: ResumeType; template: TemplateId; make: () => Profile }
const base = (o: Partial<Profile>): Profile => ({ ...blankProfile(), city: "Lucknow", email: "name@example.com", phone: "+91 98765 43210", ...o });

export const SAMPLES: Sample[] = [
  { id: "software", label: "Software developer", type: "experienced", template: "latex", make: () => base({
    name: "Rahul Verma", headline: "Java Backend Developer", city: "Bengaluru", linkedin: "linkedin.com/in/rahulverma", website: "github.com/rahulverma",
    summary: "Backend developer with 4 years of experience building Java Spring Boot microservices and REST APIs for fintech products. Comfortable with PostgreSQL, Kafka, Docker and AWS, and with owning features from design to production.",
    skills: "Languages: Java, SQL, Python\nFrameworks: Spring Boot, Hibernate, JUnit\nTools: PostgreSQL, Kafka, Redis, Docker, Kubernetes, AWS, Git, Jenkins",
    jobs: [
      J("Software Engineer", "PayCrest Technologies", "Bengaluru", "Jul 2022", "Present", "Developed 14 REST APIs for UPI collections handling 2 lakh transactions a day\nReduced report generation time from 40 s to 6 s by adding indexes and caching with Redis\nMentored 3 junior developers and reviewed 300+ pull requests"),
      J("Associate Software Engineer", "Infonet Systems", "Noida", "Aug 2020", "Jun 2022", "Built Spring Boot services for a loan management system used by 120 branches\nWrote JUnit tests raising coverage from 35% to 78%"),
    ],
    projects: [P("Expense Splitter", "Java, Spring Boot, React", "github.com/rahulverma/split", "Open-source app to split bills; 1,200 GitHub stars")],
    education: [E("B.Tech, Computer Science", "Dr. A.P.J. Abdul Kalam Technical University", "", "2020", "CGPA 8.1")],
    certifications: "AWS Certified Developer – Associate (2023)\nOracle Certified Professional, Java SE 11",
    languages: "English, Hindi",
  }) },
  { id: "fresher", label: "Fresher / graduate", type: "fresher", template: "soft", make: () => base({
    name: "Sneha Gupta", headline: "B.Sc. Computer Science Graduate", city: "Prayagraj", linkedin: "linkedin.com/in/snehagupta",
    summary: "B.Sc. Computer Science graduate (CGPA 8.6) with working knowledge of Python, SQL and Excel. Seeking an entry-level data analyst role where I can apply my analysis skills and learn quickly.",
    skills: "Python, SQL, Advanced Excel, Power BI, Pandas, Communication, Teamwork",
    education: [E("B.Sc. Computer Science", "University of Allahabad", "", "2025", "CGPA 8.6"), E("Class XII (PCM)", "St. Joseph's College", "CBSE", "2022", "89.4%"), E("Class X", "St. Joseph's College", "CBSE", "2020", "92%")],
    projects: [
      P("Sales Dashboard for a Local Store", "Excel, Power BI", "", "Cleaned 18 months of billing data (9,000 rows) and built a Power BI dashboard\nFound the 12 slow-moving items that tied up 30% of stock"),
      P("Student Result Analysis", "Python, Pandas", "github.com/snehag/results", "Analysed marks of 600 students to show subject-wise weak areas for teachers"),
    ],
    jobs: [J("Data Analyst Intern", "Shiksha Foundation", "Remote", "May 2024", "Jul 2024", "Prepared weekly attendance reports for 40 schools in Excel\nAutomated a manual report with Python, saving 5 hours a week")],
    certifications: "Google Data Analytics Certificate (Coursera)\nNSDC Python Programming",
    achievements: "College topper in Statistics, 2024\nNSS volunteer, 120 hours",
    languages: "English, Hindi", interests: "Chess, reading",
  }) },
  { id: "campus", label: "Engineering student (campus placement)", type: "fresher", template: "campus", make: () => base({
    name: "Rohit Kumar Singh", headline: "B.Tech Mechanical Engineering", city: "Kanpur, Uttar Pradesh", linkedin: "linkedin.com/in/rohitks", website: "github.com/rohitks",
    summary: "Final-year Mechanical Engineering student with hands-on experience in CAD design and production planning, looking for a graduate engineer trainee role in manufacturing.",
    skills: "Design tools: AutoCAD, SolidWorks, CATIA\nProgramming: Python, MATLAB\nOther: MS Excel, Lean manufacturing basics",
    education: [E("B.Tech, Mechanical Engineering", "Harcourt Butler Technical University, Kanpur", "", "2026", "CGPA 7.9"), E("Class XII (High School)", "Kendriya Vidyalaya IIT Kanpur", "CBSE", "2022", "86.2%"), E("Class X", "Kendriya Vidyalaya IIT Kanpur", "CBSE", "2020", "91%")],
    jobs: [J("Summer Intern – Production Planning", "Lohia Corp Ltd.", "Kanpur", "Jun 2025", "Jul 2025", "Mapped the assembly line for 3 loom models and found 2 bottleneck stations\nPrepared a daily output tracker in Excel used by 4 shift supervisors")],
    projects: [P("Solar-powered Grain Dryer", "SolidWorks, Arduino", "", "Designed and built a dryer that cut drying time by 35% in field trials with 5 farmers"), P("Gearbox Design for a Go-Kart", "CATIA, MATLAB", "", "Led a team of 4; vehicle finished 6th of 40 teams at a national event")],
    certifications: "NPTEL: Product Design and Manufacturing (Elite)\nAutodesk Certified User – AutoCAD",
    achievements: "Secured 96.4 percentile in GATE 2026 (ME)\nCaptain, college football team",
    languages: "Hindi, English", interests: "Football, robotics",
  }) },
  { id: "govt", label: "Government job applicant", type: "govt", template: "biodata", make: () => base({
    name: "Amit Kumar Yadav", headline: "Applicant for the post of Junior Assistant", city: "Gorakhpur",
    summary: "To serve in a responsible government position where I can use my clerical, typing and computer skills honestly and efficiently.",
    father: "Shri Ram Prakash Yadav", dob: "1999-03-12", gender: "Male", category: "OBC", nationality: "Indian", marital: "Unmarried",
    address: "Village Bhatahat, Post Pipraich, District Gorakhpur, Uttar Pradesh – 273152",
    education: [E("High School (Class X)", "U.P. Board, Prayagraj", "", "2014", "78.5%"), E("Intermediate (Class XII)", "U.P. Board, Prayagraj", "", "2016", "74.2%"), E("B.A.", "Deen Dayal Upadhyaya Gorakhpur University", "", "2019", "62%")],
    jobs: [J("Computer Operator (Contract)", "Tehsil Office, Campierganj", "Gorakhpur", "Apr 2021", "Present", "Data entry of land records and income certificates on e-District\nTyping of letters and notices in Hindi and English")],
    skills: "Hindi typing 30 wpm (Krutidev / Mangal), English typing 35 wpm\nMS Office, Internet, e-mail, e-District portal",
    certifications: "CCC (NIELIT), 2019\nO Level (NIELIT), 2020",
    languages: "Hindi, English", place: "Gorakhpur",
  }) },
  { id: "banking", label: "Banking professional", type: "experienced", template: "pill", make: () => base({
    name: "Pooja Singh", headline: "Assistant Manager – Retail Banking", city: "Kanpur",
    summary: "Banking professional with 5 years in retail branch operations, KYC compliance and loan processing. Known for growing CASA deposits and keeping audit observations at zero.",
    skills: "Retail banking, KYC / AML, Loan processing, Credit appraisal, CASA, Cross-selling, Finacle, MS Excel, Customer service",
    jobs: [
      J("Assistant Manager", "Punjab National Bank", "Kanpur", "Mar 2022", "Present", "Grew branch CASA deposits by 18% in FY 2024–25\nSanctioned 140 MSME and housing loans worth Rs. 32 crore\nClosed the branch audit with zero KYC observations two years running"),
      J("Customer Service Associate", "Axis Bank", "Lucknow", "Jun 2020", "Feb 2022", "Handled 60+ customer queries a day and opened 450 savings accounts\nCross-sold insurance and mutual funds, reaching 120% of target"),
    ],
    education: [E("MBA (Finance)", "Lucknow University", "", "2020", "71%"), E("B.Com", "CSJM University, Kanpur", "", "2018", "68%")],
    certifications: "JAIIB (IIBF), 2021\nCertificate in AML & KYC (IIBF)",
    languages: "Hindi, English",
  }) },
  { id: "teacher", label: "Teacher", type: "experienced", template: "timeline", make: () => base({
    name: "Neha Mishra", headline: "TGT – English", city: "Varanasi",
    summary: "CTET-qualified English teacher with 6 years of classroom experience in CBSE schools. Uses activity-based lessons and smart-class tools to raise reading and writing levels.",
    skills: "Lesson planning, Classroom management, CBSE curriculum, Smart class, Assessment, Spoken English, MS PowerPoint",
    jobs: [
      J("TGT English", "Delhi Public School", "Varanasi", "Apr 2021", "Present", "Teach English to 5 sections of Classes VI–VIII (180 students)\nRaised the class average in Class VIII from 64% to 78% in two years\nRun the school debate club; students won 3 inter-school trophies"),
      J("PRT English", "Sunbeam School", "Varanasi", "Jul 2019", "Mar 2021", "Introduced a weekly reading hour that grew library issues by 40%"),
    ],
    education: [E("B.Ed.", "Banaras Hindu University", "", "2019", "78%"), E("M.A. English", "Banaras Hindu University", "", "2017", "65%")],
    certifications: "CTET Paper II (qualified 2019)\nCBSE training: Competency-based assessment (2023)",
    languages: "English, Hindi",
  }) },
  { id: "accountant", label: "Accountant", type: "experienced", template: "monogram", make: () => base({
    name: "Vikas Agarwal", headline: "Accountant (GST, TDS, Tally)", city: "Jaipur",
    summary: "Accountant with 3 years of experience in bookkeeping, GST and TDS returns, bank reconciliation and month-end closing for trading and manufacturing firms.",
    skills: "Tally Prime, GST returns, TDS, Bank reconciliation, Accounts payable, Accounts receivable, Advanced Excel, Payroll",
    jobs: [J("Accountant", "Shree Balaji Traders", "Jaipur", "Jan 2023", "Present", "File monthly GSTR-1 / 3B for 3 GSTINs with no late fees\nReconciled 5 bank accounts every month and cleared a 2-year backlog of 900 entries\nCut debtor days from 62 to 41 by weekly follow-ups"), J("Accounts Assistant", "R.K. Jain & Associates (CA firm)", "Jaipur", "Jun 2021", "Dec 2022", "Maintained books of 25 clients in Tally\nPrepared TDS returns and Form 16 for 4 companies")],
    education: [E("M.Com", "University of Rajasthan", "", "2021", "64%"), E("B.Com", "University of Rajasthan", "", "2019", "66%")],
    certifications: "Tally Prime with GST (Tally Education)", languages: "Hindi, English",
  }) },
  { id: "sales", label: "Sales & marketing", type: "experienced", template: "banner", make: () => base({
    name: "Arjun Mehta", headline: "Sales & Digital Marketing Executive", city: "Ahmedabad", linkedin: "linkedin.com/in/arjunmehta",
    summary: "Sales and marketing executive with 4 years in B2B and B2C sales and lead generation through Google Ads and social media. Consistently above target.",
    skills: "B2B sales, Lead generation, CRM (Zoho), Negotiation, Google Ads, Social media, SEO, Email marketing, Excel",
    jobs: [J("Sales Executive", "Greenleaf Solar Pvt. Ltd.", "Ahmedabad", "Feb 2022", "Present", "Closed Rs. 2.4 crore of rooftop solar orders in FY 2024–25 (134% of target)\nBuilt a Google Ads campaign that brought 600 leads at Rs. 180 per lead"), J("Marketing Executive", "Urban Kitchen", "Ahmedabad", "Jul 2020", "Jan 2022", "Grew Instagram followers from 2,000 to 25,000 in 14 months")],
    education: [E("BBA (Marketing)", "Gujarat University", "", "2020", "70%")],
    certifications: "Google Ads Search Certification\nHubSpot Inbound Marketing", languages: "English, Hindi, Gujarati",
  }) },
  { id: "pm", label: "Project manager", type: "experienced", template: "executive", make: () => base({
    name: "Kavita Rao", headline: "Project Manager – IT Delivery", city: "Hyderabad", linkedin: "linkedin.com/in/kavitarao",
    summary: "PMP-certified project manager with 10 years of experience delivering ERP and e-governance projects for public and private clients, managing teams of up to 35 and budgets up to Rs. 20 crore.",
    skills: "Project management, Agile / Scrum, Stakeholder management, Risk management, Budgeting, Vendor management, JIRA, MS Project",
    jobs: [J("Project Manager", "Tech Mahindra", "Hyderabad", "Apr 2019", "Present", "Delivered a state e-procurement portal for 60 departments, 3 weeks ahead of schedule\nManaged a 35-member team and a Rs. 20 crore budget with less than 3% variance\nIntroduced fortnightly risk reviews that cut change requests by 25%"), J("Business Analyst", "Wipro", "Bengaluru", "Jun 2015", "Mar 2019", "Wrote requirements for an SAP rollout across 14 plants")],
    education: [E("MBA (Operations)", "IIM Indore", "", "2015", ""), E("B.E. Electronics", "Osmania University", "", "2013", "")],
    certifications: "PMP (PMI), 2018\nCertified ScrumMaster (Scrum Alliance)", languages: "English, Telugu, Hindi",
  }) },
];
