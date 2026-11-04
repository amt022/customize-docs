import { useEffect, useRef, useState } from "react";
import { api, type SessionInfo } from "../api";
import Dialog from "./Dialog";

/** Header button: "Sign in" (mobile number + OTP) or the signed-in number with sign-out / delete account. */
export default function Account({ session, onChange, openSignIn = false, onSignInShown }: {
  session: SessionInfo;
  onChange: (s: SessionInfo) => void;
  openSignIn?: boolean; // set by other parts of the page ("Sign in to keep them")
  onSignInShown?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openSignIn) {
      setOpen(true);
      onSignInShown?.();
    }
  }, [openSignIn, onSignInShown]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  if (!session.multiUser) return null;
  if (!session.user) {
    return (
      <>
        <button className="btn account-btn" onClick={() => setOpen(true)}>Sign in</button>
        {open && <SignIn onClose={() => setOpen(false)} onDone={(s) => { setOpen(false); onChange(s); }} />}
      </>
    );
  }
  return (
    <div className="account" ref={box}>
      <button className="btn account-btn" aria-expanded={menu} onClick={() => setMenu(!menu)}>📱 {session.user.phone}</button>
      {menu && (
        <div className="account-menu" role="menu">
          <button role="menuitem" onClick={async () => { setMenu(false); onChange(await api.logout()); }}>Sign out</button>
          <button role="menuitem" className="danger" onClick={() => { setMenu(false); setConfirmDelete(true); }}>Delete account…</button>
        </div>
      )}
      {confirmDelete && (
        <Dialog
          title="Delete account"
          onClose={() => setConfirmDelete(false)}
          footer={<>
            <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="btn danger" onClick={async () => {
              try {
                onChange(await api.deleteAccount());
                setConfirmDelete(false);
              } catch (e) { setError((e as Error).message); }
            }}>Delete everything</button>
          </>}
        >
          <p>This permanently deletes your account and every document in it from our servers. It cannot be undone.</p>
          {error && <div className="error-banner">{error}</div>}
        </Dialog>
      )}
    </div>
  );
}

function SignIn({ onClose, onDone }: { onClose: () => void; onDone: (s: SessionInfo) => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const send = () => run(async () => {
    const r = await api.sendCode(phone);
    setSentTo(r.phone);
    setWait(r.resendSeconds);
    setCode("");
  });
  const verify = () => run(async () => onDone(await api.verifyCode(phone, code)));

  return (
    <Dialog title="Sign in or sign up" onClose={onClose} width={400}>
      {sentTo === null ? (
        <form className="signin" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <p className="muted small">New here? Just enter your number and your account is created automatically. Signed in, your documents are kept and open on any device. We text you a one-time code; no password needed.</p>
          <label>Mobile number
            <input type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={phone}
              onChange={(e) => setPhone(e.target.value)} autoFocus required />
          </label>
          <button className="btn primary" type="submit" disabled={busy || !phone.trim()}>{busy ? "Sending…" : "Send code"}</button>
        </form>
      ) : (
        <form className="signin" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <p className="muted small">Enter the 6-digit code sent to <b>{sentTo}</b>.</p>
          <label>Code
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} value={code}
              onChange={(e) => setCode(e.target.value)} autoFocus required className="otp" />
          </label>
          <button className="btn primary" type="submit" disabled={busy || code.replace(/\s/g, "").length < 6}>{busy ? "Checking…" : "Sign in"}</button>
          <div className="signin-links small">
            <button type="button" className="link" onClick={() => { setSentTo(null); setError(null); }}>Change number</button>
            <button type="button" className="link" disabled={wait > 0 || busy} onClick={send}>{wait > 0 ? `Resend in ${wait}s` : "Resend code"}</button>
          </div>
        </form>
      )}
      {error && <div className="error-banner">{error}</div>}
    </Dialog>
  );
}
