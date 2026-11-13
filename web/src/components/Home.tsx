import { useEffect, useRef, useState } from "react";
import { api, ApiError, type SessionInfo } from "../api";
import { getLang, setLang, t, useLang } from "../i18n";
import type { DocumentInfo } from "../types";
import Account from "./Account";
import Checklist, { CHECKLIST_GROUPS } from "./Checklist";
import Dialog from "./Dialog";
import type { StartAction } from "./Editor";
import { SiteFooter } from "./Legal";
import ImageEditor from "./ImageEditor";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

type Tab = "home" | "photo" | "pdf" | "checklist";
/** Which hub quick tool a PDF picker was opened for. */
type Quick = "edit" | "images" | "compress" | "split" | "tojpg" | "merge";

const POPULAR: [label: string, group: string][] = [
  ["SSC CGL / CHSL", "SSC (CGL, CHSL, MTS, GD)"],
  ["UPSC CSE", "UPSC (CSE, NDA, CDS)"],
  ["IBPS PO / Clerk", "IBPS / SBI / RBI (bank exams)"],
  ["SBI PO", "IBPS / SBI / RBI (bank exams)"],
  ["NEET UG", "NTA (NEET, JEE Main, CUET)"],
  ["JEE Main", "NTA (NEET, JEE Main, CUET)"],
  ["CUET UG", "NTA (NEET, JEE Main, CUET)"],
  ["RRB NTPC", "Railways (RRB NTPC, Group D)"],
  ["PAN card", "PAN card (NSDL / UTIITSL)"],
];

export default function Home({ onOpen }: { onOpen: (id: string, tool?: "edit" | "images", action?: StartAction) => void }) {
  useLang();
  const [tab, setTab] = useState<Tab>(() => {
    const t = sessionStorage.getItem("homeTab");
    return t === "photo" || t === "pdf" || t === "checklist" ? t : "home";
  });
  const go = (id: Tab) => {
    setTab(id);
    setError(null);
    try { sessionStorage.setItem("homeTab", id); } catch { /* storage unavailable */ }
    window.scrollTo({ top: 0 });
  };
  const [group, setGroup] = useState<string>(() => {
    const g = (() => { try { return localStorage.getItem("formeasy.exam"); } catch { return null; } })();
    return g && CHECKLIST_GROUPS.includes(g) ? g : CHECKLIST_GROUPS[0];
  });
  const chooseGroup = (g: string) => {
    setGroup(g);
    try { localStorage.setItem("formeasy.exam", g); } catch { /* storage unavailable */ }
  };
  const [photoPreset, setPhotoPreset] = useState<{ name: string; n: number } | null>(null);
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ file: File; quick: Quick } | null>(null);
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const quickPdf = useRef<HTMLInputElement>(null);
  const quickFor = useRef<Quick>("edit");
  const mergeInput = useRef<HTMLInputElement>(null);
  const pictures = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [signInHint, setSignInHint] = useState(false);
  const [trash, setTrash] = useState<(DocumentInfo & { deleted_at: string })[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [undo, setUndo] = useState<DocumentInfo | null>(null);
  const [erase, setErase] = useState<DocumentInfo | null>(null);
  const undoTimer = useRef(0);

  const refresh = () => {
    api.list().then(setDocs).catch(() => setDocs([]));
    api.trash().then(setTrash).catch(() => setTrash([]));
  };
  const remove = async (d: DocumentInfo) => {
    try {
      await api.remove(d.id);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    refresh();
    setUndo(d);
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  };
  const restore = async (id: string) => {
    setUndo(null);
    try {
      await api.restore(id);
    } catch (e) {
      setError((e as Error).message);
    }
    refresh();
  };
  useEffect(() => {
    refresh();
    api.session().then(setSession).catch(() => setSession(null));
  }, []);
  const changeSession = (s: SessionInfo) => {
    setSession(s);
    refresh();
  };

  const openFor = (id: string, quick: Quick) =>
    quick === "images" ? onOpen(id, "images") : onOpen(id, "edit", quick === "edit" || quick === "merge" ? undefined : quick);

  const upload = async (file: File, pw = "", quick: Quick = "edit") => {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      // a photo dropped on a PDF tool: send it where it belongs instead of a server error
      if (file.type.startsWith("image/")) return makeFromPictures([file]);
      setError(t("Only PDF files work here. For photos use “JPG to PDF”; save Word files as PDF first."));
      return;
    }
    setBusy(t("Opening…"));
    setError(null);
    try {
      const doc = await api.upload(file, pw);
      setPending(null);
      openFor(doc.id, quick);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setPending({ file, quick });
        setError(pw ? t("Wrong password") : t("This PDF is password protected"));
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(null);
    }
  };

  const merge = async (files: File[]) => {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (pdfs.length !== files.length || !pdfs.length) { setError(t("Only PDF files work here. For photos use “JPG to PDF”; save Word files as PDF first.")); return; }
    if (pdfs.length === 1) return upload(pdfs[0]);
    setBusy(t("Merging {n} files…", { n: pdfs.length }));
    setError(null);
    try {
      let doc = await api.upload(pdfs[0]);
      for (const f of pdfs.slice(1)) doc = await api.merge(doc.id, f, doc.page_count, doc.current_version);
      onOpen(doc.id);
    } catch (e) {
      setError((e as Error).message);
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const makeFromPictures = async (files: File[]) => {
    setBusy(t("Opening…"));
    setError(null);
    try {
      const doc = await api.fromImages(files);
      onOpen(doc.id, "images");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pickPdf = (quick: Quick) => {
    quickFor.current = quick;
    if (quick === "merge") mergeInput.current?.click();
    else quickPdf.current?.click();
  };

  const QUICK: [icon: string, name: string, hint: string, run: () => void][] = [
    ["🗜", "Compress PDF", "Under 100 KB, 200 KB, 500 KB…", () => pickPdf("compress")],
    ["🖼", "JPG to PDF", "Photos or scans into one PDF", () => pictures.current?.click()],
    ["➕", "Merge PDFs", "Join several files into one", () => pickPdf("merge")],
    ["✂", "Split PDF", "Take out the pages you need", () => pickPdf("split")],
    ["📸", "PDF to JPG", "Each page as a picture", () => pickPdf("tojpg")],
    ["✏️", "Edit PDF text", "Fix a name, date or figure", () => pickPdf("edit")],
    ["🪪", "Resize photo", "Exact pixels, cm and KB", () => go("photo")],
  ];

  const hidden = (
    <>
      <input ref={quickPdf} type="file" accept="application/pdf,.pdf" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f, "", quickFor.current); }} />
      <input ref={mergeInput} type="file" accept="application/pdf,.pdf" multiple hidden
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) merge(f); }} />
      <input ref={pictures} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) makeFromPictures(f); }} />
    </>
  );

  const feedback = (
    <>
      {busy && <div className="toast ok busy-toast" role="status">⏳ {busy}</div>}
      {pending && (
        <form className="pw" onSubmit={(e) => { e.preventDefault(); upload(pending.file, password, pending.quick); }}>
          <input type="password" placeholder={t("PDF password")} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <button className="btn primary" type="submit">{t("Unlock")}</button>
        </form>
      )}
      {error && <div className="error-banner" role="alert" onClick={() => setError(null)}>{t(error)}</div>}
    </>
  );

  const hi = getLang() === "hi";
  return (
    <div className="home">
      <header className="home-head">
        <button className="brand brand-link" onClick={() => go("home")}><Logo size={34} /> <span className="wordmark">Form<b>Easy</b></span></button>
        <nav className="home-tabs" role="tablist">
          {([["home", "🏠 Home"], ["photo", "🪪 Photo & Signature"], ["pdf", "📄 PDF Studio"], ["checklist", "📋 Checklist"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => go(id)}>{t(label)}</button>
          ))}
        </nav>
        {session && <Account session={session} onChange={changeSession} openSignIn={signInHint} onSignInShown={() => setSignInHint(false)} />}
        <button className="lang-toggle" onClick={() => setLang(hi ? "en" : "hi")} title={hi ? "Switch to English" : "हिंदी में देखें"} aria-label={hi ? "Switch to English" : "हिंदी में देखें"}>
          {hi ? "EN" : "हिं"}
        </button>
        <ThemeToggle />
      </header>
      {hidden}
      {tab === "home" ? (
        <main className="home-main hub">
          <h1>{t("Get every application requirement ready")}</h1>
          <p className="lede">{t("Photos, signatures and documents for government exams, jobs and admissions: made to the exact size, format and file limits, and checked before you upload.")}</p>
          <ul className="hub-chips">
            {["Exact pixels and KB", "JPG · PNG · WebP · PDF", "Runs in your browser", "Free, no sign-up"].map((c) => <li key={c}>{t(c)}</li>)}
          </ul>
          {feedback}
          <div className="hub-grid">
            <button className="hub-card" onClick={() => go("photo")}>
              <span className="hub-icon">🪪</span>
              <strong>{t("Photo & Signature")}</strong>
              <span className="muted small">{t("Resize and crop to exact dimensions, set a file size in KB, convert format, remove the background and check against the limits.")}</span>
              <span className="hub-go">{t("Open")} <i>→</i></span>
            </button>
            <button className="hub-card" onClick={() => go("pdf")}>
              <span className="hub-icon">📄</span>
              <strong>{t("PDF Studio")}</strong>
              <span className="muted small">{t("Edit text and pictures in certificates and forms, compress to a size limit, merge, split, and run a document check.")}</span>
              <span className="hub-go">{t("Open")} <i>→</i></span>
            </button>
            <button className="hub-card live" onClick={() => go("checklist")}>
              <span className="hub-icon">📋</span>
              <strong>{t("Exam Checklist")}</strong>
              <span className="muted small">{t("Pick your exam and tick off the photo, signature and documents it asks for.")}</span>
              <span className="hub-go">{t("Open")} <i>→</i></span>
            </button>
          </div>

          <section className="hub-section">
            <h2>{t("Quick PDF tools")}</h2>
            <p className="muted">{t("One click: choose your file and get the result.")}</p>
            <div className="quick-grid">
              {QUICK.map(([icon, name, hint, run]) => (
                <button key={name} className="quick-tool" disabled={!!busy} onClick={run}>
                  <span className="qt-icon">{icon}</span>
                  <span><strong>{t(name)}</strong><span className="muted">{t(hint)}</span></span>
                </button>
              ))}
            </div>
          </section>

          <section className="hub-section">
            <h2>{t("Popular exams")}</h2>
            <div className="exam-pills">
              {POPULAR.map(([label, g]) => (
                <button key={label} className="exam-pill" onClick={() => { chooseGroup(g); go("checklist"); }}>{label}</button>
              ))}
            </div>
          </section>

          <section className="hub-section">
            <h2>{t("How it works")}</h2>
            <ol className="steps">
              <li><strong>{t("Choose your exam")}</strong><span className="muted">{t("We load its photo, signature and file-size rules.")}</span></li>
              <li><strong>{t("Upload your photo or PDF")}</strong><span className="muted">{t("From your phone camera, gallery or computer.")}</span></li>
              <li><strong>{t("Download, ready to upload")}</strong><span className="muted">{t("Right size, right KB, checked against the rules.")}</span></li>
            </ol>
          </section>

          <p className="muted small hub-disclaimer">{t("Every exam sets its own limits. Always copy them from the official notification; the examples in the tools are only examples.")}</p>
        </main>
      ) : tab === "checklist" ? (
        <>
          <Checklist group={group} onGroup={chooseGroup}
            onPhoto={(name) => { setPhotoPreset({ name, n: Date.now() }); go("photo"); }}
            onCompress={() => pickPdf("compress")} onScan={() => pictures.current?.click()} />
          <div className="home-main" style={{ marginTop: 0 }}>{feedback}</div>
        </>
      ) : tab === "photo" ? <main className="home-wide"><ImageEditor key={photoPreset?.n} preset={photoPreset?.name} /></main> : (
      <main className="home-main">
        <h1>{t("Edit PDF text exactly where it is")}</h1>
        <p className="lede">{t("Change a word, a figure or a name. The original font, size, colour and position are kept, and every edit is checked against the original page.")}</p>
        <div
          className={"drop" + (drag ? " over" : "")}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 1) merge(files);
            else if (files[0]) upload(files[0]);
          }}
          onClick={() => input.current?.click()}
        >
          <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
          <div className="drop-icon">⬆</div>
          <div>{busy ?? t("Drop a PDF here or click to choose")}</div>
          <div className="muted small">
            {t("Up to {mb} MB", { mb: session?.maxUploadMb ?? 200 })} · {session?.multiUser ? t("only you can see your files") : t("stays on this computer")}
          </div>
        </div>
        {session?.multiUser && <KeepNote session={session} onSignIn={() => setSignInHint(true)} />}
        {feedback}
        <section className="home-images">
          <h2>🛠 {t("Quick PDF tools")}</h2>
          <div className="quick-grid">
            {QUICK.filter(([, name]) => name !== "Edit PDF text" && name !== "Resize photo").map(([icon, name, hint, run]) => (
              <button key={name} className="quick-tool" disabled={!!busy} onClick={run}>
                <span className="qt-icon">{icon}</span>
                <span><strong>{t(name)}</strong><span className="muted">{t(hint)}</span></span>
              </button>
            ))}
            <button className="quick-tool" disabled={!!busy} onClick={() => pickPdf("images")}>
              <span className="qt-icon">🖼</span>
              <span><strong>{hi ? "PDF में फ़ोटो बदलें" : "Edit pictures in a PDF"}</strong><span className="muted">{hi ? "साइज़ बदलें, हटाएँ, नई फ़ोटो जोड़ें" : "Resize, move, replace or insert"}</span></span>
            </button>
          </div>
        </section>
        {docs.length > 0 && (
          <section className="recent">
            <h2>{t("Recent documents")}</h2>
            <ul>
              {docs.map((d) => (
                <li key={d.id}>
                  <button className="recent-item" onClick={() => onOpen(d.id)}>
                    <span className="file-badge">PDF</span>
                    <span className="recent-name">{d.original_name}</span>
                    <span className="muted small">{d.page_count} page{d.page_count > 1 ? "s" : ""} · v{d.current_version}</span>
                  </button>
                  <button className="btn ghost small" title="Move to Recently deleted" onClick={() => remove(d)}>✕</button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {trash.length > 0 && (
          <section className="recent trash">
            <button className="link" onClick={() => setShowTrash(!showTrash)} aria-expanded={showTrash}>
              {showTrash ? "▾" : "▸"} Recently deleted ({trash.length})
            </button>
            {showTrash && (
              <>
                <p className="muted small">
                  {session?.trashDays ? `Deleted documents are erased for good after ${session.trashDays} days.` : "Deleted documents stay here until you erase them."}
                </p>
                <ul>
                  {trash.map((d) => (
                    <li key={d.id}>
                      <div className="recent-item">
                        <span className="file-badge">PDF</span>
                        <span className="recent-name">{d.original_name}</span>
                        <span className="muted small">deleted {new Date(d.deleted_at).toLocaleDateString()}</span>
                      </div>
                      <button className="btn small" onClick={() => restore(d.id)}>Restore</button>
                      <button className="btn ghost small danger" title="Delete forever" onClick={() => setErase(d)}>Delete forever</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
        {undo && (
          <div className="toast ok undo-toast" role="status">
            “{undo.original_name}” moved to Recently deleted
            <button className="btn small" onClick={() => restore(undo.id)}>Undo</button>
          </div>
        )}
        {erase && (
          <Dialog
            title="Delete forever"
            onClose={() => setErase(null)}
            footer={<>
              <button className="btn" onClick={() => setErase(null)}>Cancel</button>
              <button className="btn danger" onClick={async () => {
                const d = erase;
                setErase(null);
                try { await api.erase(d.id); } catch (e) { setError((e as Error).message); }
                refresh();
              }}>Delete forever</button>
            </>}
          >
            <p>“{erase.original_name}” and all its versions will be erased. This cannot be undone.</p>
          </Dialog>
        )}
      </main>
      )}
      <SiteFooter session={session} />
    </div>
  );
}

/** How long uploaded files are kept, and the nudge to sign in to keep them longer. */
function KeepNote({ session, onSignIn }: { session: SessionInfo; onSignIn: () => void }) {
  const hours = session.retentionHours;
  const days = session.accountRetentionDays;
  const after = (h: number) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hours`);
  if (session.user) {
    return (
      <p className="keep-note">
        Saved to your account ({session.user.login}).{" "}
        {days ? `Documents you don't open for ${after(days * 24)} are deleted.` : "Your documents stay until you delete them."}
      </p>
    );
  }
  return (
    <p className="keep-note">
      {hours ? <>Files are deleted automatically {after(hours)} after you last use them. </> : null}
      <button className="link" onClick={onSignIn}>Sign in</button> to keep them and open them on any device.
      {" "}By uploading you agree to the <a href="#terms">Terms of Use</a> and <a href="#privacy">Privacy Policy</a>.
    </p>
  );
}
