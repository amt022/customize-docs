import type { AnnotationInfo } from "../api";
import type { Anchor, DocumentInfo, EditResponse, Fit, PageModel, ScanStyle, Selection } from "../types";
import { glyphsFor, unionBox } from "../pdf";
import CheckSummary from "./CheckSummary";

interface Props {
  doc: DocumentInfo;
  model: PageModel | null;
  selection: Selection | null;
  anchor: Anchor;
  fit: Fit;
  lastResult: EditResponse | null;
  onAnchor: (a: Anchor) => void;
  onFit: (f: Fit) => void;
  onEdit: () => void;
  onSelectLine: () => void;
  onDelete: () => void;
  onReplaceAll: () => void;
  annotations: AnnotationInfo[];
  onMarkup: (kind: "highlight" | "underline" | "strikeout") => void;
  onDeleteAnnotation: (id: string) => void;
  scanStyle: ScanStyle;
  onScanStyle: (s: ScanStyle) => void;
}

const FIT_HELP: Record<Fit, string> = {
  auto: "Mid-sentence edits close or open the gap in the rest of the line; table cells and placed text never move.",
  none: "Nothing else moves. Longer text may overlap its neighbours (you get a warning).",
  squeeze: "Longer text is compressed horizontally to fit the free space.",
  reflow: "The rest of the line shifts to make room (only when it flows from the same text run).",
};

const ANNOT_LABEL: Record<string, string> = {
  Highlight: "Highlight", Underline: "Underline", StrikeOut: "Strikeout", Squiggly: "Squiggly", Text: "Note",
  Square: "Rectangle", Circle: "Ellipse", Ink: "Drawing", Stamp: "Stamp", FreeText: "Text box",
};

export default function PropertiesPanel({ doc, model, selection, anchor, fit, lastResult, onAnchor, onFit, onEdit, onSelectLine, onDelete, onReplaceAll,
  annotations, onMarkup, onDeleteAnnotation, scanStyle, onScanStyle }: Props) {
  const scanned = model?.source === "ocr";
  const line = model && selection ? model.lines[selection.line] : null;
  const ids = line && selection ? glyphsFor(line, selection.start, selection.end) : [];
  const g = ids.length && model ? model.glyphs[ids[0]] : null;
  const font = g && model ? model.fonts[g.f] : null;
  const box = ids.length && model ? unionBox(model.glyphs, ids) : null;

  return (
    <aside className="props">
      <section>
        <h3>Selection</h3>
        {!selection || !g || !line ? (
          <p className="muted">Click a word to select it. Shift-click to extend along the line, double-click to edit.</p>
        ) : (
          <>
            <div className="sel-text">{line.text.slice(selection.start, selection.end)}</div>
            <dl className="kv">
              <dt>Font</dt><dd title={font?.baseFont}>{font?.name ?? "?"}</dd>
              <dt>Size</dt><dd>{g.s} pt</dd>
              <dt>Style</dt><dd>{[font?.bold && "Bold", font?.italic && "Italic"].filter(Boolean).join(", ") || "Regular"}</dd>
              <dt>Colour</dt><dd><span className="swatch" style={{ background: g.col }} />{g.col}</dd>
              <dt>Embedding</dt><dd>{font?.embedded ? (font.subset ? "Embedded subset" : "Fully embedded") : "Not embedded"}</dd>
              <dt>Type</dt><dd>{font?.type}</dd>
              {box && (<><dt>Position</dt><dd>x {box[0].toFixed(1)}, y {box[1].toFixed(1)}</dd>
                <dt>Box</dt><dd>{(box[2] - box[0]).toFixed(1)} × {(box[3] - box[1]).toFixed(1)} pt</dd></>)}
              {g.a !== 0 && (<><dt>Angle</dt><dd>{g.a}°</dd></>)}
            </dl>
            {font && !font.editable && <p className="warn-text">This font cannot be re-encoded (Type3 or vertical text).</p>}
            {g.x && <p className="warn-text">This text is inside a reusable form object; edits apply wherever it appears.</p>}
            {scanned && g.conf !== undefined && <p className="muted small">OCR confidence {g.conf}%</p>}
            <div className="row gap wrap">
              <button className="btn primary" onClick={onEdit} disabled={!!font && !font.editable}>Edit text</button>
              <button className="btn" onClick={onSelectLine}>Whole line</button>
              <button className="btn danger" onClick={onDelete} disabled={!!font && !font.editable}>Delete</button>
            </div>
            <button className="btn" onClick={onReplaceAll} title="Replace this text everywhere in the document">⇄ Replace all occurrences…</button>
            <div className="row gap wrap">
              <button className="btn small" onClick={() => onMarkup("highlight")}><span className="mk hl">ab</span> Highlight</button>
              <button className="btn small" onClick={() => onMarkup("underline")}><span className="mk ul">ab</span> Underline</button>
              <button className="btn small" onClick={() => onMarkup("strikeout")}><span className="mk so">ab</span> Strike</button>
            </div>
          </>
        )}
      </section>

      {scanned && (
        <section>
          <h3>Scanned text style</h3>
          <p className="help">New words are drawn into the scan. Auto match picks the closest typeface from your scan; size, tilt, ink colour and baseline are matched too.</p>
          <div className="segmented">
            {(["auto", "sans", "serif", "mono"] as const).map((f) => (
              <button key={f} className={scanStyle.family === f ? "on" : ""} onClick={() => onScanStyle({ ...scanStyle, family: f })}>
                {f === "auto" ? "Auto match" : f === "sans" ? "Sans" : f === "serif" ? "Serif" : "Mono"}
              </button>
            ))}
          </div>
          <label className="check-row"><input type="checkbox" checked={scanStyle.bold} onChange={(e) => onScanStyle({ ...scanStyle, bold: e.target.checked })} /> Bold</label>
        </section>
      )}

      <section>
        <h3>Layout rules</h3>
        <label className="field-label">Keep aligned to</label>
        <div className="segmented">
          {(["auto", "left", "center", "right"] as Anchor[]).map((a) => (
            <button key={a} className={anchor === a ? "on" : ""} onClick={() => onAnchor(a)}>{a[0].toUpperCase() + a.slice(1)}</button>
          ))}
        </div>
        <label className="field-label">When the length changes</label>
        <select value={fit} onChange={(e) => onFit(e.target.value as Fit)}>
          <option value="auto">Automatic</option>
          <option value="none">Keep everything fixed</option>
          <option value="squeeze">Squeeze to fit</option>
          <option value="reflow">Shift rest of line</option>
        </select>
        <p className="help">{FIT_HELP[fit]}</p>
      </section>

      {lastResult && (
        <section>
          <h3>Last change</h3>
          <p className="summary">{lastResult.summary}</p>
          <CheckSummary preview={lastResult} error={null} checking={false} />
          <div className={"verdict " + (lastResult.verification.layoutPreserved ? "good" : "warn")}>
            {lastResult.verification.layoutPreserved
              ? (lastResult.reports[0]?.strategy === "scan-patch"
                ? "Only the edited area of the scan was replaced; the original scan image is untouched underneath."
                : "Verified: no other text moved and nothing changed outside the edited area.")
              : (lastResult.verification.warnings ?? []).join(" ") || "Layout changed; review with Compare."}
          </div>
        </section>
      )}

      <section>
        <h3>Annotations on this page</h3>
        {!annotations.length ? <p className="muted small">None. Select text to highlight it, or pick a tool from Annotate.</p> : (
          <ul className="annots">
            {annotations.map((a, i) => (
              <li key={a.id ?? i}>
                <span className="swatch" style={{ background: a.color ?? "#999" }} />
                <span className="an-type">{ANNOT_LABEL[a.type] ?? a.type}</span>
                <span className="an-text" title={a.contents}>{a.contents}</span>
                {a.id && <button className="btn ghost small" title="Delete" onClick={() => onDeleteAnnotation(a.id!)}>✕</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>History</h3>
        {!doc.history?.length ? <p className="muted">No edits yet. The original is always kept.</p> : (
          <ol className="history">
            {doc.history.map((h) => (
              <li key={h.version} className={h.applied ? "" : "undone"}>
                <span className="hv">v{h.version}</span>
                <span className="hs">{h.summary}</span>
                <span className="hp">p{h.page}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
