import { useEffect, useRef, useState } from "react";
import { api, ApiError, type ChatAction } from "../api";

interface Msg {
  role: "user" | "assistant" | "error";
  text: string;
  actions?: ChatAction[];
}

const SUGGESTIONS = [
  "Summarise this document",
  "Replace every “25,000” with “35,000”",
  "Highlight all amounts on page 1",
  "Add a DRAFT watermark",
];

/** Chat with the document assistant; it edits through the same verified engine. */
export default function ChatPanel({ docId, onChanged, onClose }: { docId: string; onChanged: () => Promise<unknown>; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversation, setConversation] = useState<string | undefined>();
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // braces matter: newer browsers return a Promise here, which React would treat as a cleanup
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setBusy(true);
    try {
      const r = await api.chat(docId, t, conversation);
      setConversation(r.conversationId);
      setMsgs((m) => [...m, { role: "assistant", text: r.reply, actions: r.actions }]);
      if (r.changed) await onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.body?.assistantUnavailable) setUnavailable(e.message);
      setMsgs((m) => [...m, { role: "error", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="props chat">
      <header className="chat-head">
        <h3>✦ Assistant</h3>
        <span className="spacer" />
        {msgs.length > 0 && (
          <button className="btn ghost small" title="New conversation" onClick={() => {
            if (conversation) api.resetChat(conversation).catch(() => undefined);
            setConversation(undefined);
            setMsgs([]);
          }}>New chat</button>
        )}
        <button className="btn ghost small" onClick={onClose} aria-label="Close assistant">✕</button>
      </header>
      <div className="chat-body">
        {unavailable && (
          <div className="chat-setup">
            <strong>The assistant needs a Claude API key.</strong> Set <code>ANTHROPIC_API_KEY</code> for the server
            (for example <code>$env:ANTHROPIC_API_KEY="sk-ant-…"</code> before <code>start.ps1</code>) and restart it.
          </div>
        )}
        {msgs.length === 0 && (
          <div className="chat-empty">
            <p>Ask about this PDF or tell me what to change. Every change keeps the original layout and can be undone.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => <button key={s} className="hit-chip" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={"bubble " + m.role}>
            <div className="bubble-text">{m.text}</div>
            {m.actions && m.actions.length > 0 && (
              <ul className="chat-actions">
                {m.actions.map((a, k) => <li key={k} className={a.ok ? "ok" : "bad"}>{a.ok ? "✓" : "✕"} {a.summary}</li>)}
              </ul>
            )}
          </div>
        ))}
        {busy && <div className="bubble assistant typing"><span /><span /><span /></div>}
        <div ref={end} />
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea
          rows={2}
          placeholder="e.g. Change the customer name to Rahul Tripathi"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          disabled={busy}
        />
        <button className="btn primary" type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </aside>
  );
}
