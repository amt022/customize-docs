import { useState } from "react";
import { api } from "../api";
import type { Anchor, FindHit, FindReplaceResponse, Fit } from "../types";

interface Props {
  docId: string;
  version: number;
  anchor: Anchor;
  fit: Fit;
  onHits: (hits: FindHit[]) => void;
  onGoto: (hit: FindHit) => void;
  onReplaced: (res: FindReplaceResponse) => void;
  onError: (msg: string) => void;
  onClose: () => void;
  initialQuery?: string;
}

export default function FindReplace({ docId, version, anchor, fit, onHits, onGoto, onReplaced, onError, onClose, initialQuery = "" }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [hits, setHits] = useState<FindHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (!query) return;
    setBusy(true);
    try {
      const h = await api.find(docId, query, matchCase, wholeWord);
      setHits(h);
      onHits(h);
      if (h.length) onGoto(h[0]);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const replaceAll = async () => {
    if (!query) return;
    setBusy(true);
    try {
      const res = await api.findReplace(docId, { query, replacement, matchCase, wholeWord, anchor, fit, baseVersion: version, dryRun: false });
      setHits([]);
      onHits([]);
      onReplaced(res);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="find-panel" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="find-row">
        <input autoFocus={!initialQuery} placeholder="Find" value={query} onChange={(e) => { setQuery(e.target.value); setHits(null); }}
          onKeyDown={(e) => e.key === "Enter" && search()} />
        <input autoFocus={!!initialQuery} placeholder="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && replaceAll()} />
      </div>
      <div className="find-row">
        <label><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
        <label><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole word</label>
        <span className="spacer" />
        <button className="btn" onClick={search} disabled={busy || !query}>Find</button>
        <button className="btn primary" onClick={replaceAll} disabled={busy || !query}>Replace all</button>
        <span className="muted small">Ctrl+Enter</span>
        <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {hits && (
        <div className="hits">
          {hits.length === 0 ? <span className="muted">No matches</span> : (
            <>
              <span className="muted">{hits.length} match{hits.length > 1 ? "es" : ""}</span>
              {hits.slice(0, 50).map((h, i) => (
                <button key={i} className="hit-chip" onClick={() => onGoto(h)}>p{h.page}: {h.text}</button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
