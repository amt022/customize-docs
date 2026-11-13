import { useState } from "react";
import { getLang, t, useLang } from "../i18n";
import { GROUPS, TEMPLATES, pixels, type Req } from "./requirements";

/** A document the form usually asks for. `pdfKb` = the upload limit portals commonly set for it. */
interface Doc { en: string; hi: string; optional?: boolean; pdfKb?: number }

const ID_PROOF: Doc = { en: "Photo ID (Aadhaar, PAN, Voter ID, Passport or Driving Licence)", hi: "फ़ोटो पहचान पत्र (आधार, पैन, वोटर आईडी, पासपोर्ट या ड्राइविंग लाइसेंस)" };
const CLASS10: Doc = { en: "Class 10 certificate (date of birth proof)", hi: "कक्षा 10 प्रमाणपत्र (जन्मतिथि का प्रमाण)" };
const CATEGORY: Doc = { en: "Caste / category certificate (SC, ST, OBC-NCL, EWS)", hi: "जाति / श्रेणी प्रमाणपत्र (SC, ST, OBC-NCL, EWS)", optional: true, pdfKb: 300 };
const PWBD: Doc = { en: "Disability (PwBD) certificate", hi: "दिव्यांगता (PwBD) प्रमाणपत्र", optional: true, pdfKb: 300 };
const CONTACT: Doc = { en: "Working email and mobile number (for OTP)", hi: "चालू ईमेल और मोबाइल नंबर (OTP के लिए)" };
const FEE: Doc = { en: "Fee payment: UPI, debit card or net banking", hi: "फ़ीस भुगतान: UPI, डेबिट कार्ड या नेट बैंकिंग" };

const DOCS: Record<string, Doc[]> = {
  "SSC (CGL, CHSL, MTS, GD)": [
    CONTACT, ID_PROOF, CLASS10,
    { en: "Highest qualification marksheet / degree", hi: "सर्वोच्च योग्यता की अंकसूची / डिग्री" },
    CATEGORY, PWBD,
    { en: "Ex-serviceman discharge certificate", hi: "पूर्व सैनिक डिस्चार्ज प्रमाणपत्र", optional: true },
    FEE,
  ],
  "UPSC (CSE, NDA, CDS)": [
    CONTACT,
    { en: "Photo ID card as PDF (the same ID is needed at the exam)", hi: "फ़ोटो पहचान पत्र PDF में (परीक्षा में यही आईडी लगेगी)", pdfKb: 300 },
    CLASS10,
    { en: "Graduation degree or final-year marksheet", hi: "स्नातक डिग्री या अंतिम वर्ष की अंकसूची" },
    CATEGORY, PWBD, FEE,
  ],
  "IBPS / SBI / RBI (bank exams)": [
    CONTACT, ID_PROOF, CLASS10,
    { en: "Graduation marksheets and degree", hi: "स्नातक की अंकसूचियाँ और डिग्री" },
    CATEGORY, PWBD,
    { en: "Scribe declaration", hi: "लेखक (स्क्राइब) घोषणा पत्र", optional: true },
    FEE,
  ],
  "NTA (NEET, JEE Main, CUET)": [
    CONTACT, ID_PROOF, CLASS10,
    { en: "Class 12 marksheet (or appearing details)", hi: "कक्षा 12 की अंकसूची (या परीक्षा में बैठने का विवरण)" },
    CATEGORY, PWBD,
    { en: "Postcard-size photo (some exams ask for it)", hi: "पोस्टकार्ड साइज़ फ़ोटो (कुछ परीक्षाओं में)", optional: true },
    FEE,
  ],
  "Railways (RRB NTPC, Group D)": [
    CONTACT, ID_PROOF, CLASS10,
    { en: "Educational qualification certificate", hi: "शैक्षिक योग्यता प्रमाणपत्र" },
    CATEGORY, PWBD,
    { en: "SC/ST certificate for free travel pass", hi: "मुफ़्त यात्रा पास के लिए SC/ST प्रमाणपत्र", optional: true, pdfKb: 500 },
    FEE,
  ],
  "PAN card (NSDL / UTIITSL)": [
    { en: "Proof of identity (Aadhaar, Voter ID, Passport…)", hi: "पहचान का प्रमाण (आधार, वोटर आईडी, पासपोर्ट…)", pdfKb: 300 },
    { en: "Proof of address", hi: "पते का प्रमाण", pdfKb: 300 },
    { en: "Proof of date of birth", hi: "जन्मतिथि का प्रमाण", pdfKb: 300 },
  ],
};

export const CHECKLIST_GROUPS = GROUPS.filter((g) => DOCS[g]);
const store = (g: string) => `formeasy.checklist.${g}`;
const readTicks = (g: string): string[] => {
  try { return JSON.parse(localStorage.getItem(store(g)) ?? "[]"); } catch { return []; }
};

function spec(r: Req): string {
  const [w, h] = pixels(r);
  const size = r.unit === "mm" ? `${r.w}×${r.h} mm (${w}×${h} px)` : `${w}×${h} px`;
  const kb = r.maxKB ? `${r.minKB}–${r.maxKB} KB` : `${r.minKB}+ KB`;
  return `${size} · ${kb} · ${r.format.toUpperCase()}`;
}

export default function Checklist({ group, onGroup, onPhoto, onCompress, onScan }: {
  group: string; onGroup: (g: string) => void;
  onPhoto: (preset: string) => void; onCompress: () => void; onScan: () => void;
}) {
  useLang();
  const hi = getLang() === "hi";
  const [ticks, setTicks] = useState<Record<string, string[]>>({});
  const mine = ticks[group] ?? readTicks(group);
  const toggle = (key: string) => {
    const next = mine.includes(key) ? mine.filter((k) => k !== key) : [...mine, key];
    setTicks({ ...ticks, [group]: next });
    try { localStorage.setItem(store(group), JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  const pictures = TEMPLATES.filter((x) => x.group === group);
  const docs = DOCS[group] ?? [];
  const keys = [...pictures.map((p) => p.name), ...docs.map((d) => d.en)];
  const done = keys.filter((k) => mine.includes(k)).length;

  return (
    <main className="home-main checklist">
      <h1>{t("Exam document checklist")}</h1>
      <p className="lede">{t("Choose an exam to see what its application form usually asks for. Tick items as you get them ready; your ticks stay on this device.")}</p>
      <div className="cl-picker" role="group" aria-label="Exam">
        {CHECKLIST_GROUPS.map((g) => (
          <button key={g} aria-pressed={g === group} onClick={() => onGroup(g)}>{g}</button>
        ))}
      </div>
      <div className="cl-head">
        <strong>{t("{done} of {total} ready", { done, total: keys.length })}</strong>
        {done > 0 && <button className="link small" onClick={() => { setTicks({ ...ticks, [group]: [] }); try { localStorage.removeItem(store(group)); } catch { /* storage unavailable */ } }}>{t("Reset ticks")}</button>}
      </div>
      <div className="cl-progress" aria-hidden="true"><span style={{ width: `${keys.length ? (100 * done) / keys.length : 0}%` }} /></div>

      <section className="cl-card" style={{ marginTop: 16 }}>
        <h2>🪪 {t("Photo, signature and thumb")}</h2>
        <p className="muted">{t("Made to the exact size and KB with the Photo & Signature tool.")}</p>
        <ul className="cl-items">
          {pictures.map((p) => {
            const on = mine.includes(p.name);
            return (
              <li key={p.name} className={"cl-item" + (on ? " done" : "")}>
                <input type="checkbox" checked={on} onChange={() => toggle(p.name)} aria-label={p.name} />
                <span>
                  <span className="cl-name">{p.name.slice(group.length + 2)}</span>
                  <span className="cl-spec">{spec(p)}{p.nameDate ? " · name + date on photo" : ""}</span>
                  {p.note && <span className="cl-spec">{p.note}</span>}
                </span>
                <button className="btn small primary" onClick={() => onPhoto(p.name)}>{t("Make it")} →</button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="cl-card">
        <h2>📄 {t("Documents to keep ready")}</h2>
        <p className="muted">{t("Scan them to PDF and compress each under the portal's limit.")}</p>
        <ul className="cl-items">
          {docs.map((d) => {
            const on = mine.includes(d.en);
            return (
              <li key={d.en} className={"cl-item" + (on ? " done" : "")}>
                <input type="checkbox" checked={on} onChange={() => toggle(d.en)} aria-label={d.en} />
                <span>
                  <span className="cl-name">{hi ? d.hi : d.en}</span>
                  {(d.optional || d.pdfKb) && (
                    <span className="cl-spec">
                      {d.optional ? t("if applicable") : ""}{d.optional && d.pdfKb ? " · " : ""}{d.pdfKb ? `PDF ≤ ${d.pdfKb} KB` : ""}
                    </span>
                  )}
                </span>
                {d.pdfKb !== undefined ? (
                  <span className="cl-actions">
                    <button className="btn small" onClick={onScan}>{t("Scan to PDF")}</button>
                    <button className="btn small" onClick={onCompress}>{t("Compress")}</button>
                  </span>
                ) : <span />}
              </li>
            );
          })}
        </ul>
      </section>
      <p className="cl-note">⚠ {t("Rules change with every notification. Check the official notification of your exam before you upload.")}</p>
    </main>
  );
}
