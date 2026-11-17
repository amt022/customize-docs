import React, { useEffect, useState } from "react";
import Dialog from "./Dialog";
import { api, formatBytes, type CompressionLevel, type CompressionStats, type ConvertFormat, type ExportOptions } from "../api";
import { t } from "../i18n";

const LEVELS: { id: CompressionLevel; label: string; hint: string }[] = [
  { id: "none", label: "No compression", hint: "The file exactly as stored" },
  { id: "lossless", label: "Lossless", hint: "Pixel-identical pages; streams, fonts and duplicates packed tighter" },
  { id: "balanced", label: "Balanced", hint: "Font hinting removed (text looks the same); photos and scans at 150 dpi" },
  { id: "strong", label: "Smallest", hint: "Images at 100 dpi, stronger JPEG; accessibility tags and metadata removed" },
];
const LABEL: Record<CompressionLevel, string> = { none: "No compression", lossless: "Lossless", balanced: "Balanced", strong: "Smallest" };

/** The cheaper level a level gives no further saving over (within 1 KB or 1%), if any. */
function sameAs(sizes: Record<CompressionLevel, CompressionStats>, level: CompressionLevel): CompressionLevel | null {
  const order: CompressionLevel[] = ["none", "lossless", "balanced", "strong"];
  const i = order.indexOf(level);
  if (i <= 0) return null;
  const prev = order[i - 1];
  const a = sizes[level].size, b = sizes[prev].size;
  if (b - a < Math.max(1024, b * 0.01)) return sameAs(sizes, prev) ?? prev;
  return null;
}

/** Why a level cannot shrink this file further than the one before it. */
const WHY_SAME: Record<CompressionLevel, string> = {
  none: "",
  lossless: "The file is already stored compactly.",
  balanced: "No large photos or scans, and the fonts carry no hinting to remove.",
  strong: "No large images, accessibility tags or metadata left to remove.",
};

type DownloadFormat = "pdf" | ConvertFormat;
const FORMATS: { id: DownloadFormat; label: string; hint: string }[] = [
  { id: "pdf", label: "PDF", hint: "The document itself, with optional compression and password" },
  { id: "jpg", label: "JPG", hint: "A picture of each page (several pages download as a .zip)" },
  { id: "png", label: "PNG", hint: "Lossless picture of each page (several pages download as a .zip)" },
  { id: "docx", label: "Word", hint: "Editable text, one Word page per PDF page" },
  { id: "xlsx", label: "Excel", hint: "Text laid out in rows and columns, one sheet per page; amounts become numbers" },
  { id: "txt", label: "Text", hint: "Plain text only" },
];

export function ExportDialog({ docId, pageCount, isScan, wasEncrypted, isSigned, startTarget, startFormat, onExport, onConvert, onClose }: {
  docId: string; pageCount: number; isScan: boolean; wasEncrypted: boolean; isSigned: boolean; startTarget?: boolean; startFormat?: ConvertFormat;
  onExport: (o: ExportOptions) => void; onConvert: (format: ConvertFormat, pages: string, dpi: number) => void; onClose: () => void;
}) {
  const [format, setFormat] = useState<DownloadFormat>(startFormat ?? "pdf");
  const [allPages, setAllPages] = useState(true);
  const [pages, setPages] = useState("1");
  const [dpi, setDpi] = useState(150);
  if (format !== "pdf") {
    const isImage = format === "jpg" || format === "png";
    const badPages = !allPages && !/^\s*\d+\s*(-\s*\d*\s*)?(,\s*\d+\s*(-\s*\d*\s*)?)*$/.test(pages);
    return (
      <Dialog title={t("Download")} onClose={onClose} footer={<>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn primary" disabled={badPages} onClick={() => onConvert(format, allPages ? "" : pages, dpi)}>
          Download {FORMATS.find((f) => f.id === format)!.label}
        </button>
      </>}>
        <FormatPicker format={format} setFormat={setFormat} />
        {pageCount > 1 && (
          <fieldset className="form-grid">
            <legend>{t("Pages")}</legend>
            <label className="check-row"><input type="radio" checked={allPages} onChange={() => setAllPages(true)} /> All {pageCount} pages</label>
            <label className="check-row"><input type="radio" checked={!allPages} onChange={() => setAllPages(false)} /> Only pages
              <input value={pages} onChange={(e) => setPages(e.target.value)} onFocus={() => setAllPages(false)} placeholder="e.g. 1-3, 5" style={{ width: "8em" }} /></label>
            {badPages && <span className="bad-text small">{t("Write pages like 1-3, 5")}</span>}
          </fieldset>
        )}
        {isImage && (
          <label className="form-grid">Quality
            <select value={dpi} onChange={(e) => setDpi(+e.target.value)}>
              <option value={100}>Small (100 dpi) – screen, email</option>
              <option value={150}>Standard (150 dpi)</option>
              <option value={300}>High (300 dpi) – printing</option>
            </select>
          </label>
        )}
        {!isImage && isScan && <p className="warn-text small">This looks like a scan. Run “Read text (OCR)” first so its text can go into the file; pages without text are {format === "docx" ? "placed as pictures" : "left empty"}.</p>}
      </Dialog>
    );
  }
  return <PdfExportDialog docId={docId} startTarget={startTarget} wasEncrypted={wasEncrypted} isSigned={isSigned} onExport={onExport} onClose={onClose}
    picker={<FormatPicker format={format} setFormat={setFormat} />} />;
}

function FormatPicker({ format, setFormat }: { format: DownloadFormat; setFormat: (f: DownloadFormat) => void }) {
  return (
    <fieldset className="format-options">
      <legend>{t("Format")}</legend>
      <div className="format-row" role="radiogroup">
        {FORMATS.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={format === f.id}
            className={"btn small" + (format === f.id ? " primary" : "")} onClick={() => setFormat(f.id)}>{f.label}</button>
        ))}
      </div>
      <span className="muted small">{FORMATS.find((f) => f.id === format)!.hint}</span>
    </fieldset>
  );
}

const TARGETS = [100, 200, 300, 500, 1024, 2048];
const kbLabel = (kb: number) => (kb >= 1024 && kb % 1024 === 0 ? `${kb / 1024} MB` : `${kb} KB`);

function PdfExportDialog({ docId, wasEncrypted, isSigned, startTarget, onExport, onClose, picker }: {
  docId: string; wasEncrypted: boolean; isSigned: boolean; startTarget?: boolean;
  onExport: (o: ExportOptions) => void; onClose: () => void; picker: React.ReactNode;
}) {
  const [protect, setProtect] = useState(wasEncrypted);
  // a signed, unmodified file must stay byte-identical for its signature to remain valid
  const [compression, setCompression] = useState<CompressionLevel | "target">(startTarget ? "target" : isSigned ? "none" : "lossless");
  const [targetKb, setTargetKb] = useState(() => {
    const saved = Number((() => { try { return localStorage.getItem("formeasy.targetKb"); } catch { return null; } })());
    return saved >= 10 ? saved : 200;
  });
  const badTarget = compression === "target" && !(targetKb >= 10 && targetKb <= 100000);
  const [sizes, setSizes] = useState<Record<CompressionLevel, CompressionStats> | null>(null);
  const [sizeError, setSizeError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.compressionOptions(docId).then((s) => { if (!cancelled) setSizes(s); }, () => { if (!cancelled) setSizeError(true); });
    return () => { cancelled = true; };
  }, [docId]);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [owner, setOwner] = useState("");
  const [allowPrint, setAllowPrint] = useState(true);
  const [allowCopy, setAllowCopy] = useState(true);
  const [allowModify, setAllowModify] = useState(false);
  const mismatch = protect && pw !== pw2;
  const missing = protect && !pw && !owner;
  return (
    <Dialog title={t("Download")} onClose={onClose} footer={<>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>{t("Cancel")}</button>
      <button className="btn primary" disabled={mismatch || missing || badTarget}
        onClick={() => {
          const level: CompressionLevel = compression === "target" ? "none" : compression;
          const target = compression === "target" ? { targetKb } : {};
          if (compression === "target") { try { localStorage.setItem("formeasy.targetKb", String(targetKb)); } catch { /* storage unavailable */ } }
          onExport(protect
            ? { userPassword: pw, ownerPassword: owner, allowPrint, allowCopy, allowModify, allowAnnotate: allowModify, compression: level, ...target }
            : { userPassword: "", ownerPassword: "", allowPrint: true, allowCopy: true, allowModify: true, allowAnnotate: true, compression: level, ...target });
        }}>
        {compression === "target" ? `Download under ${kbLabel(targetKb || 0)}` : "Download PDF"}
      </button>
    </>}>
      {picker}
      <fieldset className="compress-options">
        <legend>{t("Compression")}</legend>
        <label className={"compress-option target-option" + (compression === "target" ? " selected" : "")}>
          <input type="radio" name="compression" checked={compression === "target"} onChange={() => setCompression("target")} />
          <span className="compress-text">
            <strong>{t("Under a size limit")} <span className="new-tag">{t("For upload portals")}</span></strong>
            <span className="muted small">{t("Use the limit from the application form. We keep as much quality as fits.")}</span>
            {compression === "target" && (
              <span className="target-row">
                {TARGETS.map((kb) => (
                  <button type="button" key={kb} className={"size-chip" + (targetKb === kb ? " on" : "")} onClick={() => setTargetKb(kb)}>{kbLabel(kb)}</button>
                ))}
                <span className="target-custom">
                  <input type="number" min={10} max={100000} value={targetKb || ""} aria-label={t("Size limit in KB")}
                    onChange={(e) => setTargetKb(Math.round(Number(e.target.value)))} /> KB
                </span>
              </span>
            )}
            {badTarget && <span className="bad-text small">{t("Enter a limit of at least 10 KB.")}</span>}
          </span>
          <span className="compress-size">{sizes && compression === "target" && sizes.none.size <= targetKb * 1024
            ? <span className="good-text small">{t("Already fits")}</span> : null}</span>
        </label>
        {LEVELS.map((l) => {
          const st = sizes?.[l.id];
          const same = sizes ? sameAs(sizes, l.id) : null;
          return (
            <label key={l.id} className={"compress-option" + (compression === l.id ? " selected" : "")}>
              <input type="radio" name="compression" checked={compression === l.id} onChange={() => setCompression(l.id)} />
              <span className="compress-text">
                <strong>{l.label}</strong>
                <span className="muted small">{l.hint}</span>
                {same && <span className="same-note small">Same size as {LABEL[same]} for this file: {WHY_SAME[l.id]}</span>}
              </span>
              <span className={"compress-size" + (same ? " muted" : "")}>
                {st ? <>{formatBytes(st.size)}{st.savedPercent > 0.5 && !same && <span className="good-text small"> −{Math.round(st.savedPercent)}%</span>}</>
                  : sizeError ? "" : <span className="muted small">…</span>}
              </span>
            </label>
          );
        })}
        {isSigned && compression !== "none" && <span className="warn-text small">{t("Compressing rewrites the file and invalidates its digital signature.")}</span>}
      </fieldset>
      {wasEncrypted && <p className="warn-text small">The uploaded file was password protected. It is stored unlocked here; set a password to protect the copy you download.</p>}
      <label className="check-row"><input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} /> Protect with a password (AES-256)</label>
      {protect && (
        <div className="form-grid">
          <label>{t("Password to open")}<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
          <label>{t("Repeat password")}<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
          {mismatch && <span className="bad-text small">{t("Passwords do not match")}</span>}
          <label>{t("Permissions password")} <span className="muted small">(optional, to change restrictions)</span><input type="password" value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
          <label className="check-row"><input type="checkbox" checked={allowPrint} onChange={(e) => setAllowPrint(e.target.checked)} /> {t("Allow printing")}</label>
          <label className="check-row"><input type="checkbox" checked={allowCopy} onChange={(e) => setAllowCopy(e.target.checked)} /> {t("Allow copying text")}</label>
          <label className="check-row"><input type="checkbox" checked={allowModify} onChange={(e) => setAllowModify(e.target.checked)} /> {t("Allow editing and comments")}</label>
        </div>
      )}
    </Dialog>
  );
}

export function WatermarkDialog({ onApply, onRemove, onClose }: { onApply: (text: string, opacity: number, color: string) => void; onRemove: () => void; onClose: () => void }) {
  const [text, setText] = useState("CONFIDENTIAL");
  const [opacity, setOpacity] = useState(18);
  const [color, setColor] = useState("#888888");
  return (
    <Dialog title={t("Watermark")} onClose={onClose} footer={<>
      <button className="btn danger" onClick={onRemove}>{t("Remove watermark")}</button>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>{t("Cancel")}</button>
      <button className="btn primary" disabled={!text.trim()} onClick={() => onApply(text, opacity / 100, color)}>{t("Add to all pages")}</button>
    </>}>
      <div className="form-grid">
        <label>{t("Text")}<input value={text} onChange={(e) => setText(e.target.value)} autoFocus /></label>
        <label>Opacity {opacity}%<input type="range" min={5} max={60} value={opacity} onChange={(e) => setOpacity(+e.target.value)} /></label>
        <label className="check-row">{t("Colour")} <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      </div>
    </Dialog>
  );
}

export function PromptDialog({ title, label, initial, hint, confirm, onOk, onClose, extra }: {
  title: string; label: string; initial: string; hint?: string; confirm: string;
  onOk: (value: string, flag: boolean) => void; onClose: () => void; extra?: string;
}) {
  const [v, setV] = useState(initial);
  const [flag, setFlag] = useState(false);
  return (
    <Dialog title={title} onClose={onClose} footer={<>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>{t("Cancel")}</button>
      <button className="btn primary" disabled={!v.trim()} onClick={() => onOk(v, flag)}>{confirm}</button>
    </>}>
      <div className="form-grid">
        <label>{label}<input value={v} onChange={(e) => setV(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Enter" && v.trim() && onOk(v, flag)} /></label>
        {hint && <span className="muted small">{hint}</span>}
        {extra && <label className="check-row"><input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} /> {extra}</label>}
      </div>
    </Dialog>
  );
}
