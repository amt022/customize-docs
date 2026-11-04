import { useEffect, useRef, useState } from "react";
import { api, ApiError, type SessionInfo } from "../api";
import type { DocumentInfo } from "../types";
import Account from "./Account";
import Dialog from "./Dialog";
import ImageEditor from "./ImageEditor";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

export default function Home({ onOpen }: { onOpen: (id: string, tool?: "edit" | "images") => void }) {
  type Tab = "home" | "photo" | "pdf";
  const [tab, setTab] = useState<Tab>(() => {
    const t = sessionStorage.getItem("homeTab");
    return t === "photo" || t === "pdf" ? t : "home";
  });
  const go = (id: Tab) => {
    setTab(id);
    try { sessionStorage.setItem("homeTab", id); } catch { /* storage unavailable */ }
  };
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const imagePdf = useRef<HTMLInputElement>(null);
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

  const upload = async (file: File, pw = "", tool: "edit" | "images" = "edit") => {
    setBusy(true);
    setError(null);
    try {
      const doc = await api.upload(file, pw);
      onOpen(doc.id, tool);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setPending(file);
        setError(pw ? "Wrong password" : "This PDF is password protected");
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const makeFromPictures = async (files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      const doc = await api.fromImages(files);
      onOpen(doc.id, "images");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <header className="home-head">
        <button className="brand brand-link" onClick={() => go("home")}><Logo size={34} /> <span className="wordmark">Form<b>Easy</b></span></button>
        <nav className="home-tabs" role="tablist">
          {([["home", "🏠 Home"], ["photo", "🪪 Photo & Signature"], ["pdf", "📄 PDF Studio"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => go(id)}>{label}</button>
          ))}
        </nav>
        {session && <Account session={session} onChange={changeSession} openSignIn={signInHint} onSignInShown={() => setSignInHint(false)} />}
        <ThemeToggle />
      </header>
      {tab === "home" ? (
        <main className="home-main hub">
          <h1>Get every application requirement ready</h1>
          <p className="lede">Photos, signatures and documents for government exams, jobs and admissions: made to the exact size, format and file limits, and checked before you upload.</p>
          <ul className="hub-chips">
            <li>Exact pixels and KB</li><li>JPG · PNG · WebP · PDF</li><li>Runs in your browser</li><li>Free, no sign-up</li>
          </ul>
          <div className="hub-grid">
            <button className="hub-card" onClick={() => go("photo")}>
              <span className="hub-icon">🪪</span>
              <strong>Photo &amp; Signature</strong>
              <span className="muted small">Resize and crop to exact dimensions, set a file size in KB, convert format, remove the background and check against the limits.</span>
              <span className="hub-go">Open <i>→</i></span>
            </button>
            <button className="hub-card" onClick={() => go("pdf")}>
              <span className="hub-icon">📄</span>
              <strong>PDF Studio</strong>
              <span className="muted small">Edit text and pictures in certificates and forms, compress to a size limit, merge, split, and run a document check.</span>
              <span className="hub-go">Open <i>→</i></span>
            </button>
            {[
              ["🔍", "Document Scanner", "Scan certificates with a camera and clean them up."],
              ["🗂", "Document Vault", "Keep certificates, marksheets and IDs in one place."],
              ["📋", "Exam Checklist", "See which photo, signature and documents an exam needs."],
              ["⏰", "Tracker & Reminders", "Track applications and deadlines."],
            ].map(([icon, name, text]) => (
              <div key={name} className="hub-card soon" aria-disabled="true">
                <span className="hub-icon">{icon}</span>
                <strong>{name} <span className="soon-tag">Coming soon</span></strong>
                <span className="muted small">{text}</span>
              </div>
            ))}
          </div>
          <p className="muted small">Every exam sets its own limits. Always copy them from the official notification; the examples in the tools are only examples.</p>
        </main>
      ) : tab === "photo" ? <main className="home-wide"><ImageEditor /></main> : (
      <main className="home-main">
        <h1>Edit PDF text exactly where it is</h1>
        <p className="lede">Change a word, a figure or a name. The original font, size, colour and position are kept, and every edit is checked against the original page.</p>
        <div
          className={"drop" + (drag ? " over" : "")}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) upload(f);
          }}
          onClick={() => input.current?.click()}
        >
          <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <div className="drop-icon">⬆</div>
          <div>{busy ? "Opening…" : "Drop a PDF here or click to choose"}</div>
          <div className="muted small">
            Up to {session?.maxUploadMb ?? 200} MB · {session?.multiUser ? "only you can see your files" : "stays on this computer"}
          </div>
        </div>
        {session?.multiUser && <KeepNote session={session} onSignIn={() => setSignInHint(true)} />}
        {pending && (
          <form className="pw" onSubmit={(e) => { e.preventDefault(); upload(pending, password); }}>
            <input type="password" placeholder="PDF password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            <button className="btn primary" type="submit">Unlock</button>
          </form>
        )}
        {error && <div className="error-banner">{error}</div>}
        <section className="home-images">
          <h2>🖼 Images</h2>
          <p className="muted">Resize, move, rotate or replace the pictures in a PDF, or build a new PDF from your own pictures.</p>
          <div className="home-cards">
            <button className="home-card" disabled={busy} onClick={() => imagePdf.current?.click()}>
              <strong>Edit pictures in a PDF</strong>
              <span className="muted small">Open a PDF straight in the Images tool: drag handles to resize, set exact sizes, insert more pictures.</span>
            </button>
            <button className="home-card" disabled={busy} onClick={() => pictures.current?.click()}>
              <strong>Make a PDF from pictures</strong>
              <span className="muted small">Choose JPG, PNG, GIF or WebP files. Each becomes a page, which you can then resize and rearrange.</span>
            </button>
          </div>
          <input ref={imagePdf} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f, "", "images"); }} />
          <input ref={pictures} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) makeFromPictures(f); }} />
        </section>
        {docs.length > 0 && (
          <section className="recent">
            <h2>Recent documents</h2>
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
        Saved to your account ({session.user.phone}).{" "}
        {days ? `Documents you don't open for ${after(days * 24)} are deleted.` : "Your documents stay until you delete them."}
      </p>
    );
  }
  return (
    <p className="keep-note">
      {hours ? <>Files are deleted automatically {after(hours)} after you last use them. </> : null}
      <button className="link" onClick={onSignIn}>Sign in with your mobile number</button> to keep them and open them on any device.
    </p>
  );
}
