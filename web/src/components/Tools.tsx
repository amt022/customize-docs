import { useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { t, useLang } from "../i18n";

type QrKind = "link" | "text" | "upi" | "wifi" | "contact";

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const esc = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");

/** Text that goes into the QR code for each kind. */
function payload(kind: QrKind, f: Record<string, string>): string {
  switch (kind) {
    case "link": return f.url?.trim() ?? "";
    case "text": return f.text ?? "";
    case "upi": {
      if (!f.vpa?.trim()) return "";
      const q = new URLSearchParams({ pa: f.vpa.trim(), pn: f.payee?.trim() || f.vpa.trim(), cu: "INR" });
      if (f.amount && +f.amount > 0) q.set("am", (+f.amount).toFixed(2));
      if (f.note?.trim()) q.set("tn", f.note.trim());
      return `upi://pay?${q.toString().replace(/\+/g, "%20")}`;
    }
    case "wifi": return f.ssid ? `WIFI:T:${f.security || "WPA"};S:${esc(f.ssid)};P:${esc(f.password ?? "")};;` : "";
    case "contact": return f.name ? ["BEGIN:VCARD", "VERSION:3.0", `FN:${f.name}`, f.phone && `TEL:${f.phone}`, f.email && `EMAIL:${f.email}`, f.org && `ORG:${f.org}`, "END:VCARD"].filter(Boolean).join("\n") : "";
  }
}

function QrMaker() {
  const [kind, setKind] = useState<QrKind>("link");
  const [f, setF] = useState<Record<string, string>>({ url: "https://formeasy.in", security: "WPA" });
  const [fg, setFg] = useState("#111111");
  const [bg, setBg] = useState("#ffffff");
  const [size, setSize] = useState(600);
  const [label, setLabel] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const data = payload(kind, f);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  const qr = useMemo(() => {
    if (!data) return null;
    try {
      const q = qrcode(0, "M");
      q.addData(unescape(encodeURIComponent(data)));
      q.make();
      return q;
    } catch { return null; }
  }, [data]);

  const draw = (c: HTMLCanvasElement, px: number) => {
    const n = qr!.getModuleCount(), quiet = 4, cell = px / (n + quiet * 2);
    const lh = label ? px * 0.12 : 0;
    c.width = px; c.height = px + lh;
    const x = c.getContext("2d")!;
    x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = fg;
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr!.isDark(r, col)) x.fillRect(Math.floor((quiet + col) * cell), Math.floor((quiet + r) * cell), Math.ceil(cell), Math.ceil(cell));
    if (label) {
      x.font = `600 ${px * 0.055}px system-ui, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(label, px / 2, px + lh * 0.35, px * 0.9);
    }
  };
  useEffect(() => { if (canvas.current && qr) draw(canvas.current, 360); });

  const svg = () => {
    const n = qr!.getModuleCount(), q = 4, s = n + q * 2;
    let p = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr!.isDark(r, c)) p += `M${c + q} ${r + q}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="${bg}"/><path d="${p}" fill="${fg}"/></svg>`;
  };
  const contrastLow = (() => {
    const lum = (h: string) => { const v = parseInt(h.slice(1), 16); return 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255); };
    return lum(bg) - lum(fg) < 100;
  })();

  const field = (k: string, labelText: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>{t(labelText)}<input value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} {...props} /></label>
  );

  return (
    <section className="tool-card">
      <h2>🔳 {t("QR code maker")}</h2>
      <p className="muted small">{t("Make a QR code for a link, UPI payment, Wi-Fi, contact card or any text. Made in your browser.")}</p>
      <div className="seg" role="radiogroup" aria-label={t("QR type")}>
        {([["link", "Link"], ["upi", "UPI payment"], ["wifi", "Wi-Fi"], ["contact", "Contact"], ["text", "Text"]] as [QrKind, string][]).map(([k, l]) => (
          <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{t(l)}</button>
        ))}
      </div>
      <div className="tool-split">
        <div className="tool-form">
          {kind === "link" && field("url", "Web address", { inputMode: "url", placeholder: "https://…" })}
          {kind === "text" && <label>{t("Text")}<textarea rows={4} value={f.text ?? ""} onChange={(e) => set("text", e.target.value)} /></label>}
          {kind === "upi" && <>
            {field("vpa", "UPI ID", { placeholder: "name@okbank", autoCapitalize: "off" })}
            {field("payee", "Name shown to the payer")}
            {field("amount", "Amount in ₹ (optional)", { inputMode: "decimal" })}
            {field("note", "Note (optional)")}
            <p className="muted small">{t("Anyone who scans it pays this UPI ID. Check the ID twice before you print it.")}</p>
          </>}
          {kind === "wifi" && <>
            {field("ssid", "Network name")}
            {field("password", "Password", { type: "text", autoCapitalize: "off" })}
            <label>{t("Security")}<select value={f.security} onChange={(e) => set("security", e.target.value)}><option>WPA</option><option>WEP</option><option value="nopass">{t("None")}</option></select></label>
          </>}
          {kind === "contact" && <>
            {field("name", "Name")}
            {field("phone", "Mobile number", { inputMode: "tel" })}
            {field("email", "Email", { inputMode: "email" })}
            {field("org", "Organisation (optional)")}
          </>}
          {field("__label", "Caption under the code (optional)", { value: label, onChange: (e) => setLabel(e.target.value) })}
          <div className="cs-grid">
            <label>{t("Code colour")}<input type="color" value={fg} onChange={(e) => setFg(e.target.value)} /></label>
            <label>{t("Background")}<input type="color" value={bg} onChange={(e) => setBg(e.target.value)} /></label>
          </div>
          {contrastLow && <p className="tool-warn small">{t("The colours are too close; phones may not read this code. Use a dark code on a light background.")}</p>}
          <label>{t("Download size")}<select value={size} onChange={(e) => setSize(+e.target.value)}>{[300, 600, 1200, 2400].map((s) => <option key={s} value={s}>{s} × {s} px</option>)}</select></label>
        </div>
        <div className="tool-preview">
          {qr ? <canvas ref={canvas} aria-label={t("QR code preview")} /> : <p className="muted small">{t("Fill in the details to see the code.")}</p>}
          <div className="tool-actions">
            <button className="btn primary" disabled={!qr} onClick={() => { const c = document.createElement("canvas"); draw(c, size); c.toBlob((b) => b && save(b, "qr-code.png"), "image/png"); }}>PNG</button>
            <button className="btn" disabled={!qr} onClick={() => save(new Blob([svg()], { type: "image/svg+xml" }), "qr-code.svg")}>SVG</button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- age calculator

function diff(from: Date, to: Date) {
  let y = to.getFullYear() - from.getFullYear(), m = to.getMonth() - from.getMonth(), d = to.getDate() - from.getDate();
  if (d < 0) { m -= 1; d += new Date(to.getFullYear(), to.getMonth(), 0).getDate(); }
  if (m < 0) { y -= 1; m += 12; }
  return { y, m, d };
}

const RELAX: [string, string, number][] = [
  ["gen", "General / EWS", 0], ["obc", "OBC (non-creamy layer)", 3], ["sc", "SC / ST", 5],
  ["pwbd", "PwBD (General)", 10], ["pwbd_obc", "PwBD (OBC)", 13], ["pwbd_sc", "PwBD (SC / ST)", 15], ["esm", "Ex-serviceman (approx.)", 3],
];

function AgeCalculator() {
  const [dob, setDob] = useState("2000-01-01");
  const [on, setOn] = useState(() => `${new Date().getFullYear()}-08-01`);
  const [min, setMin] = useState("18");
  const [max, setMax] = useState("27");
  const [cat, setCat] = useState("gen");
  const a = dob && on ? diff(new Date(dob + "T00:00:00"), new Date(on + "T00:00:00")) : null;
  const relax = RELAX.find((r) => r[0] === cat)![2];
  const upper = +max + relax;
  // eligible if born on or after (cut-off minus upper-1 years minus... ) → compute dates
  const cut = new Date(on + "T00:00:00");
  const bornAfter = new Date(cut.getFullYear() - upper - 1, cut.getMonth(), cut.getDate() + 1);
  const bornBefore = new Date(cut.getFullYear() - +min, cut.getMonth(), cut.getDate());
  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const born = new Date(dob + "T00:00:00");
  const ok = a && !isNaN(+born) && born >= bornAfter && born <= bornBefore;
  return (
    <section className="tool-card">
      <h2>🎂 {t("Age calculator for exams")}</h2>
      <p className="muted small">{t("Your exact age on the cut-off date in the notification, and whether you are inside the age limit after category relaxation.")}</p>
      <div className="tool-form">
        <div className="cs-grid">
          <label>{t("Date of birth")}<input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></label>
          <label>{t("Age counted as on")}<input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></label>
          <label>{t("Minimum age")}<input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} /></label>
          <label>{t("Maximum age")}<input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <label>{t("Category")}<select value={cat} onChange={(e) => setCat(e.target.value)}>{RELAX.map(([k, l, r]) => <option key={k} value={k}>{t(l)}{r ? ` (+${r})` : ""}</option>)}</select></label>
      </div>
      {a && a.y >= 0 && (
        <div className="tool-result" role="status">
          <strong className="tool-age">{t("{y} years, {m} months, {d} days", { y: a.y, m: a.m, d: a.d })}</strong>
          {min && max && (
            <p className={ok ? "tool-ok" : "tool-bad"}>
              {ok ? "✓ " + t("Inside the age limit ({min}–{max} years).", { min, max: upper }) : "✗ " + t("Outside the age limit ({min}–{max} years).", { min, max: upper })}
              <br /><span className="small">{t("Eligible if born between {a} and {b}.", { a: fmt(bornAfter), b: fmt(bornBefore) })}</span>
            </p>
          )}
          <p className="muted small">{t("Relaxation rules differ by exam and post; always confirm with the official notification.")}</p>
        </div>
      )}
    </section>
  );
}

export default function Tools() {
  useLang();
  return (
    <main className="home-wide tools">
      <h1>{t("Everyday tools")}</h1>
      <div className="tools-grid">
        <QrMaker />
        <AgeCalculator />
      </div>
    </main>
  );
}
