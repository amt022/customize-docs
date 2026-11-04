import { useEffect, useState } from "react";
import { api, type CheckIssue, type CheckResult, type IssueCategory } from "../api";

const CATEGORY: Record<IssueCategory, string> = {
  editing: "Editing",
  layout: "Layout & position",
  text: "Text & fonts",
  scan: "Scan & OCR",
  structure: "File structure",
};
const ICON = { error: "✕", warning: "!", info: "i" };

/** Document check: lists problems found in the PDF and caused by edits; click one to see it on the page. */
export default function CheckPanel({ docId, version, onShow, onClose }: {
  docId: string;
  version: number;
  onShow: (issue: CheckIssue | null) => void;
  onClose: () => void;
}) {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    api.check(docId).then((r) => { if (!cancelled) setResult(r); }, (e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [docId, version]);

  useEffect(() => () => onShow(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = result?.issues.filter((i) => showInfo || i.severity !== "info") ?? [];
  const groups = (Object.keys(CATEGORY) as IssueCategory[])
    .map((c) => [c, visible.filter((i) => i.category === c)] as const)
    .filter(([, items]) => items.length > 0);

  return (
    <aside className="props check">
      <header className="chat-head">
        <h3>✓ Document check</h3>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onClose} aria-label="Close check">✕</button>
      </header>
      <div className="check-body">
        {!result && !error && <p className="muted">Checking text, layout, scans, file structure and edits…</p>}
        {error && <p className="error-text">{error}</p>}
        {result && (
          <>
            <div className="check-summary">
              <span className="sev error">{result.summary.error} errors</span>
              <span className="sev warning">{result.summary.warning} warnings</span>
              <label className="small"><input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} /> {result.summary.info} notes</label>
            </div>
            {visible.length === 0 && (
              <p className="check-ok">{result.issues.length ? "No errors or warnings." : "No problems found."} Version {result.version}, {result.pages} page{result.pages > 1 ? "s" : ""}.</p>
            )}
            {groups.map(([cat, items]) => (
              <section key={cat}>
                <h4>{CATEGORY[cat]}</h4>
                <ul className="issues">
                  {items.map((i) => (
                    <li key={i.id} className={"issue " + i.severity + (active === i.id ? " active" : "")}>
                      <button onClick={() => { setActive(i.id); onShow(i); }} disabled={i.page == null && !i.boxes.length}>
                        <span className={"sev-icon " + i.severity}>{ICON[i.severity]}</span>
                        <span className="issue-main">
                          <strong>{i.title}</strong>{i.page != null && <span className="muted small"> · page {i.page}</span>}
                          {i.detail && <span className="issue-detail">{i.detail}</span>}
                          {i.fix && <span className="issue-fix">→ {i.fix}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
