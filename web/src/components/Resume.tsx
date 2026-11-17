import { useEffect, useMemo, useRef, useState } from "react";
import { resumeApi } from "../api";
import { t, useLang } from "../i18n";
import {
  ACCENTS, ORDER, TEMPLATES, TYPES, blankProfile, layoutLetter, layoutResume, letterDocx, newVersion, pagesToPdf, paintPage,
  resumeDocx, resumeText, sectionTitle, tplOf, uid, unsupported,
  type Edu, type Job, type Layout, type Profile, type Project, type ResumeType, type SectionId, type TemplateId, type Version,
} from "../resume";
import {
  SAMPLES, bulletTips, checkResume, checkText, draftLetter, draftSummary, fileText, matchJob, parseResume, relevant,
  type LetterInput, type Report,
} from "../resumecheck";

const STORE = "formeasy.resume";
const STORE_CHANGED = "formeasy.resume.changedAt";
const STORE_PHOTO = "formeasy.resume.photo";

interface State { profile: Profile; versions: Version[]; current: string; letter: { input: LetterInput; text: string } }
type Step = "profile" | "design" | "check" | "letter";

const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

function fresh(): State {
  const v = newVersion("My resume");
  return { profile: blankProfile(), versions: [v], current: v.id, letter: { input: { company: "", manager: "", role: "", city: "", tone: "formal", jd: "" }, text: "" } };
}

function load(): State {
  const s = fresh();
  try {
    const v = JSON.parse(read(STORE) ?? "null");
    if (v?.profile) return normalise(v);
  } catch { /* bad data */ }
  return s;
}

function normalise(v: Partial<State>): State {
  const s = fresh();
  const versions = (v.versions?.length ? v.versions : s.versions).map((x) => ({ ...newVersion(x.name || "My resume"), ...x }));
  return {
    profile: { ...s.profile, ...v.profile },
    versions,
    current: versions.some((x) => x.id === v.current) ? v.current! : versions[0].id,
    letter: { input: { ...s.letter.input, ...v.letter?.input }, text: v.letter?.text ?? "" },
  };
}

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fileBase = (s: string) => (s.trim() || "resume").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

/** A picture cropped to the passport ratio 35:45, as a JPEG data URL. */
function photoFrom(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const W = 420, H = 540;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const x = c.getContext("2d")!;
      const s = Math.max(W / img.width, H / img.height);
      x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
      x.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2.6, img.width * s, img.height * s);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL("image/jpeg", 0.86));
    };
    img.onerror = () => rej(new Error("Could not read this picture."));
    img.src = URL.createObjectURL(file);
  });
}

// ================================================================ preview pages
function Pages({ layout, imgs, tick }: { layout: Layout; imgs: Map<string, HTMLImageElement>; tick: number }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    const scale = 1.6;
    layout.pages.forEach((pg, i) => {
      const c = refs.current[i];
      if (!c) return;
      c.width = Math.round(layout.size[0] * scale);
      c.height = Math.round(layout.size[1] * scale);
      paintPage(c.getContext("2d")!, pg, scale, imgs, layout.size);
    });
  }, [layout, imgs, tick]);
  return (
    <div className="rs-pages">
      {layout.pages.map((_, i) => <canvas key={i} ref={(el) => { refs.current[i] = el; }} aria-label={t("Page {n}", { n: i + 1 })} />)}
    </div>
  );
}

function Thumb({ layout, imgs, tick }: { layout: Layout; imgs: Map<string, HTMLImageElement>; tick: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const scale = 0.26;
    c.width = Math.round(layout.size[0] * scale); c.height = Math.round(layout.size[1] * scale);
    paintPage(c.getContext("2d")!, layout.pages[0], scale, imgs, layout.size);
  }, [layout, imgs, tick]);
  return <canvas ref={ref} />;
}

// ================================================================ points editor with wording tips
function Points({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const rows = value.split("\n");
  const tips = rows.map((l, i) => ({ i, l, tips: bulletTips(l.replace(/^\s*[•\-*]\s*/, "")) })).filter((x) => x.tips.length).slice(0, 4);
  return (
    <>
      <label>{t("Points (one per line)")}
        <textarea rows={Math.max(3, rows.length + 1)} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </label>
      {tips.length > 0 && (
        <ul className="rs-tips">
          {tips.map(({ i, l, tips: ts }) => (
            <li key={i}>
              <span className="muted small">{t("Line {n}", { n: i + 1 })}: “{l.slice(0, 42)}{l.length > 42 ? "…" : ""}”</span>
              {ts.map((tip, k) => (
                <div key={k} className="small">
                  {t(tip.text)}
                  {tip.replace?.map((r) => (
                    <button key={r.label} className="rs-chip" onClick={() => { const n = [...rows]; n[i] = r.value; onChange(n.join("\n")); }}>{r.label}</button>
                  ))}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ================================================================ main
export default function Resume() {
  useLang();
  const [st, setSt] = useState<State>(load);
  const [step, setStep] = useState<Step>("profile");
  const [photo, setPhoto] = useState<string | null>(() => read(STORE_PHOTO));
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [sync, setSync] = useState<"saving" | "saved" | "local" | null>(null);
  const [imported, setImported] = useState<{ profile: Profile; found: string[]; name: string } | null>(null);
  const [upload, setUpload] = useState<{ name: string; text: string } | null>(null);
  const [checkSource, setCheckSource] = useState<"mine" | "file">("mine");
  const [renaming, setRenaming] = useState(false);
  const p = st.profile;
  const v = st.versions.find((x) => x.id === st.current) ?? st.versions[0];

  const setP = (patch: Partial<Profile>) => setSt((s) => ({ ...s, profile: { ...s.profile, ...patch } }));
  const setV = (patch: Partial<Version>) => setSt((s) => ({ ...s, versions: s.versions.map((x) => (x.id === s.current ? { ...x, ...patch } : x)) }));
  const setL = (patch: Partial<LetterInput>) => setSt((s) => ({ ...s, letter: { ...s.letter, input: { ...s.letter.input, ...patch } } }));

  // ------------------------------------------------------------ saving (browser + server)
  const first = useRef(true), loaded = useRef(false), latest = useRef(st);
  latest.current = st;
  useEffect(() => { keep(STORE, JSON.stringify(st)); }, [st]);
  useEffect(() => {
    let gone = false;
    resumeApi.get().then((remote) => {
      if (gone) return;
      const localAt = read(STORE_CHANGED) ?? "";
      if (remote && remote.updatedAt > localAt) {
        setSt(normalise(remote.data as Partial<State>));
        keep(STORE_CHANGED, remote.updatedAt);
        first.current = true;
      } else if (localAt) {
        resumeApi.put(latest.current as unknown as Record<string, unknown>).then((r) => keep(STORE_CHANGED, r.updatedAt)).catch(() => setSync("local"));
      }
      loaded.current = true;
      setSync("saved");
    }).catch(() => { loaded.current = true; setSync("local"); });
    return () => { gone = true; };
  }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    keep(STORE_CHANGED, new Date().toISOString());
    if (!loaded.current) return;
    setSync("saving");
    const timer = setTimeout(() => {
      resumeApi.put(st as unknown as Record<string, unknown>)
        .then((r) => { keep(STORE_CHANGED, r.updatedAt); setSync("saved"); })
        .catch(() => setSync("local"));
    }, 1500);
    return () => clearTimeout(timer);
  }, [st]);

  // ------------------------------------------------------------ photo
  const imgs = useMemo(() => {
    const m = new Map<string, HTMLImageElement>();
    if (photo) { const im = new Image(); im.onload = () => setTick((n) => n + 1); im.src = photo; m.set(photo, im); }
    return m;
  }, [photo]);
  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    try {
      const url = await photoFrom(f);
      setPhoto(url); keep(STORE_PHOTO, url);
      setV({ photo: true });
    } catch (e) { setMsg((e as Error).message); }
  };
  useEffect(() => { document.fonts?.ready.then(() => setTick((n) => n + 1)); }, []);

  // ------------------------------------------------------------ layout
  const layout = useMemo(() => layoutResume(p, v, photo), [p, v, photo]);
  const letterLayout = useMemo(() => (step === "letter" && st.letter.text ? layoutLetter(p, st.letter.text, v, st.letter.input.style ?? "simple") : null), [step, p, st.letter.text, v, st.letter.input.style]);
  const [thumbs, setThumbs] = useState<{ id: TemplateId; layout: Layout }[]>([]);
  useEffect(() => {
    if (step !== "design") return;
    const timer = setTimeout(() => setThumbs(TEMPLATES.map((tp) => ({ id: tp.id, layout: layoutResume(p, { ...v, template: tp.id, accent: v.template === tp.id ? v.accent : tp.accent }, photo) }))), 250);
    return () => clearTimeout(timer);
  }, [step, p, v, photo]);
  const report: Report | null = useMemo(() => (step === "check" ? (checkSource === "file" && upload ? checkText(upload.text, v.jd) : checkResume(p, v, layout.pages.length)) : null), [step, checkSource, upload, p, v, layout]);
  const match = useMemo(() => (step === "check" && v.jd.trim() ? matchJob(checkSource === "file" && upload ? upload.text : resumeText(p, v), v.jd) : null), [step, checkSource, upload, p, v]);
  const bad = useMemo(() => unsupported(p), [p]);

  // ------------------------------------------------------------ lists
  type ListKey = "jobs" | "education" | "projects";
  const upd = <K extends ListKey>(k: K, id: string, patch: Partial<Profile[K][number]>) =>
    setP({ [k]: (p[k] as { id: string }[]).map((x) => (x.id === id ? { ...x, ...patch } : x)) } as Partial<Profile>);
  const addTo = (k: ListKey) => {
    const blank = k === "jobs" ? { id: uid(), role: "", org: "", place: "", from: "", to: "", points: "" } as Job
      : k === "education" ? { id: uid(), degree: "", school: "", board: "", year: "", score: "" } as Edu
        : { id: uid(), name: "", tech: "", link: "", points: "" } as Project;
    setP({ [k]: [...p[k], blank] } as Partial<Profile>);
  };
  const remove = (k: ListKey, id: string) => setP({ [k]: (p[k] as { id: string }[]).filter((x) => x.id !== id) } as Partial<Profile>);
  const move = (k: ListKey, id: string, d: -1 | 1) => {
    const a = [...(p[k] as { id: string }[])];
    const i = a.findIndex((x) => x.id === id), j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    setP({ [k]: a } as Partial<Profile>);
  };
  const itemBar = (k: ListKey, id: string, i: number, n: number) => (
    <span className="rs-itembar">
      <button className="btn ghost tiny" disabled={i === 0} onClick={() => move(k, id, -1)} aria-label={t("Move up")}>↑</button>
      <button className="btn ghost tiny" disabled={i === n - 1} onClick={() => move(k, id, 1)} aria-label={t("Move down")}>↓</button>
      <button className="btn ghost tiny" onClick={() => remove(k, id)} aria-label={t("Remove")}>✕</button>
    </span>
  );

  // ------------------------------------------------------------ versions
  const newCopy = () => {
    const n = { ...v, id: uid(), name: `${v.name} (copy)`, hidden: [...v.hidden] };
    setSt((s) => ({ ...s, versions: [...s.versions, n], current: n.id }));
    setRenaming(true);
  };
  const delVersion = () => {
    if (st.versions.length < 2 || !confirm(t("Delete the resume version \"{n}\"? Your profile details stay.", { n: v.name }))) return;
    setSt((s) => { const rest = s.versions.filter((x) => x.id !== s.current); return { ...s, versions: rest, current: rest[0].id }; });
  };
  const toggleHidden = (id: string) => setV({ hidden: v.hidden.includes(id) ? v.hidden.filter((x) => x !== id) : [...v.hidden, id] });
  const setType = (type: ResumeType) => {
    const patch: Partial<Version> = { type };
    if (type === "govt" && v.template !== "biodata") { patch.template = "biodata"; patch.accent = tplOf("biodata").accent; }
    setV(patch);
  };

  // ------------------------------------------------------------ import
  const importFile = async (f: File | undefined, forCheck = false) => {
    if (!f) return;
    setMsg(null);
    try {
      const text = await fileText(f);
      if (forCheck) { setUpload({ name: f.name, text }); setCheckSource("file"); return; }
      if (text.replace(/\s/g, "").length < 40) { setMsg(t("No text could be read from this file. A scanned resume has no text layer: type your details instead.")); return; }
      setImported({ ...parseResume(text), name: f.name });
    } catch (e) { setMsg((e as Error).message || t("Could not read this file.")); }
  };
  const applyImport = (mode: "replace" | "fill") => {
    if (!imported) return;
    const n = imported.profile;
    if (mode === "replace") setP(n);
    else {
      const out = { ...p } as Record<string, unknown>;
      for (const [k, val] of Object.entries(n)) {
        const cur = out[k];
        if (Array.isArray(val)) { if (!(cur as unknown[]).length) out[k] = val; }
        else if (typeof val === "string" && !(cur as string)?.trim()) out[k] = val;
      }
      setP(out as unknown as Profile);
    }
    setImported(null);
    setMsg(t("Details filled in. Check each section: reading a resume file is never perfect."));
  };
  const loadSample = (id: string) => {
    const s = SAMPLES.find((x) => x.id === id);
    if (!s) return;
    const empty = !p.name && !p.jobs.length && !p.education.length;
    if (!empty && !confirm(t("Replace your profile details with the example? Your current details will be lost."))) return;
    setP(s.make());
    setV({ type: s.type, template: s.template, accent: tplOf(s.template).accent, photo: !!tplOf(s.template).likesPhoto && !!photo, hidden: [] });
  };

  // ------------------------------------------------------------ downloads
  const base = fileBase(p.name);
  const dlPdf = () => save(pagesToPdf(layout, `${p.name} resume`, p.name), `${base}-resume.pdf`);
  const dlDocx = () => save(resumeDocx(p, v), `${base}-resume.docx`);
  const dlTxt = () => save(new Blob([resumeText(p, v)], { type: "text/plain;charset=utf-8" }), `${base}-resume.txt`);
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); setMsg(t("Copied.")); } catch { setMsg(t("Could not copy; select the text and copy it yourself.")); } };

  const empty = !p.name && !p.jobs.length && !p.education.length && !p.summary;
  const showLetter = step === "letter" && letterLayout;

  return (
    <main className="home-wide rs">
      <div className="cs-intro">
        <h1>{t("Resume & Career Studio")}</h1>
        <p className="lede">{t("Fill in your details once, then make resumes for different jobs, check them the way recruiting software reads them, match them to a job description and write a cover letter. PDF and Word downloads.")}</p>
      </div>

      <div className="rs-steps" role="tablist">
        {([["profile", "1. Your details"], ["design", "2. Template"], ["check", "3. Check & match"], ["letter", "4. Cover letter"]] as [Step, string][]).map(([id, l]) => (
          <button key={id} role="tab" aria-selected={step === id} className={step === id ? "on" : ""} onClick={() => setStep(id)}>{t(l)}</button>
        ))}
        <span className="spacer" />
        {sync && <span className="muted small rs-sync">{sync === "saving" ? t("Saving…") : sync === "saved" ? "✓ " + t("Saved") : t("Saved on this device only")}</span>}
      </div>
      {msg && <div className="rs-msg" role="status" onClick={() => setMsg(null)}>{msg}</div>}

      <div className="rs-body">
        <aside className="cs-side rs-side">
          {step === "profile" && <>
            <details open={empty} className="rs-start">
              <summary>{t("Quick start")}</summary>
              <label className="cs-file">📄 {t("Fill from my old resume (PDF or Word)")}<input type="file" accept=".pdf,.docx,.txt,application/pdf" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
              {imported && (
                <div className="rs-import">
                  <p className="small">{t("Read from {f}", { f: imported.name })}: <strong>{imported.found.length ? imported.found.join(", ") : t("nothing recognised")}</strong></p>
                  <div className="rs-row">
                    <button className="btn primary small" onClick={() => applyImport("fill")}>{t("Fill empty fields")}</button>
                    <button className="btn small" onClick={() => applyImport("replace")}>{t("Replace everything")}</button>
                    <button className="btn ghost small" onClick={() => setImported(null)}>{t("Cancel")}</button>
                  </div>
                </div>
              )}
              <label>{t("Or load an example by profession")}
                <select value="" onChange={(e) => loadSample(e.target.value)}>
                  <option value="">{t("Choose…")}</option>
                  {SAMPLES.map((s) => <option key={s.id} value={s.id}>{t(s.label)}</option>)}
                </select>
              </label>
              <p className="muted small">{t("Your details are saved in this browser (and your account if signed in) and reused for every resume version and cover letter.")}</p>
            </details>

            <details open>
              <summary>{t("Contact")}</summary>
              <label>{t("Full name")}<input value={p.name} onChange={(e) => setP({ name: e.target.value })} autoComplete="name" /></label>
              <label>{t("Headline / job title")}<input value={p.headline} placeholder={t("e.g. Java Developer, B.Com Graduate")} onChange={(e) => setP({ headline: e.target.value })} /></label>
              <div className="cs-grid">
                <label>{t("Mobile")}<input type="tel" value={p.phone} onChange={(e) => setP({ phone: e.target.value })} autoComplete="tel" /></label>
                <label>{t("Email")}<input type="email" value={p.email} onChange={(e) => setP({ email: e.target.value })} autoComplete="email" /></label>
                <label>{t("City")}<input value={p.city} onChange={(e) => setP({ city: e.target.value })} /></label>
                <label>LinkedIn<input value={p.linkedin} placeholder="linkedin.com/in/…" onChange={(e) => setP({ linkedin: e.target.value })} /></label>
              </div>
              <label>{t("Website / GitHub / portfolio")}<input value={p.website} onChange={(e) => setP({ website: e.target.value })} /></label>
            </details>

            <details open>
              <summary>{t(sectionTitle("summary", v.type))}</summary>
              <textarea rows={4} value={p.summary} placeholder={t("2–3 sentences: who you are, your main skills, what you are looking for.")} onChange={(e) => setP({ summary: e.target.value })} />
              <button className="btn small" onClick={() => { if (!p.summary.trim() || confirm(t("Replace your summary with a draft made from your details?"))) setP({ summary: draftSummary(p, v.type) }); }}>✍ {t("Draft it from my details")}</button>
              <p className="muted small">{t("The draft uses only what you typed below. Read it and change anything that is not exactly true.")}</p>
            </details>

            <details open={v.type !== "fresher"}>
              <summary>{t("Work experience")} ({p.jobs.length})</summary>
              {p.jobs.map((j, i) => (
                <fieldset key={j.id} className="cs-event">
                  <legend>{j.role || t("Job {n}", { n: i + 1 })} {itemBar("jobs", j.id, i, p.jobs.length)}</legend>
                  <div className="cs-grid">
                    <label>{t("Job title")}<input value={j.role} onChange={(e) => upd("jobs", j.id, { role: e.target.value })} /></label>
                    <label>{t("Company / office")}<input value={j.org} onChange={(e) => upd("jobs", j.id, { org: e.target.value })} /></label>
                    <label>{t("From")}<input value={j.from} placeholder="Jun 2022" onChange={(e) => upd("jobs", j.id, { from: e.target.value })} /></label>
                    <label>{t("To")}<input value={j.to} placeholder="Present" onChange={(e) => upd("jobs", j.id, { to: e.target.value })} /></label>
                  </div>
                  <label>{t("Place")}<input value={j.place} onChange={(e) => upd("jobs", j.id, { place: e.target.value })} /></label>
                  <Points value={j.points} onChange={(val) => upd("jobs", j.id, { points: val })} placeholder={t("Developed … that … (result with a number)")} />
                </fieldset>
              ))}
              <button className="btn small" onClick={() => addTo("jobs")}>＋ {t("Add a job or internship")}</button>
            </details>

            <details open>
              <summary>{t("Education")} ({p.education.length})</summary>
              {p.education.map((e, i) => (
                <fieldset key={e.id} className="cs-event">
                  <legend>{e.degree || t("Qualification {n}", { n: i + 1 })} {itemBar("education", e.id, i, p.education.length)}</legend>
                  <label>{t("Degree / class")}<input value={e.degree} placeholder="B.Tech CSE, Class XII…" onChange={(ev) => upd("education", e.id, { degree: ev.target.value })} /></label>
                  <label>{t("College / school / university")}<input value={e.school} onChange={(ev) => upd("education", e.id, { school: ev.target.value })} /></label>
                  <div className="cs-grid">
                    <label>{t("Board (optional)")}<input value={e.board} placeholder="CBSE" onChange={(ev) => upd("education", e.id, { board: ev.target.value })} /></label>
                    <label>{t("Year")}<input value={e.year} onChange={(ev) => upd("education", e.id, { year: ev.target.value })} /></label>
                  </div>
                  <label>{t("Marks / CGPA")}<input value={e.score} placeholder="78% or CGPA 8.2" onChange={(ev) => upd("education", e.id, { score: ev.target.value })} /></label>
                </fieldset>
              ))}
              <button className="btn small" onClick={() => addTo("education")}>＋ {t("Add a qualification")}</button>
            </details>

            <details open={v.type === "fresher"}>
              <summary>{t("Projects")} ({p.projects.length})</summary>
              {p.projects.map((x, i) => (
                <fieldset key={x.id} className="cs-event">
                  <legend>{x.name || t("Project {n}", { n: i + 1 })} {itemBar("projects", x.id, i, p.projects.length)}</legend>
                  <label>{t("Project name")}<input value={x.name} onChange={(e) => upd("projects", x.id, { name: e.target.value })} /></label>
                  <div className="cs-grid">
                    <label>{t("Tools used")}<input value={x.tech} onChange={(e) => upd("projects", x.id, { tech: e.target.value })} /></label>
                    <label>{t("Link")}<input value={x.link} onChange={(e) => upd("projects", x.id, { link: e.target.value })} /></label>
                  </div>
                  <Points value={x.points} onChange={(val) => upd("projects", x.id, { points: val })} placeholder={t("What you built and the result")} />
                </fieldset>
              ))}
              <button className="btn small" onClick={() => addTo("projects")}>＋ {t("Add a project")}</button>
            </details>

            <details open>
              <summary>{t("Skills and more")}</summary>
              <label>{t("Skills (comma list, or one group per line like \"Tools: Excel, Tally\")")}<textarea rows={3} value={p.skills} onChange={(e) => setP({ skills: e.target.value })} /></label>
              <label>{t("Certifications (one per line)")}<textarea rows={2} value={p.certifications} onChange={(e) => setP({ certifications: e.target.value })} /></label>
              <label>{t("Achievements / awards (one per line)")}<textarea rows={2} value={p.achievements} onChange={(e) => setP({ achievements: e.target.value })} /></label>
              <div className="cs-grid">
                <label>{t("Languages")}<input value={p.languages} placeholder="Hindi, English" onChange={(e) => setP({ languages: e.target.value })} /></label>
                <label>{t("Interests")}<input value={p.interests} onChange={(e) => setP({ interests: e.target.value })} /></label>
              </div>
            </details>

            <details open={v.type === "govt"}>
              <summary>{t("Personal details (government jobs)")}</summary>
              <label>{t("Father's name")}<input value={p.father} onChange={(e) => setP({ father: e.target.value })} /></label>
              <div className="cs-grid">
                <label>{t("Date of birth")}<input type="date" value={p.dob} onChange={(e) => setP({ dob: e.target.value })} /></label>
                <label>{t("Gender")}<select value={p.gender} onChange={(e) => setP({ gender: e.target.value })}><option value="" />{["Male", "Female", "Transgender"].map((g) => <option key={g}>{g}</option>)}</select></label>
                <label>{t("Category")}<select value={p.category} onChange={(e) => setP({ category: e.target.value })}><option value="" />{["General", "EWS", "OBC", "SC", "ST"].map((g) => <option key={g}>{g}</option>)}</select></label>
                <label>{t("Marital status")}<select value={p.marital} onChange={(e) => setP({ marital: e.target.value })}><option value="" />{["Unmarried", "Married"].map((g) => <option key={g}>{g}</option>)}</select></label>
                <label>{t("Nationality")}<input value={p.nationality} onChange={(e) => setP({ nationality: e.target.value })} /></label>
                <label>{t("Place (for signature)")}<input value={p.place} onChange={(e) => setP({ place: e.target.value })} /></label>
              </div>
              <label>{t("Permanent address")}<textarea rows={2} value={p.address} onChange={(e) => setP({ address: e.target.value })} /></label>
              <label>{t("Declaration")}<textarea rows={2} value={p.declaration} onChange={(e) => setP({ declaration: e.target.value })} /></label>
              <p className="muted small">{t("Shown only on the Government job resume type.")}</p>
            </details>
          </>}

          {step === "design" && <>
            <details open>
              <summary>{t("Resume type")}</summary>
              <div className="rs-types">
                {TYPES.map(([id, l, note]) => (
                  <button key={id} className={v.type === id ? "on" : ""} aria-pressed={v.type === id} onClick={() => setType(id)}><strong>{t(l)}</strong><span className="muted small">{t(note)}</span></button>
                ))}
              </div>
            </details>
            <details open>
              <summary>{t("Colour")}</summary>
              <div className="rs-swatches">
                {ACCENTS.map((c) => <button key={c} style={{ background: c }} className={v.accent === c ? "on" : ""} aria-label={c} onClick={() => setV({ accent: c })} />)}
                <label className="cs-color" title={t("Any colour")}><input type="color" value={v.accent} onChange={(e) => setV({ accent: e.target.value })} /></label>
              </div>
            </details>
            <details open>
              <summary>{t("Photo")}</summary>
              <label className="check"><input type="checkbox" checked={v.photo} disabled={!photo} onChange={(e) => setV({ photo: e.target.checked })} /> {t("Show my photo")}</label>
              <label className="cs-file">📷 {photo ? t("Change photo") : t("Add a passport photo")}<input type="file" accept="image/*" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} /></label>
              {photo && <button className="btn ghost small" onClick={() => { setPhoto(null); try { localStorage.removeItem(STORE_PHOTO); } catch { /* ignore */ } setV({ photo: false }); }}>{t("Remove photo")}</button>}
              <p className="muted small">{t("Private-sector resumes in India usually leave the photo out; government bio-data often asks for one. The photo stays on this device.")}</p>
            </details>
            <details open>
              <summary>{t("What goes in this version")}</summary>
              {ORDER[v.type].map((id: SectionId) => {
                const list = id === "jobs" ? p.jobs.map((j) => [j.id, j.role || j.org] as const) : id === "projects" ? p.projects.map((x) => [x.id, x.name] as const) : id === "education" ? p.education.map((e) => [e.id, e.degree || e.school] as const) : [];
                return (
                  <div key={id} className="rs-include">
                    <label className="check"><input type="checkbox" checked={!v.hidden.includes(id)} onChange={() => toggleHidden(id)} /> {t(sectionTitle(id, v.type))}</label>
                    {!v.hidden.includes(id) && list.map(([eid, l]) => (
                      <label key={eid} className="check sub"><input type="checkbox" checked={!v.hidden.includes(eid)} onChange={() => toggleHidden(eid)} /> {l || "—"}</label>
                    ))}
                  </div>
                );
              })}
              <p className="muted small">{t("Leave out what does not fit this job; it stays in your profile for other versions.")}</p>
            </details>
          </>}

          {step === "check" && <>
            <details open>
              <summary>{t("What to check")}</summary>
              <div className="seg rs-seg">
                <button className={checkSource === "mine" ? "on" : ""} onClick={() => setCheckSource("mine")}>{t("This resume")}</button>
                <button className={checkSource === "file" ? "on" : ""} onClick={() => setCheckSource("file")}>{t("A resume file")}</button>
              </div>
              {checkSource === "file" && (
                <>
                  <label className="cs-file">📄 {upload ? upload.name : t("Choose a PDF or Word resume")}<input type="file" accept=".pdf,.docx,.txt,application/pdf" onChange={(e) => { importFile(e.target.files?.[0], true); e.target.value = ""; }} /></label>
                  {upload && <button className="btn small" onClick={() => { setImported({ ...parseResume(upload.text), name: upload.name }); setStep("profile"); }}>{t("Fill my profile from this file")}</button>}
                </>
              )}
            </details>
            <details open>
              <summary>{t("Job description (optional)")}</summary>
              <textarea rows={8} value={v.jd} placeholder={t("Paste the job advert or notification text to see which key skills and terms your resume is missing.")} onChange={(e) => setV({ jd: e.target.value })} />
              <p className="muted small">{t("Saved with this resume version.")}</p>
            </details>
          </>}

          {step === "letter" && <>
            <details open>
              <summary>{t("The job")}</summary>
              <div className="cs-grid">
                <label>{t("Company / office")}<input value={st.letter.input.company} onChange={(e) => setL({ company: e.target.value })} /></label>
                <label>{t("Post / role")}<input value={st.letter.input.role} placeholder={p.headline} onChange={(e) => setL({ role: e.target.value })} /></label>
                <label>{t("Addressed to")}<input value={st.letter.input.manager} placeholder={t("Hiring Manager")} onChange={(e) => setL({ manager: e.target.value })} /></label>
                <label>{t("City")}<input value={st.letter.input.city} onChange={(e) => setL({ city: e.target.value })} /></label>
              </div>
              <label>{t("Style")}<select value={st.letter.input.tone} onChange={(e) => setL({ tone: e.target.value as LetterInput["tone"] })}>
                <option value="formal">{t("Formal (4 paragraphs)")}</option>
                <option value="short">{t("Short (for email / portal)")}</option>
                <option value="fresher">{t("Fresher")}</option>
              </select></label>
              <label>{t("Letter design")}<select value={st.letter.input.style ?? "simple"} onChange={(e) => setL({ style: e.target.value as LetterInput["style"] })}>
                <option value="simple">{t("Simple: coloured name and line")}</option>
                <option value="framed">{t("Framed: centred spaced name, page border")}</option>
              </select></label>
              <label>{t("Job description (optional)")}<textarea rows={4} value={st.letter.input.jd || v.jd} onChange={(e) => setL({ jd: e.target.value })} /></label>
              <button className="btn primary block" onClick={() => { if (!st.letter.text.trim() || confirm(t("Replace the letter below with a new draft?"))) setSt((s) => ({ ...s, letter: { ...s.letter, text: draftLetter(p, { ...s.letter.input, jd: s.letter.input.jd || v.jd }) } })); }}>✍ {t("Write the letter")}</button>
              <p className="muted small">{t("Made only from your profile; skills that match the job description are named first. Edit it before sending.")}</p>
            </details>
          </>}
        </aside>

        <section className="rs-stage">
          <div className="cs-toolbar rs-versions">
            <label className="cs-size">{t("Resume version")}
              {renaming
                ? <input autoFocus value={v.name} onChange={(e) => setV({ name: e.target.value })} onBlur={() => setRenaming(false)} onKeyDown={(e) => { if (e.key === "Enter") setRenaming(false); }} />
                : <select value={v.id} onChange={(e) => setSt((s) => ({ ...s, current: e.target.value }))}>{st.versions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
            </label>
            <button className="btn small" onClick={() => setRenaming(!renaming)}>{renaming ? t("Done") : t("Rename")}</button>
            <button className="btn small" onClick={newCopy} title={t("A copy of this version to tailor for another job")}>＋ {t("New version")}</button>
            {st.versions.length > 1 && <button className="btn ghost small" onClick={delVersion}>{t("Delete")}</button>}
          </div>

          {step === "design" && (
            <div className="rs-tpls" role="radiogroup" aria-label={t("Templates")}>
              {TEMPLATES.map((tp) => {
                const th = thumbs.find((x) => x.id === tp.id);
                return (
                  <button key={tp.id} role="radio" aria-checked={v.template === tp.id} className={v.template === tp.id ? "on" : ""} title={t(tp.note)}
                    onClick={() => setV({ template: tp.id, accent: tp.accent, photo: tp.likesPhoto ? !!photo : v.photo })}>
                    {th ? <Thumb layout={th.layout} imgs={imgs} tick={tick} /> : <span className="rs-thumb-wait" />}
                    <span>{t(tp.name)}{tp.ats ? "" : " ²"}</span>
                  </button>
                );
              })}
            </div>
          )}
          {step === "design" && <p className="muted small rs-note">{t(tplOf(v.template).note)} {!tplOf(v.template).ats && t("² = two columns.")}</p>}

          {step === "check" && report && (
            <div className="rs-report">
              <div className="rs-score" style={{ ["--s" as string]: report.score }}>
                <strong>{report.score}</strong><span>/100</span>
              </div>
              <div className="rs-report-body">
                <h2>{checkSource === "file" && upload ? t("Check of {f}", { f: upload.name }) : t("Resume check")}</h2>
                <p className="muted small">{t("A guide to common recruiter and ATS expectations. No score guarantees shortlisting or that every ATS will read a file the same way.")}</p>
                <div className="rs-cats">
                  {report.cats.map((c) => (
                    <div key={c.name} className={c.score >= 80 ? "good" : c.score >= 50 ? "warn" : "bad"}>
                      <span>{t(c.name)}</span><span className="rs-bar"><i style={{ width: `${c.score}%` }} /></span><b>{c.score}%</b>
                    </div>
                  ))}
                </div>
                <ul className="rs-checks">
                  {report.checks.map((c) => (
                    <li key={c.title} className={c.level}>
                      <span className="rs-ic" aria-hidden>{c.level === "good" ? "✓" : c.level === "warn" ? "!" : "✗"}</span>
                      <div><strong>{t(c.title)}</strong> <span>{c.detail}</span>
                        {c.fixes && c.fixes.length > 0 && <ul className="small">{c.fixes.map((f) => <li key={f}>{f}</li>)}</ul>}
                      </div>
                    </li>
                  ))}
                </ul>
                {match && (
                  <div className="rs-match">
                    <h3>{t("Job description match")}: {match.score}%</h3>
                    {match.missing.length > 0 && <><p className="small"><strong>{t("Missing terms")}</strong> — {t("add only the ones you really have, in Skills or in a point where you used them:")}</p>
                      <div className="rs-terms">{match.missing.map((k) => <span key={k} className="miss">{k}</span>)}</div></>}
                    {match.matched.length > 0 && <><p className="small"><strong>{t("Already in your resume")}</strong></p>
                      <div className="rs-terms">{match.matched.map((k) => <span key={k} className="hit">{k}</span>)}</div></>}
                    {checkSource === "mine" && relevant(p, match).length > 0 && <>
                      <p className="small"><strong>{t("Most relevant experience: put it first or expand it")}</strong></p>
                      <ul className="small">{relevant(p, match).slice(0, 5).map((r) => <li key={r}>{r}</li>)}</ul>
                    </>}
                  </div>
                )}
                {!v.jd.trim() && <p className="small muted">{t("Paste a job description on the left to see the match.")}</p>}
              </div>
            </div>
          )}

          {step === "letter" && (
            <div className="rs-letter">
              <textarea rows={16} value={st.letter.text} placeholder={t("Fill in the job on the left and press \"Write the letter\", or type your own.")} onChange={(e) => setSt((s) => ({ ...s, letter: { ...s.letter, text: e.target.value } }))} />
              <div className="cs-toolbar">
                <button className="btn primary" disabled={!st.letter.text.trim() || !letterLayout} onClick={() => letterLayout && save(pagesToPdf(letterLayout, `${p.name} cover letter`, p.name), `${base}-cover-letter.pdf`)}>⬇ PDF</button>
                <button className="btn" disabled={!st.letter.text.trim()} onClick={() => save(letterDocx(p, st.letter.text, v), `${base}-cover-letter.docx`)}>⬇ Word</button>
                <button className="btn" disabled={!st.letter.text.trim()} onClick={() => copy(st.letter.text)}>{t("Copy text")}</button>
              </div>
            </div>
          )}

          {step !== "letter" && (
            <div className="cs-toolbar">
              <button className="btn primary" onClick={dlPdf}>⬇ PDF</button>
              <button className="btn" onClick={dlDocx}>⬇ Word (.docx)</button>
              <button className="btn" onClick={dlTxt}>⬇ {t("Text")}</button>
              <button className="btn ghost" onClick={() => copy(resumeText(p, v))}>{t("Copy as text")}</button>
              <span className="spacer" />
              <span className="muted small">{t("{n} page(s), A4", { n: layout.pages.length })}</span>
            </div>
          )}
          {bad.length > 0 && step !== "letter" && (
            <p className="rs-warn small">{t("The PDF uses standard fonts that cannot show {c}. Those letters print as \"?\". Use the Word download for Hindi text, or write those parts in English.", { c: bad.slice(0, 6).join(" ") })}</p>
          )}

          {showLetter ? <Pages layout={letterLayout!} imgs={imgs} tick={tick} /> : step !== "letter" && <Pages layout={layout} imgs={imgs} tick={tick} />}
        </section>
      </div>
    </main>
  );
}
