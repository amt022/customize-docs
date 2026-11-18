import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { t, useLang } from "../i18n";
import { LADDER, findPage, jpeg, layout, loadPicture, order, isConvex, process, wholePicture, type PageFormat, type Pt, type ScanFilter } from "../scan";
import { jpegsToDocx, jpegsToPdf, zip } from "../wrap";

type Page = { id: number; src: HTMLCanvasElement; quad: Pt[]; found: boolean; rot: number };
type Done = { key: string; out: HTMLCanvasElement; thumb: string };
type Fmt = "pdf" | "jpg" | "png" | "docx";
type Dnd = { from: number; over: number; active: boolean; x: number; y: number };

const FILTERS: [ScanFilter, string][] = [["color", "Clean colour"], ["grey", "Grey"], ["bw", "Black & white"], ["original", "Original photo"]];
const FORMATS: [Fmt, string][] = [["pdf", "PDF"], ["jpg", "JPG"], ["png", "PNG"], ["docx", "Word"]];
const EXT: Record<Fmt, string> = { pdf: "pdf", jpg: "jpg", png: "png", docx: "docx" };
const LIMITS = [0, 100, 200, 300, 500, 1024, 2048];

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const keyOf = (p: Page, f: ScanFilter) => `${p.quad.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(";")}|${p.rot}|${f}`;
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);
const tick = () => new Promise((r) => setTimeout(r, 0));
let nextId = 1;

export default function Scanner({ onOpen }: { onOpen: (id: string) => void }) {
  useLang();
  const [pages, setPages] = useState<Page[]>([]);
  const [filter, setFilterState] = useState<ScanFilter>(() => {
    const f = read("formeasy.scan.filter", "color");
    return (FILTERS.some(([k]) => k === f) ? f : "color") as ScanFilter;
  });
  const [fmt, setFmtState] = useState<Fmt>(() => {
    const f = read("formeasy.scan.out", "pdf");
    return (FORMATS.some(([k]) => k === f) ? f : "pdf") as Fmt;
  });
  const [format, setFormatState] = useState<PageFormat>(() => {
    const f = read("formeasy.scan.format", "a4");
    return f === "letter" || f === "fit" ? f : "a4";
  });
  const [limit, setLimitState] = useState<number>(() => Math.max(0, +read("formeasy.scan.kb", "0") || 0));
  const [split, setSplitState] = useState<"one" | "each">(() => (read("formeasy.scan.split", "one") === "each" ? "each" : "one"));
  const [custom, setCustom] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ size: number; reached: boolean; pages: number; files: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const [dnd, setDnd] = useState<Dnd | null>(null);
  const [, bump] = useState(0);
  const done = useRef(new Map<number, Done>());
  const dndRef = useRef<Dnd | null>(null);
  dndRef.current = dnd;
  const noClick = useRef(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  const setFilter = (f: ScanFilter) => { setFilterState(f); write("formeasy.scan.filter", f); setResult(null); };
  const setFmt = (f: Fmt) => { setFmtState(f); write("formeasy.scan.out", f); setResult(null); };
  const setFormat = (f: PageFormat) => { setFormatState(f); write("formeasy.scan.format", f); setResult(null); };
  const setSplit = (v: "one" | "each") => { setSplitState(v); write("formeasy.scan.split", v); setResult(null); };
  const setLimit = (n: number) => { setLimitState(n); write("formeasy.scan.kb", String(n)); setResult(null); };

  // process pages one after another, letting the screen update between them
  useEffect(() => {
    let stop = false;
    (async () => {
      for (const p of pages) {
        if (stop) return;
        const key = keyOf(p, filter);
        if (done.current.get(p.id)?.key === key) continue;
        await tick();
        if (stop) return;
        const out = process(p.src, p.quad, p.rot, filter);
        const s = 240 / Math.max(out.width, out.height);
        const tc = document.createElement("canvas");
        tc.width = Math.round(out.width * s); tc.height = Math.round(out.height * s);
        const x = tc.getContext("2d")!;
        x.imageSmoothingQuality = "high";
        x.drawImage(out, 0, 0, tc.width, tc.height);
        done.current.set(p.id, { key, out, thumb: tc.toDataURL("image/jpeg", 0.8) });
        bump((n) => n + 1);
      }
    })();
    return () => { stop = true; };
  }, [pages, filter]);

  const add = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (!pics.length) { setError(t("Choose photos (JPG or PNG) of your documents.")); return; }
    setError(null);
    setResult(null);
    const added: Page[] = [];
    for (let i = 0; i < pics.length; i++) {
      setBusy(t("Finding the page… {i} of {n}", { i: i + 1, n: pics.length }));
      try {
        const src = await loadPicture(pics[i]);
        const q = findPage(src);
        added.push({ id: nextId++, src, quad: q ?? wholePicture(src.width, src.height), found: !!q, rot: 0 });
      } catch {
        setError(t("Could not read “{name}”. Try a JPG or PNG photo.", { name: pics[i].name }));
      }
    }
    setBusy(null);
    if (!added.length) return;
    setPages((p) => [...p, ...added]);
    // one new photo: show the corners so they can be checked, like a scanner app
    if (added.length === 1) setEditing(added[0].id);
  };

  const update = (id: number, ch: Partial<Page>) => { setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...ch } : p))); setResult(null); };
  /** Take the page at `from` out and put it in position `to`. */
  const moveTo = (from: number, to: number) => {
    setPages((ps) => {
      if (from === to || from < 0 || to < 0 || from >= ps.length || to >= ps.length) return ps;
      const n = [...ps];
      const [p] = n.splice(from, 1);
      n.splice(to, 0, p);
      return n;
    });
    setResult(null);
  };
  const remove = (id: number) => { setPages((ps) => ps.filter((p) => p.id !== id)); done.current.delete(id); setResult(null); };

  // drag a page to another place: the grip (any pointer) or the picture itself (mouse) starts it
  const startDrag = (i: number, e: React.PointerEvent, immediate: boolean) => {
    if (e.button) return;
    if (immediate) e.preventDefault();
    setDnd({ from: i, over: i, active: immediate, x: e.clientX, y: e.clientY });
  };
  const dragging = dnd !== null;
  useEffect(() => {
    if (!dragging) return;
    const mv = (e: PointerEvent) => {
      const d = dndRef.current; if (!d) return;
      const active = d.active || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6;
      if (!active) return;
      e.preventDefault();
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-page-i]") as HTMLElement | null;
      const over = el ? +el.dataset.pageI! : d.over;
      if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
      if (active !== d.active || over !== d.over) setDnd({ ...d, active, over });
    };
    const end = () => {
      const d = dndRef.current;
      if (d?.active) {
        noClick.current = true;
        setTimeout(() => { noClick.current = false; }, 50);
        moveTo(d.from, d.over);
      }
      setDnd(null);
    };
    window.addEventListener("pointermove", mv, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragging]);

  const outputs = (): HTMLCanvasElement[] => pages.map((p) => {
    const key = keyOf(p, filter);
    const d = done.current.get(p.id);
    if (d?.key === key) return d.out;
    const out = process(p.src, p.quad, p.rot, filter);
    done.current.set(p.id, { key, out, thumb: d?.thumb ?? "" });
    return out;
  });

  const baseName = () => name.trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-") || `scan-${new Date().toISOString().slice(0, 10)}`;
  const fileName = (ext: string, page?: number) => `${baseName()}${page ? `-page-${page}` : ""}.${ext}`;

  /** Gentlest step of the ladder whose file fits the size limit, else the smallest. */
  const fit = async (make: (side: number, q: number) => Promise<Blob>, label: string): Promise<{ blob: Blob; reached: boolean }> => {
    const steps = limit ? LADDER : [LADDER[1]];
    let last: { blob: Blob; reached: boolean } | null = null;
    for (let s = 0; s < steps.length; s++) {
      setBusy(label + (limit ? t("Making it fit under {kb}… step {i}", { kb: kb(limit * 1024), i: s + 1 }) : t("Making the file…")));
      await tick();
      const blob = await make(steps[s][0], steps[s][1]);
      last = { blob, reached: !limit || blob.size <= limit * 1024 };
      if (last.reached) break;
    }
    return last!;
  };

  const pdfOf = (outs: HTMLCanvasElement[]) => async (side: number, q: number) => {
    const pdfPages = [];
    for (const c of outs) {
      const j = await jpeg(c, side, q);
      const { page, box } = layout(c.width, c.height, format);
      pdfPages.push({ jpeg: j.data, width: j.w, height: j.h, page, box });
    }
    return jpegsToPdf(pdfPages);
  };
  const docxOf = (outs: HTMLCanvasElement[]) => async (side: number, q: number) => {
    const pics = [];
    for (const c of outs) { const j = await jpeg(c, side, q); pics.push({ jpeg: j.data, width: j.w, height: j.h }); }
    let page: [number, number] = format === "letter" ? [612, 792] : [595.28, 841.89];
    if (outs.every((c) => c.width > c.height)) page = [page[1], page[0]];
    return jpegsToDocx(pics, page);
  };
  const jpgOf = (c: HTMLCanvasElement) => async (side: number, q: number) => new Blob([(await jpeg(c, side, q)).data], { type: "image/jpeg" });
  const pngOf = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not make the picture"))), "image/png"));

  /** Every file to download, in page order. */
  const makeFiles = async (): Promise<{ name: string; blob: Blob }[]> => {
    const outs = outputs();
    const files: { name: string; blob: Blob }[] = [];
    let reached = true;
    const ext = EXT[fmt];
    if (fmt === "pdf" || fmt === "docx") {
      const groups = split === "each" && outs.length > 1 ? outs.map((o) => [o]) : [outs];
      for (let g = 0; g < groups.length; g++) {
        const label = groups.length > 1 ? `${g + 1}/${groups.length} · ` : "";
        const r = await fit(fmt === "pdf" ? pdfOf(groups[g]) : docxOf(groups[g]), label);
        reached = reached && r.reached;
        files.push({ name: fileName(ext, groups.length > 1 ? g + 1 : undefined), blob: r.blob });
      }
    } else {
      for (let i = 0; i < outs.length; i++) {
        const label = outs.length > 1 ? `${i + 1}/${outs.length} · ` : "";
        if (fmt === "jpg") {
          const r = await fit(jpgOf(outs[i]), label);
          reached = reached && r.reached;
          files.push({ name: fileName(ext, outs.length > 1 ? i + 1 : undefined), blob: r.blob });
        } else {
          setBusy(label + t("Making the file…"));
          await tick();
          files.push({ name: fileName(ext, outs.length > 1 ? i + 1 : undefined), blob: await pngOf(outs[i]) });
        }
      }
    }
    setResult({ size: Math.max(...files.map((f) => f.blob.size)), reached, pages: outs.length, files: files.length });
    return files;
  };

  const run = async (what: "download" | "studio") => {
    if (!pages.length) return;
    setError(null);
    try {
      if (what === "studio") {
        const outs = outputs();
        const r = await fit(pdfOf(outs), "");
        setResult({ size: r.blob.size, reached: r.reached, pages: outs.length, files: 1 });
        setBusy(t("Opening…"));
        const doc = await api.upload(new File([r.blob], fileName("pdf"), { type: "application/pdf" }));
        onOpen(doc.id);
        return;
      }
      const files = await makeFiles();
      if (files.length === 1) save(files[0].blob, files[0].name);
      else {
        const parts = [];
        for (const f of files) parts.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) });
        save(new Blob([zip(parts)], { type: "application/zip" }), `${baseName()}.zip`);
      }
    } catch (e) {
      setError((e as Error).message || t("Something went wrong. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const page = pages.find((p) => p.id === editing);
  const many = pages.length > 1;
  const docLike = fmt === "pdf" || fmt === "docx";
  const nFiles = docLike ? (many && split === "each" ? pages.length : 1) : pages.length;
  const fmtName = FORMATS.find(([k]) => k === fmt)![1];
  const inputs = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) add(f); }} />
      <input ref={gallery} type="file" accept="image/*" multiple hidden
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) add(f); }} />
    </>
  );

  return (
    <main className="home-wide scanner"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); add(Array.from(e.dataTransfer.files)); }}>
      {inputs}
      <h1>📷 {t("Scan documents")}</h1>
      <p className="lede">{t("Take photos of a marksheet, certificate or form. The page edges are found, the page is straightened and shadows are removed. Save as PDF, JPG, PNG or Word, under a size limit. Your photos stay on this device.")}</p>
      {busy && <div className="toast ok busy-toast" role="status">⏳ {busy}</div>}
      {error && <div className="error-banner" role="alert" onClick={() => setError(null)}>{error}</div>}

      {page ? (
        <CropView key={page.id} page={page}
          onDone={(quad, rot) => { update(page.id, { quad, rot }); setEditing(null); }}
          onNext={(quad, rot) => { update(page.id, { quad, rot }); setEditing(null); camera.current?.click(); }}
          onCancel={() => setEditing(null)} />
      ) : (
        <>
          <div className={"sc-add" + (drag ? " over" : "")}>
            <button className="btn primary sc-big" disabled={!!busy} onClick={() => camera.current?.click()}>📷 {t("Take photo")}</button>
            <button className="btn sc-big" disabled={!!busy} onClick={() => gallery.current?.click()}>🖼 {t("Choose photos")}</button>
            <span className="muted small">{pages.length ? t("{n} pages added. Add more; they go at the end.", { n: pages.length }) : t("Add as many photos as you like: each photo becomes a page. You can also drop photos here.")}</span>
          </div>

          {pages.length > 0 && (
            <div className="sc-body">
              <div>
                {many && <p className="muted small sc-hint">{t("To change the order, drag a page by ⠿ (or the picture, with a mouse) to its new place, or pick its page number.")}</p>}
                <ol className={"sc-pages" + (dnd?.active ? " sorting" : "")}>
                  {pages.map((p, i) => {
                    const d = done.current.get(p.id);
                    const fresh = d?.key === keyOf(p, filter);
                    const cls = "sc-page" + (dnd?.active && dnd.from === i ? " lifted" : "") + (dnd?.active && dnd.over === i && dnd.from !== i ? (dnd.from < i ? " drop-after" : " drop-before") : "");
                    return (
                      <li key={p.id} className={cls} data-page-i={i}>
                        <div className="sc-thumbwrap">
                          <button className="sc-thumb" title={t("Adjust corners")}
                            onPointerDown={(e) => { if (e.pointerType === "mouse" && many) startDrag(i, e, false); }}
                            onClick={() => { if (!noClick.current) setEditing(p.id); }}>
                            {d?.thumb ? <img src={d.thumb} alt={t("Page {n}", { n: i + 1 })} draggable={false} style={{ opacity: fresh ? 1 : 0.5 }} /> : <span className="muted small">…</span>}
                            {!p.found && <span className="sc-flag" title={t("Page edges not found; check the corners")}>!</span>}
                          </button>
                          {many ? (
                            <select className="sc-num" value={i} onChange={(e) => moveTo(i, +e.target.value)} title={t("Move to page")} aria-label={t("Move to page")}>
                              {pages.map((_, j) => <option key={j} value={j}>{j + 1}</option>)}
                            </select>
                          ) : <span className="sc-num">1</span>}
                          {many && <span className="sc-grip" onPointerDown={(e) => startDrag(i, e, true)} title={t("Drag to move")} aria-hidden="true">⠿</span>}
                        </div>
                        <div className="sc-tools">
                          <button className="btn ghost small" onClick={() => setEditing(p.id)} title={t("Adjust corners")} aria-label={t("Adjust corners")}>✎</button>
                          <button className="btn ghost small" onClick={() => update(p.id, { rot: (p.rot + 1) % 4 })} title={t("Rotate")} aria-label={t("Rotate")}>⟳</button>
                          <button className="btn ghost small" disabled={i === 0} onClick={() => moveTo(i, i - 1)} title={t("Move earlier")} aria-label={t("Move earlier")}>◀</button>
                          <button className="btn ghost small" disabled={i === pages.length - 1} onClick={() => moveTo(i, i + 1)} title={t("Move later")} aria-label={t("Move later")}>▶</button>
                          <button className="btn ghost small danger" onClick={() => remove(p.id)} title={t("Remove page")} aria-label={t("Remove page")}>🗑</button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <aside className="sc-side tool-card">
                <div className="tool-form">
                  <span className="sc-label">{t("Look")}</span>
                  <div className="seg" role="radiogroup" aria-label={t("Look")}>
                    {FILTERS.map(([k, l]) => <button key={k} role="radio" aria-checked={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{t(l)}</button>)}
                  </div>
                  <span className="sc-label">{t("Save as")}</span>
                  <div className="seg" role="radiogroup" aria-label={t("Save as")}>
                    {FORMATS.map(([k, l]) => <button key={k} role="radio" aria-checked={fmt === k} className={fmt === k ? "on" : ""} onClick={() => setFmt(k)}>{l}</button>)}
                  </div>
                  {docLike && many && <>
                    <span className="sc-label">{t("Make")}</span>
                    <div className="seg" role="radiogroup" aria-label={t("Make")}>
                      <button role="radio" aria-checked={split === "one"} className={split === "one" ? "on" : ""} onClick={() => setSplit("one")}>{t("One file, all {n} pages", { n: pages.length })}</button>
                      <button role="radio" aria-checked={split === "each"} className={split === "each" ? "on" : ""} onClick={() => setSplit("each")}>{t("A separate file for each photo")}</button>
                    </div>
                  </>}
                  {!docLike && many && <p className="muted small">{t("One picture per page; they download together in a ZIP.")}</p>}
                  {docLike && (
                    <label>{t("Page size")}
                      <select value={format} onChange={(e) => setFormat(e.target.value as PageFormat)}>
                        <option value="a4">A4</option>
                        <option value="letter">Letter</option>
                        {fmt === "pdf" && <option value="fit">{t("Same as the photo")}</option>}
                      </select>
                    </label>
                  )}
                  {fmt === "png" ? <p className="muted small">{t("PNG keeps every detail, so files are bigger and there is no size limit. Choose JPG or PDF for a KB limit.")}</p> : <>
                    <span className="sc-label">{nFiles > 1 ? t("Size limit for each file") : t("Size limit")}</span>
                    <div className="seg" role="radiogroup" aria-label={t("Size limit")}>
                      {LIMITS.map((n) => <button key={n} role="radio" aria-checked={limit === n} className={limit === n ? "on" : ""} onClick={() => setLimit(n)}>{n ? kb(n * 1024) : t("No limit")}</button>)}
                    </div>
                    <form className="sc-custom" onSubmit={(e) => { e.preventDefault(); const n = Math.round(+custom); if (n >= 20 && n <= 100000) setLimit(n); }}>
                      <input inputMode="numeric" placeholder={t("Other, in KB")} value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))} aria-label={t("Other, in KB")} />
                      <button className="btn small" type="submit" disabled={!custom}>{t("Set")}</button>
                    </form>
                  </>}
                  <label>{t("File name (optional)")}<input value={name} placeholder={`scan-${new Date().toISOString().slice(0, 10)}`} onChange={(e) => setName(e.target.value)} /></label>
                </div>
                <div className="sc-actions">
                  <button className="btn primary" disabled={!!busy} onClick={() => run("download")}>
                    ⭳ {nFiles > 1 ? t("Download {n} {fmt} files (ZIP)", { n: nFiles, fmt: fmtName }) : t("Download {fmt}", { fmt: fmtName })}
                  </button>
                  <button className="btn" disabled={!!busy} onClick={() => run("studio")}>📄 {t("Open in PDF Studio")}</button>
                </div>
                {result && (
                  <p className={result.reached ? "tool-ok small" : "tool-bad small"} role="status">
                    {result.reached
                      ? "✓ " + (result.files > 1 ? t("{n} files, the biggest {size}.", { n: result.files, size: kb(result.size) }) : t("Ready: {n} pages, {size}.", { n: result.pages, size: kb(result.size) }))
                      : "✗ " + t("Smallest possible is {size}; that is over the limit. Remove a page or choose Black & white.", { size: kb(result.size) })}
                  </p>
                )}
                <p className="muted small">{t("PDF Studio can then run text recognition, so you can edit or copy the text.")}</p>
              </aside>
            </div>
          )}
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- corner editor

function CropView({ page, onDone, onNext, onCancel }: { page: Page; onDone: (q: Pt[], rot: number) => void; onNext: (q: Pt[], rot: number) => void; onCancel: () => void }) {
  const [quad, setQuad] = useState<Pt[]>(page.quad);
  const [rot, setRot] = useState(page.rot);
  const [dragI, setDragI] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(page.found ? null : t("Page edges not found. Drag the four circles to the corners of the paper."));
  const svg = useRef<SVGSVGElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const W = page.src.width, H = page.src.height;

  useEffect(() => {
    const c = canvas.current!;
    const s = Math.min(1, 1400 / Math.max(W, H));
    c.width = Math.round(W * s); c.height = Math.round(H * s);
    c.getContext("2d")!.drawImage(page.src, 0, 0, c.width, c.height);
  }, [page.src, W, H]);

  const toSrc = (e: React.PointerEvent): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(W, ((e.clientX - r.left) / r.width) * W)), y: Math.max(0, Math.min(H, ((e.clientY - r.top) / r.height) * H)) };
  };
  const scale = () => { const r = svg.current?.getBoundingClientRect(); return r ? W / r.width : 1; };

  const drawLoupe = (p: Pt) => {
    const l = loupe.current; if (!l) return;
    const x = l.getContext("2d")!;
    const z = 3 / scale(), size = l.width / z;
    x.fillStyle = "#000"; x.fillRect(0, 0, l.width, l.height);
    x.drawImage(page.src, p.x - size / 2, p.y - size / 2, size, size, 0, 0, l.width, l.height);
    x.strokeStyle = "#ff3b30"; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(l.width / 2, 0); x.lineTo(l.width / 2, l.height); x.moveTo(0, l.height / 2); x.lineTo(l.width, l.height / 2); x.stroke();
  };

  const down = (e: React.PointerEvent) => {
    const p = toSrc(e), s = scale();
    let best = -1, bd = 44 * s;
    quad.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragI(best);
    drawLoupe(quad[best]);
  };
  const moveP = (e: React.PointerEvent) => {
    if (dragI === null) return;
    const p = toSrc(e);
    setQuad((q) => q.map((c, i) => (i === dragI ? p : c)));
    drawLoupe(p);
  };
  const up = () => setDragI(null);

  const shown = order(quad), ok = isConvex(shown);
  const r = Math.max(W, H) / 70;
  const lc = dragI !== null ? quad[dragI] : null;
  return (
    <section className="sc-crop">
      <div className="sc-crop-bar">
        <button className="btn small" onClick={() => { const q = findPage(page.src); if (q) { setQuad(q); setNote(null); } else setNote(t("Page edges not found. Drag the four circles to the corners of the paper.")); }}>✨ {t("Find edges")}</button>
        <button className="btn small" onClick={() => setQuad(wholePicture(W, H))}>⛶ {t("Whole photo")}</button>
        <button className="btn small" onClick={() => setRot((rot + 1) % 4)}>⟳ {t("Rotate")} {rot ? `(${rot * 90}°)` : ""}</button>
      </div>
      {note && <p className="tool-warn small">{note}</p>}
      <div className="sc-stage">
        <canvas ref={canvas} />
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up}>
          <path d={`M0 0H${W}V${H}H0Z M${shown.map((q) => `${q.x} ${q.y}`).join(" L")}Z`} fill="rgba(0,0,0,.45)" fillRule="evenodd" />
          <polygon points={shown.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={ok ? "#2f80ff" : "#ff3b30"} strokeWidth={r / 3} />
          {quad.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={r} fill="rgba(47,128,255,.25)" stroke="#fff" strokeWidth={r / 4} />)}
        </svg>
        <canvas ref={loupe} width={120} height={120} className={"sc-loupe" + (lc && lc.x < W / 2 ? " right" : "")} style={{ display: lc ? "block" : "none" }} />
      </div>
      {!ok && <p className="tool-bad small">{t("The corners cross over. Put each circle on its own corner.")}</p>}
      <div className="sc-crop-bar end">
        <button className="btn" onClick={onCancel}>{t("Cancel")}</button>
        <button className="btn" disabled={!ok} onClick={() => onNext(order(quad), rot)}>📷 {t("Next page")}</button>
        <button className="btn primary" disabled={!ok} onClick={() => onDone(order(quad), rot)}>✓ {t("Done")}</button>
      </div>
    </section>
  );
}
