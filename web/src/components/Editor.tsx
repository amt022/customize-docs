import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, formatBytes, saveBlob, type AnnotationInfo, type ImageOp, type ImageOpBody } from "../api";
import { glyphsFor, loadPdf } from "../pdf";
import type { Anchor, DocumentInfo, EditResponse, FindHit, Fit, PageModel, Placement, ScanStyle, Selection, Tool } from "../types";
import { ExportDialog, PromptDialog, WatermarkDialog } from "./Dialogs";
import ChatPanel from "./ChatPanel";
import CheckPanel from "./CheckPanel";
import type { CheckIssue } from "../api";
import FindReplace from "./FindReplace";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import ImageLayer from "./ImageLayer";
import ImagePanel from "./ImagePanel";
import InlineEditor from "./InlineEditor";
import PlacementLayer from "./PlacementLayer";
import PropertiesPanel from "./PropertiesPanel";
import SignaturePad from "./SignaturePad";
import Thumbnails, { type PageActions } from "./Thumbnails";
import Viewer from "./Viewer";

type View = "edit" | "original" | "diff";
type Modal = null | "export" | "watermark" | "extract" | "stamp" | "note" | "signature" | "image" | "insert";

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: "note", label: "Note", icon: "🗨" },
  { id: "rect", label: "Rectangle", icon: "▭" },
  { id: "ellipse", label: "Ellipse", icon: "◯" },
  { id: "ink", label: "Draw", icon: "✎" },
  { id: "signature", label: "Signature", icon: "✍" },
  { id: "stamp", label: "Stamp", icon: "▣" },
  { id: "image", label: "Insert image", icon: "🖼" },
];

export default function Editor({ id, startTool = "edit", onClose }: { id: string; startTool?: Tool; onClose: () => void }) {
  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.5);
  const [model, setModel] = useState<PageModel | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>("auto");
  const [fit, setFit] = useState<Fit>("auto");
  const [scanStyle, setScanStyle] = useState<ScanStyle>({ family: "auto", bold: false });
  const [preview, setPreview] = useState<EditResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastResult, setLastResult] = useState<EditResponse | null>(null);
  const [view, setView] = useState<View>("edit");
  const [findOpen, setFindOpen] = useState(false);
  const [findSeed, setFindSeed] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [issue, setIssue] = useState<CheckIssue | null>(null);
  const [hits, setHits] = useState<FindHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [tool, setTool] = useState<Tool>(startTool);
  const [menu, setMenu] = useState<null | "pages" | "annotate">(null);
  const [modal, setModal] = useState<Modal>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [stampText, setStampText] = useState("APPROVED");
  const [pendingNote, setPendingNote] = useState<{ x: number; y: number } | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationInfo[]>([]);
  const [ocrJob, setOcrJob] = useState<{ id: string; progress: number } | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const previewTimer = useRef<number | undefined>(undefined);
  const insertInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageFileFor = useRef<"insert" | "replace">("insert");
  const selectNewImage = useRef(false);
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [lockAspect, setLockAspect] = useState(true);

  const notify = (kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 5000);
  };

  const reload = useCallback(async (d?: DocumentInfo) => {
    const info = d ?? (await api.get(id));
    setDoc(info);
    const p = await loadPdf(api.fileUrl(id, info.current_version));
    setPdf((old) => {
      old?.destroy();
      return p;
    });
    setPage((n) => Math.min(Math.max(n, 1), info.page_count));
    return info;
  }, [id]);

  useEffect(() => {
    reload().catch((e) => notify("err", e.message));
  }, [reload]);

  const loadModel = useCallback(() => {
    if (!doc) return () => undefined;
    let cancelled = false;
    setModel(null);
    api.page(id, page, doc.current_version).then((m) => !cancelled && setModel(m)).catch((e) => notify("err", e.message));
    api.annotations(id, page).then((a) => !cancelled && setAnnotations(a)).catch(() => setAnnotations([]));
    return () => { cancelled = true; };
  }, [id, page, doc?.current_version]);

  useEffect(() => loadModel(), [loadModel]);

  useEffect(() => {
    setSelection(null);
    setEditing(false);
  }, [page, doc?.current_version]);

  useEffect(() => {
    setSelectedImage(null);
  }, [page, tool]);

  // a picture that was just inserted becomes the selected one, ready to be dragged and resized
  useEffect(() => {
    const imgs = model?.images;
    if (selectNewImage.current && imgs?.length) {
      selectNewImage.current = false;
      setSelectedImage(imgs[imgs.length - 1].id);
    }
  }, [model]);

  const selectedIds = model && selection ? glyphsFor(model.lines[selection.line], selection.start, selection.end) : [];
  const selectedText = model && selection ? model.lines[selection.line].text.slice(selection.start, selection.end) : "";
  const isScan = model?.source === "ocr";
  const style = isScan ? { family: scanStyle.family, bold: scanStyle.bold } : undefined;

  /** Runs a version-creating action, then reloads document + page. */
  const act = async (fn: (v: number) => Promise<unknown>, ok?: string) => {
    if (!doc) return;
    setBusy(true);
    try {
      await fn(doc.current_version);
      await reload();
      if (ok) notify("ok", ok);
    } catch (e: any) {
      notify("err", e.message);
    } finally {
      setBusy(false);
    }
  };

  const runPreview = (text: string) => {
    if (!doc || !selection || !selectedIds.length) return;
    window.clearTimeout(previewTimer.current);
    previewAbort.current?.abort();
    setChecking(true);
    previewTimer.current = window.setTimeout(async () => {
      const ctrl = new AbortController();
      previewAbort.current = ctrl;
      try {
        const res = await api.replace(id, {
          page, baseVersion: doc.current_version, dryRun: true,
          edits: [{ glyphs: selectedIds, text, anchor, fit, style }],
        }, ctrl.signal);
        setPreview(res);
        setPreviewError(null);
      } catch (e: any) {
        if (e.name !== "AbortError") {
          setPreview(null);
          setPreviewError(e.message);
        }
      } finally {
        if (previewAbort.current === ctrl) setChecking(false);
      }
    }, isScan ? 450 : 280);
  };

  const apply = async (text: string) => {
    if (!doc || !selectedIds.length) return;
    if (text === selectedText) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const res = await api.replace(id, {
        page, baseVersion: doc.current_version, dryRun: false,
        edits: [{ glyphs: selectedIds, text, anchor, fit, style }],
      });
      setLastResult(res);
      setEditing(false);
      setPreview(null);
      await reload();
      notify(res.verification.layoutPreserved ? "ok" : "err",
        res.verification.layoutPreserved ? (isScan ? "Saved · scan updated" : "Saved · layout verified") : "Saved · check the layout warnings");
    } catch (e: any) {
      notify("err", e.message);
    } finally {
      setBusy(false);
    }
  };

  const undoRedo = async (dir: "undo" | "redo") => {
    if (!doc) return;
    setBusy(true);
    try {
      const info = await (dir === "undo" ? api.undo(id) : api.redo(id));
      setLastResult(null);
      await reload(info);
    } catch (e: any) {
      notify("err", e.message);
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- pages
  const pageActions: PageActions = {
    rotate: (n, deg) => act((v) => api.pageOp(id, { op: "rotate", pages: [n], degrees: deg, baseVersion: v })),
    remove: (n) => {
      if (confirm(`Delete page ${n}? You can undo this.`)) {
        act((v) => api.pageOp(id, { op: "delete", pages: [n], baseVersion: v }), `Page ${n} deleted`);
      }
    },
    move: (from, to) => act(async (v) => {
      await api.pageOp(id, { op: "move", from, to, baseVersion: v });
      setPage(to);
    }),
  };

  const insertPdf = (file: File) => act(async (v) => {
    const info = await api.merge(id, file, page, v);
    setPage(page + 1);
    return info;
  }, `Inserted ${file.name}`);

  // ---------------------------------------------------------- annotations
  const annotate = (body: Record<string, unknown> & { type: string }, ok?: string) =>
    act((v) => api.annotate(id, { page, baseVersion: v, ...body }), ok);

  // ------------------------------------------------------------- pictures
  const imageAct = async (body: ImageOpBody, ok: string) => {
    if (!doc) return;
    setBusy(true);
    try {
      const r = await api.imageOp(id, page, { ...body, baseVersion: doc.current_version } as ImageOp);
      await reload();
      const warning = r.notes?.warnings?.[0];
      notify(warning ? "err" : "ok", warning ? `${ok}, but: ${warning}` : ok);
      return true;
    } catch (e: any) {
      notify("err", e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const readImage = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      if (file.size > 25 * 1024 * 1024) return reject(new Error("Image is larger than 25 MB"));
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Could not read the image"));
      r.readAsDataURL(file);
    });

  const insertCentered = async (file: File) => {
    if (!model) return;
    try {
      const url = await readImage(file);
      const [x0, y0, x1, y1] = model.box;
      const w = (x1 - x0) * 0.5, h = (y1 - y0) * 0.5, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      selectNewImage.current = true;
      if (!(await imageAct({ action: "insert", rect: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], image: url }, "Image inserted"))) selectNewImage.current = false;
    } catch (e: any) {
      notify("err", e.message);
    }
  };

  const replacePicture = async (file: File) => {
    if (selectedImage === null) return;
    try {
      await imageAct({ action: "replace", index: selectedImage, image: await readImage(file) }, "Picture replaced");
    } catch (e: any) {
      notify("err", e.message);
    }
  };

  const onPlace = (p: Placement) => {
    if (tool === "note" && p.x !== undefined && p.y !== undefined) {
      setPendingNote({ x: p.x, y: p.y });
      setModal("note");
    } else if ((tool === "rect" || tool === "ellipse") && p.rect) annotate({ type: tool, rect: p.rect });
    else if (tool === "ink" && p.paths) annotate({ type: "ink", paths: p.paths });
    else if (tool === "image" && p.rect && pendingImage) {
      // a real picture on the page: it can be selected, resized and moved afterwards
      selectNewImage.current = true;
      imageAct({ action: "insert", rect: p.rect, image: pendingImage }, "Image placed").then((ok) => {
        if (!ok) selectNewImage.current = false;
      });
      setTool("images");
    } else if (tool === "signature" && p.rect && pendingImage) {
      annotate({ type: tool, rect: p.rect, image: pendingImage }, "Signature placed");
      setTool("edit");
    } else if (tool === "stamp" && p.rect) annotate({ type: "stamp", rect: p.rect, text: stampText });
  };

  const chooseTool = (t: Tool) => {
    setMenu(null);
    setSelection(null);
    setEditing(false);
    setView("edit");
    if (t === "signature" || t === "image") setModal(t);
    else if (t === "stamp") setModal("stamp");
    else setTool(t);
  };

  // ------------------------------------------------------------------ OCR
  const runOcr = async () => {
    try {
      const job = await api.startOcr(id, [page]);
      setOcrJob({ id: job.id, progress: 0 });
    } catch (e: any) {
      notify("err", e.message);
    }
  };

  useEffect(() => {
    if (!ocrJob) return;
    const t = window.setInterval(async () => {
      try {
        const j = await api.job(ocrJob.id);
        if (j.status === "DONE" || j.status === "FAILED") {
          window.clearInterval(t);
          setOcrJob(null);
          if (j.status === "FAILED") notify("err", j.error ?? "OCR failed");
          else {
            notify("ok", "Text recognised — click any word to edit it");
            loadModel();
          }
        } else setOcrJob({ id: j.id, progress: j.progress });
      } catch {
        window.clearInterval(t);
        setOcrJob(null);
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [ocrJob?.id]);

  // ------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el?.tagName === "INPUT" || el?.tagName === "SELECT" || el?.tagName === "TEXTAREA";
      if (modal) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); undoRedo(e.shiftKey ? "redo" : "undo"); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); undoRedo("redo"); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setFindOpen(true); }
      else if (!typing && (e.key === "Enter" || e.key === "F2") && selection && !editing) { e.preventDefault(); setEditing(true); }
      else if (!typing && tool === "images" && selectedImage !== null && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        imageAct({ action: "delete", index: selectedImage }, "Picture deleted");
      }
      else if (!typing && e.key === "Escape") { setSelection(null); setEditing(false); setTool("edit"); setMenu(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!doc || !pdf) {
    return <div className="loading-screen">Opening document…</div>;
  }

  const pageHits = hits.filter((h) => h.page === page).map((h) => h.glyphs);
  const zoomBy = (f: number) => setZoom((z) => Math.min(4, Math.max(0.5, Math.round(z * f * 100) / 100)));

  return (
    <div className="app" onClick={() => menu && setMenu(null)}>
      <header className="toolbar">
        <button className="brand-btn" onClick={onClose} title="Back to FormEasy"><Logo size={30} /></button>
        <div className="doc-name" title={doc.original_name}>{doc.original_name}</div>
        <div className="tool-group">
          <button className="btn ghost" onClick={() => undoRedo("undo")} disabled={!doc.canUndo || busy} title="Undo (Ctrl+Z)">↶ Undo</button>
          <button className="btn ghost" onClick={() => undoRedo("redo")} disabled={!doc.canRedo || busy} title="Redo (Ctrl+Y)">↷ Redo</button>
        </div>
        <div className="tool-group">
          <button className={"btn ghost" + (tool === "edit" ? " active-tool" : "")} onClick={() => setTool("edit")} title="Select and edit text">𝐓 Edit text</button>
          <button className={"btn ghost" + (tool === "images" ? " active-tool" : "")} title="Move, resize, replace or insert pictures"
            onClick={() => { setMenu(null); setSelection(null); setEditing(false); setView("edit"); setTool(tool === "images" ? "edit" : "images"); }}>🖼 Images</button>
          <div className="menu-wrap" onClick={(e) => e.stopPropagation()}>
            <button className={"btn ghost" + (tool !== "edit" && tool !== "images" ? " active-tool" : "")} onClick={() => setMenu(menu === "annotate" ? null : "annotate")}>
              {tool !== "edit" && tool !== "images" ? `${TOOLS.find((t) => t.id === tool)?.icon} ${TOOLS.find((t) => t.id === tool)?.label}` : "✎ Annotate"} ▾
            </button>
            {menu === "annotate" && (
              <div className="menu">
                {TOOLS.map((t) => <button key={t.id} onClick={() => chooseTool(t.id)}><span className="mi">{t.icon}</span>{t.label}</button>)}
                <hr />
                <button onClick={() => { setMenu(null); setModal("watermark"); }}><span className="mi">⧉</span>Watermark…</button>
              </div>
            )}
          </div>
          <div className="menu-wrap" onClick={(e) => e.stopPropagation()}>
            <button className="btn ghost" onClick={() => setMenu(menu === "pages" ? null : "pages")}>▤ Pages ▾</button>
            {menu === "pages" && (
              <div className="menu">
                <button onClick={() => { setMenu(null); pageActions.rotate(page, 90); }}><span className="mi">↻</span>Rotate this page</button>
                <button onClick={() => { setMenu(null); act((v) => api.pageOp(id, { op: "insert-blank", after: page, baseVersion: v }), "Blank page inserted"); }}><span className="mi">＋</span>Insert blank page after</button>
                <button onClick={() => { setMenu(null); insertInput.current?.click(); }}><span className="mi">⇣</span>Insert PDF after this page…</button>
                <button onClick={() => { setMenu(null); setModal("extract"); }}><span className="mi">⇱</span>Extract / split pages…</button>
                <hr />
                <button disabled={doc.page_count === 1} onClick={() => { setMenu(null); pageActions.remove(page); }}><span className="mi">🗑</span>Delete this page</button>
              </div>
            )}
            <input ref={insertInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) insertPdf(f); }} />
          </div>
          <button className={"btn ghost" + (findOpen ? " active-tool" : "")} onClick={() => { setFindSeed(""); setFindOpen((o) => !o); }} title="Find & replace (Ctrl+F)">⇄ Find &amp; replace</button>
          <button className={"btn ghost" + (checkOpen ? " active-tool" : "")} onClick={() => { setChatOpen(false); setCheckOpen((o) => !o); }} title="Find errors in the PDF and in your edits">✓ Check</button>
          <button className={"btn ghost" + (chatOpen ? " active-tool" : "")} onClick={() => { setCheckOpen(false); setChatOpen((o) => !o); }} title="Ask the assistant to read or change the document">✦ Assistant</button>
        </div>
        <div className="segmented view-switch" role="tablist">
          <button className={view === "edit" ? "on" : ""} onClick={() => setView("edit")}>Edit</button>
          <button className={view === "original" ? "on" : ""} onClick={() => setView("original")} disabled={doc.current_version === 0}>Original</button>
          <button className={view === "diff" ? "on" : ""} onClick={() => setView("diff")} disabled={doc.current_version === 0}>Changes</button>
        </div>
        <span className="spacer" />
        <ThemeToggle />
        <button className="btn primary" onClick={() => setModal("export")}>⭳ Download</button>
      </header>

      {findOpen && (
        <FindReplace
          key={findSeed}
          initialQuery={findSeed}
          docId={id} version={doc.current_version} anchor={anchor} fit={fit}
          onHits={setHits}
          onGoto={(h) => { setPage(h.page); setView("edit"); }}
          onReplaced={async (res) => {
            await reload();
            notify(res.replaced ? "ok" : "err", res.replaced
              ? `Replaced ${res.replaced} of ${res.matches}${res.verification.layoutPreserved ? " · layout verified" : " · check warnings"}`
              : `No replacements made${res.skipped.length ? `: ${res.skipped[0].reason}` : ""}`);
          }}
          onError={(m) => notify("err", m)}
          onClose={() => { setFindOpen(false); setHits([]); }}
        />
      )}

      <div className="workspace">
        <Thumbnails pdf={pdf} page={page} onPage={setPage} actions={pageActions} />
        <main className="canvas-area">
          {view === "edit" && model?.type === "scanned" && !isScan && (
            <div className="scan-banner">
              <strong>Scanned page.</strong>{" "}
              {model.ocrAvailable ? (
                ocrJob ? <>Recognising text… {Math.round(ocrJob.progress * 100)}%</>
                  : <>Recognise the text (English + Hindi) to edit words on this page. <button className="btn small primary" onClick={runOcr}>Recognise text</button></>
              ) : (
                <>Editing scanned text needs the Tesseract OCR engine, which isn't installed. Install it once (e.g. <code>winget install UB-Mannheim.TesseractOCR</code>), then reopen this page.</>
              )}
            </div>
          )}
          {view === "edit" && isScan && (
            <div className="scan-banner info">
              <strong>Scanned page · {model?.ocr?.words} words recognised</strong>
              {model?.ocr?.meanConfidence != null && <> (confidence {model.ocr.meanConfidence}%)</>}. Click a word to edit it, Shift+click to select several words (e.g. a whole phone number); the scan is patched to match.
              <button className="btn small" onClick={() => act((v) => api.textLayer(id, v), "PDF is now searchable")}>Make searchable</button>
            </div>
          )}
          {view === "edit" && (
            <Viewer
              pdf={pdf} pageNum={page} zoom={zoom} model={model} selection={selection} highlights={pageHits}
              marks={checkOpen && issue && issue.page === page ? { boxes: issue.boxes, severity: issue.severity } : null}
              onSelect={(s) => { setSelection(s); setEditing(false); setPreview(null); setPreviewError(null); }}
              onEdit={() => setEditing(true)}
            >
              {(vp) => (
                <>
                  {tool !== "edit" && tool !== "images" && <PlacementLayer key={tool} viewport={vp} tool={tool} onPlace={onPlace} />}
                  {tool === "images" && model && (
                    <ImageLayer
                      viewport={vp} images={model.images ?? []} selected={selectedImage} lockAspect={lockAspect}
                      onSelect={setSelectedImage}
                      onCommit={(imgId, bbox) => imageAct({ action: "transform", index: imgId, bbox }, "Picture resized")}
                    />
                  )}
                  {tool === "edit" && editing && model && selectedIds.length > 0 && (
                    <InlineEditor
                      key={`${selection?.line}:${selection?.start}:${selection?.end}`}
                      viewport={vp} glyphs={model.glyphs} ids={selectedIds}
                      font={model.fonts[model.glyphs[selectedIds[0]].f]}
                      initial={selectedText} preview={preview} previewError={previewError} checking={checking}
                      onChange={runPreview} onApply={apply}
                      onCancel={() => { setEditing(false); setPreview(null); }}
                    />
                  )}
                </>
              )}
            </Viewer>
          )}
          {view === "original" && (
            <figure className="compare-view">
              <img src={api.renderUrl(id, Math.min(page, 9999), 0, zoom)} alt="Original page" />
              <figcaption>Original upload (version 0), page {page}</figcaption>
            </figure>
          )}
          {view === "diff" && (
            <figure className="compare-view">
              <img src={api.compareUrl(id, page, 0, doc.current_version)} alt="Changes" style={{ width: (model ? (model.box[2] - model.box[0]) : 612) * zoom }} />
              <figcaption><span className="legend removed" /> removed <span className="legend added" /> added · original vs current version {doc.current_version}</figcaption>
            </figure>
          )}
        </main>
        {chatOpen ? (
          <ChatPanel docId={id} onClose={() => setChatOpen(false)} onChanged={async () => { setLastResult(null); await reload(); }} />
        ) : tool === "images" ? (
          <ImagePanel
            images={model?.images ?? []} selected={selectedImage} pageBox={model?.box ?? [0, 0, 612, 792]}
            lockAspect={lockAspect} busy={busy} onLock={setLockAspect} onSelect={setSelectedImage}
            onBox={(bbox) => selectedImage !== null && imageAct({ action: "transform", index: selectedImage, bbox }, "Picture resized")}
            onRotate={(deg) => selectedImage !== null && imageAct({ action: "transform", index: selectedImage, rotate: deg }, "Picture rotated")}
            onDelete={() => selectedImage !== null && imageAct({ action: "delete", index: selectedImage }, "Picture deleted")}
            onReplace={() => { imageFileFor.current = "replace"; imageInput.current?.click(); }}
            onInsert={() => { imageFileFor.current = "insert"; imageInput.current?.click(); }}
            onClose={() => setTool("edit")}
          />
        ) : checkOpen ? (
          <CheckPanel
            docId={id} version={doc.current_version} onClose={() => setCheckOpen(false)}
            onShow={(i) => { setIssue(i); if (i?.page) { setPage(i.page); setView("edit"); } }}
          />
        ) : (
        <PropertiesPanel
          doc={doc} model={model} selection={selection} anchor={anchor} fit={fit} lastResult={lastResult}
          onAnchor={setAnchor} onFit={setFit}
          onEdit={() => setEditing(true)}
          onSelectLine={() => model && selection && setSelection({ ...selection, start: 0, end: model.lines[selection.line].text.length })}
          onDelete={() => apply("")}
          annotations={annotations}
          onMarkup={(kind) => selectedIds.length && annotate({ type: kind, glyphs: selectedIds })}
          onDeleteAnnotation={(nm) => act((v) => api.deleteAnnotation(id, page, nm, v), "Annotation deleted")}
          scanStyle={scanStyle} onScanStyle={setScanStyle}
          onReplaceAll={() => { setFindSeed(selectedText.trim()); setFindOpen(true); }}
        />
        )}
      </div>

      <footer className="statusbar">
        <div className="pager">
          <button className="btn ghost small" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>‹</button>
          <span>Page {page} of {pdf.numPages}</span>
          <button className="btn ghost small" onClick={() => setPage((p) => Math.min(pdf.numPages, p + 1))} disabled={page >= pdf.numPages}>›</button>
        </div>
        <div className="zoom">
          <button className="btn ghost small" onClick={() => zoomBy(1 / 1.2)}>−</button>
          <span>{Math.round((zoom / 1.5) * 100)}%</span>
          <button className="btn ghost small" onClick={() => zoomBy(1.2)}>+</button>
        </div>
        <span className="status-item">{model ? `${isScan ? "scanned (OCR)" : model.type} page · ${model.glyphs.length} ${isScan ? "words" : "characters"}` : "Reading page…"}</span>
        {doc.is_signed ? <span className="status-item warn-text">Signed PDF: edits invalidate the signature</span> : null}
        <span className="spacer" />
        <span className="status-item">{busy ? "Saving…" : `Version ${doc.current_version}${doc.current_version ? "" : " (original)"}`}</span>
      </footer>

      {modal === "export" && (
        <ExportDialog docId={id} pageCount={doc.page_count} isScan={model?.type === "scanned" && !isScan} onConvert={async (format, pages, dpi) => {
          setModal(null);
          try {
            const { blob, name, noText } = await api.convert(id, format, pages, dpi);
            saveBlob(blob, name);
            if (noText.length) notify("err", `Page${noText.length > 1 ? "s" : ""} ${noText.join(", ")} had no readable text${format === "docx" ? " and went in as pictures" : ""}. Run Read text (OCR) first to get their text.`);
          } catch (e: any) {
            notify("err", e.message);
          }
        }} wasEncrypted={!!doc.was_encrypted} isSigned={!!doc.is_signed} onClose={() => setModal(null)} onExport={async (o) => {
          setModal(null);
          try {
            const { blob, name, originalSize, size } = await api.exportPdf(id, o);
            saveBlob(blob, name);
            if (o.compression !== "none" && originalSize) {
              notify("ok", size < originalSize
                ? `Downloaded ${formatBytes(size)} (was ${formatBytes(originalSize)}, ${Math.round(100 - (100 * size) / originalSize)}% smaller)`
                : `Downloaded ${formatBytes(size)}; this file was already as small as it can get`);
            }
          } catch (e: any) {
            notify("err", e.message);
          }
        }} />
      )}
      {modal === "watermark" && (
        <WatermarkDialog onClose={() => setModal(null)}
          onApply={(text, opacity, color) => { setModal(null); act((v) => api.watermark(id, { text, opacity, color, baseVersion: v }), "Watermark added"); }}
          onRemove={() => { setModal(null); act((v) => api.watermark(id, { remove: true, baseVersion: v }), "Watermark removed"); }} />
      )}
      {modal === "extract" && (
        <PromptDialog title="Extract pages" label="Pages" initial={`${page}`} confirm="Create"
          hint={`For example 1-3, 5 (document has ${doc.page_count} pages). A new document is created; this one is unchanged.`}
          extra="One document per page (split)"
          onClose={() => setModal(null)}
          onOk={async (spec, each) => {
            setModal(null);
            try {
              const docs = await api.extract(id, spec, each);
              notify("ok", `Created ${docs.length} document${docs.length > 1 ? "s" : ""} — find them on the start page`);
            } catch (e: any) {
              notify("err", e.message);
            }
          }} />
      )}
      {modal === "stamp" && (
        <PromptDialog title="Stamp" label="Stamp text" initial={stampText} confirm="Place stamp"
          hint="Then drag on the page where the stamp should go." onClose={() => setModal(null)}
          onOk={(t) => { setStampText(t); setModal(null); setTool("stamp"); }} />
      )}
      {modal === "note" && pendingNote && (
        <PromptDialog title="Add note" label="Comment" initial="" confirm="Add note" onClose={() => { setModal(null); setPendingNote(null); }}
          onOk={(t) => { setModal(null); annotate({ type: "note", x: pendingNote.x, y: pendingNote.y, text: t }); setPendingNote(null); }} />
      )}
      {(modal === "signature" || modal === "image") && (
        <SignaturePad mode={modal} onClose={() => setModal(null)}
          onDone={(url) => { setPendingImage(url); setTool(modal); setModal(null); }} />
      )}
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) (imageFileFor.current === "replace" ? replacePicture : insertCentered)(f);
      }} />
      {toast && <div className={"toast " + toast.kind}>{toast.text}</div>}
    </div>
  );
}
