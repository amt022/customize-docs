import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import { api, formatBytes, type CompressionLevel, type CompressionStats, type ExportOptions } from "../api";

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

export function ExportDialog({ docId, wasEncrypted, isSigned, onExport, onClose }: {
  docId: string; wasEncrypted: boolean; isSigned: boolean; onExport: (o: ExportOptions) => void; onClose: () => void;
}) {
  const [protect, setProtect] = useState(wasEncrypted);
  // a signed, unmodified file must stay byte-identical for its signature to remain valid
  const [compression, setCompression] = useState<CompressionLevel>(isSigned ? "none" : "lossless");
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
    <Dialog title="Download PDF" onClose={onClose} footer={<>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={mismatch || missing}
        onClick={() => onExport(protect
          ? { userPassword: pw, ownerPassword: owner, allowPrint, allowCopy, allowModify, allowAnnotate: allowModify, compression }
          : { userPassword: "", ownerPassword: "", allowPrint: true, allowCopy: true, allowModify: true, allowAnnotate: true, compression })}>
        Download
      </button>
    </>}>
      <fieldset className="compress-options">
        <legend>Compression</legend>
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
        {isSigned && compression !== "none" && <span className="warn-text small">Compressing rewrites the file and invalidates its digital signature.</span>}
      </fieldset>
      {wasEncrypted && <p className="warn-text small">The uploaded file was password protected. It is stored unlocked here; set a password to protect the copy you download.</p>}
      <label className="check-row"><input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} /> Protect with a password (AES-256)</label>
      {protect && (
        <div className="form-grid">
          <label>Password to open<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
          <label>Repeat password<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
          {mismatch && <span className="bad-text small">Passwords do not match</span>}
          <label>Permissions password <span className="muted small">(optional, to change restrictions)</span><input type="password" value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
          <label className="check-row"><input type="checkbox" checked={allowPrint} onChange={(e) => setAllowPrint(e.target.checked)} /> Allow printing</label>
          <label className="check-row"><input type="checkbox" checked={allowCopy} onChange={(e) => setAllowCopy(e.target.checked)} /> Allow copying text</label>
          <label className="check-row"><input type="checkbox" checked={allowModify} onChange={(e) => setAllowModify(e.target.checked)} /> Allow editing and comments</label>
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
    <Dialog title="Watermark" onClose={onClose} footer={<>
      <button className="btn danger" onClick={onRemove}>Remove watermark</button>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!text.trim()} onClick={() => onApply(text, opacity / 100, color)}>Add to all pages</button>
    </>}>
      <div className="form-grid">
        <label>Text<input value={text} onChange={(e) => setText(e.target.value)} autoFocus /></label>
        <label>Opacity {opacity}%<input type="range" min={5} max={60} value={opacity} onChange={(e) => setOpacity(+e.target.value)} /></label>
        <label className="check-row">Colour <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
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
      <button className="btn" onClick={onClose}>Cancel</button>
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
