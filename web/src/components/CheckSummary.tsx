import type { EditResponse } from "../types";

interface Props {
  preview: EditResponse | null;
  error: string | null;
  checking: boolean;
  compact?: boolean;
}

/** Plain-language result of the server-side dry run for the pending edit. */
export default function CheckSummary({ preview, error, checking, compact }: Props) {
  if (error) return <div className="check bad">{error}</div>;
  if (!preview) return <div className="check muted">{checking ? "Checking…" : "Type to see how the change fits"}</div>;
  const r = preview.reports[0];
  const v = preview.verification;
  const subs = [...new Set(r.substitutes.map((s) => s.char))].join(" ");
  const subFonts = [...new Set(r.substitutes.map((s) => s.font))].join(", ");
  return (
    <div className={"check" + (checking ? " stale" : "")}>
      <div className="chips">
        {r.strategy === "scan-patch" ? (
          <span className="chip info">Drawn into scan · {r.font}</span>
        ) : r.strategy === "original-font" ? (
          <span className="chip good">Original font: {r.font}</span>
        ) : (
          <span className="chip warn" title={`Characters missing from the embedded font are drawn with ${subFonts}`}>
            {r.strategy === "mixed" ? `${subs} → ${subFonts}` : `Font: ${subFonts}`}
          </span>
        )}
        {r.recentered ? <span className="chip info">Line stays centred</span> : r.anchor !== "left" && <span className="chip info">Keeps {r.anchor} edge</span>}
        {r.fits ? <span className="chip good">Fits</span> : <span className="chip bad">Overflows {r.overflow}pt</span>}
        {r.fitApplied === "reflow" && !r.recentered && r.shift !== undefined && Math.abs(r.shift) > 0.05 && (
          <span className="chip info">Rest of line shifts {r.shift > 0 ? "+" : ""}{r.shift}pt</span>
        )}
        {r.scale < 0.999 && <span className="chip info">Squeezed to {Math.round(r.scale * 100)}%</span>}
        {v.movedGlyphs ? <span className="chip bad">{v.movedGlyphs} other chars moved</span> : null}
      </div>
      {!compact && r.warnings.length > 0 && (
        <ul className="warnings">{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
    </div>
  );
}
