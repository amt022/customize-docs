import { useEffect, useState } from "react";
import { api, type LegalInfo, type SessionInfo } from "../api";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

/** Privacy Policy and Terms of Use (hosted website). Operator and grievance details come from the server settings. */
export default function LegalPage({ kind, onBack }: { kind: "privacy" | "terms"; onBack: () => void }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  useEffect(() => { api.session().then(setSession).catch(() => setSession(null)); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [kind]);
  const legal = session?.legal ?? null;
  return (
    <div className="home">
      <header className="home-head">
        <button className="brand brand-link" onClick={onBack}><Logo size={34} /> <span className="wordmark">Form<b>Easy</b></span></button>
        <span style={{ flex: 1 }} />
        <ThemeToggle />
      </header>
      <main className="home-main legal-page">
        <button className="link" onClick={onBack}>← Back to FormEasy</button>
        {kind === "privacy" ? <Privacy s={session} l={legal} /> : <Terms l={legal} />}
        <p className="muted small">Version {legal?.version ?? "–"}. See also the{" "}
          {kind === "privacy" ? <a href="#terms">Terms of Use</a> : <a href="#privacy">Privacy Policy</a>}.</p>
      </main>
    </div>
  );
}

const who = (l: LegalInfo | null) => l?.operator || "the operator of this website";

function Grievance({ l }: { l: LegalInfo | null }) {
  return (
    <div className="legal-contact">
      <b>Grievance Officer</b><br />
      {l?.grievanceName && <>{l.grievanceName}<br /></>}
      {l?.grievanceEmail ? <a href={`mailto:${l.grievanceEmail}`}>{l.grievanceEmail}</a> : <span className="muted">(contact not set)</span>}
      {l?.address && <><br />{l.address}</>}
      <br /><span className="muted small">We acknowledge complaints within 24 hours and resolve them within 15 days.</span>
    </div>
  );
}

function Privacy({ s, l }: { s: SessionInfo | null; l: LegalInfo | null }) {
  const hours = s?.retentionHours, days = s?.accountRetentionDays, trash = s?.trashDays;
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p>This website is run by <b>{who(l)}</b> (“we”), the Data Fiduciary under India’s Digital Personal Data Protection Act, 2023.
        This page explains what we collect, why, how long we keep it and what you can do about it.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Files you upload</b> (PDFs, photos, signatures) and the edits you make, so the tools can work on them.
          Many Photo &amp; Signature tools run entirely in your browser and never send the picture to us.</li>
        <li><b>Your email address or mobile number</b>, only if you choose to sign in, to send you a one-time sign-in code and keep your documents in your account.
          We do not ask for your name, password, Aadhaar or any other ID.</li>
        <li><b>A session cookie</b> (<code>formeasy_sid</code>) that keeps your documents private to your browser. It is needed for the site to work; we use no advertising or tracking cookies.</li>
        <li><b>Server logs</b>: time, IP address, the page or action requested and the result, with a random account or browser code.
          They contain no file names, email addresses or phone numbers.</li>
      </ul>

      <h2>Why we use it</h2>
      <p>Only to provide the tools you use, keep your documents private to you, sign you in, prevent abuse and keep the service secure.
        We do not sell your data, show advertising or use your files to train AI models.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Files from visitors who have not signed in: {hours ? <>deleted {hours % 24 === 0 ? `${hours / 24} day(s)` : `${hours} hours`} after last use.</> : "until you delete them."}</li>
        <li>Signed-in accounts: {days ? <>documents not opened for {days} days are deleted.</> : "until you delete them or your account."}</li>
        <li>“Recently deleted” documents: {trash ? <>erased for good after {trash} days.</> : "kept until you erase them."}</li>
        <li>Server logs: {l?.logDays ?? 180} days, as required by CERT-In (Government of India) directions, then deleted.</li>
        <li>Sign-in codes expire after 10 minutes and are stored only in scrambled (hashed) form.</li>
      </ul>

      <h2>Who else handles it</h2>
      <p>We use service providers (Data Processors) who handle data only on our instructions: our cloud hosting and storage provider
        {l?.dataRegion ? <> (data stored in <b>{l.dataRegion}</b>)</> : null}, an email provider to send sign-in codes and, for mobile sign-in, an SMS provider.
        If you use the optional <b>Assistant</b> in PDF Studio, the text of that document and your question are sent to Anthropic, an AI provider
        whose servers may be outside India, to produce the answer. Do not use the Assistant on documents you do not want processed this way.
        We share data with government authorities only when Indian law requires it.</p>

      <h2>Security</h2>
      <p>Connections are encrypted (HTTPS), stored files are encrypted, each person can reach only their own documents, and codes and session keys are stored only as hashes.
        If a breach affects your data we will inform you and the authorities as the law requires.</p>

      <h2>Your rights</h2>
      <ul>
        <li><b>Access and correction</b>: see your documents at any time; write to us about anything else we hold.</li>
        <li><b>Erasure</b>: delete any document, or use <i>Account → Delete account</i> to erase the account and every document in it at once.</li>
        <li><b>Withdraw consent</b>: deleting your account withdraws it; we then stop processing your data, apart from logs we must keep by law.</li>
        <li><b>Nominate</b> someone to exercise these rights if you die or become unable to: write to the Grievance Officer.</li>
        <li><b>Complain</b> to the Grievance Officer below, and if not satisfied, to the Data Protection Board of India.</li>
      </ul>

      <h2>Children</h2>
      <p>If you are under 18, a parent or legal guardian must agree to this policy and should sign in with their own email address or mobile number on your behalf.
        We do not track or target advertising at anyone, including children.</p>

      <h2>Contact</h2>
      <Grievance l={l} />
      {l?.contactEmail && l.contactEmail !== l.grievanceEmail && <p>General questions: <a href={`mailto:${l.contactEmail}`}>{l.contactEmail}</a></p>}

      <h2>Changes</h2>
      <p>If this policy changes in a way that matters, we will show the new version and ask you to agree again when you next sign in.</p>
    </article>
  );
}

function Terms({ l }: { l: LegalInfo | null }) {
  return (
    <article>
      <h1>Terms of Use</h1>
      <p>These terms are an agreement between you and <b>{who(l)}</b>, who runs FormEasy. By uploading a file or signing in, you agree to them.
        If you are under 18, your parent or guardian must agree on your behalf.</p>

      <h2>What FormEasy is</h2>
      <p>FormEasy helps you prepare <b>your own</b> photos, signatures and documents for applications: resizing, compressing, converting and making small corrections.
        FormEasy is not connected to, approved by or acting for any government department, exam body (such as SSC, UPSC, IBPS, NTA, RRB), bank or university.
        Size and format presets are based on commonly published values; <b>always check the official notification</b> before you submit. You are responsible for what you upload to any application portal.</p>

      <h2>Forgery and misuse are not allowed</h2>
      <p>You may only edit documents that you own or have the right to change, to correct genuine mistakes in them. You must not use FormEasy to:</p>
      <ul>
        <li>create or alter certificates, marksheets, degrees, identity cards (Aadhaar, PAN, passport, voter ID and similar), caste / income / domicile certificates,
          bank statements, salary slips, admit cards, or any official or legal document so that it shows something untrue;</li>
        <li>use a changed document as if it were genuine, or pretend to be someone else;</li>
        <li>upload content that is illegal, or that you have no right to use;</li>
        <li>attack, overload or try to get around the security of the service.</li>
      </ul>
      <p>Making or using a false document is a criminal offence under the Bharatiya Nyaya Sanhita, 2023 (forgery, sections 336 to 340) and other laws.
        Areas of a scan changed with FormEasy are marked as such inside the PDF file. We will remove such content, close accounts that misuse the service,
        and cooperate with law enforcement when the law requires.</p>

      <h2>Your files</h2>
      <p>Your files stay yours. You let us store and process them only to provide the service, as described in the <a href="#privacy">Privacy Policy</a>.
        Files are deleted automatically after the times listed there; keep your own copies of anything important.</p>

      <h2>No guarantee</h2>
      <p>The service is provided free and “as is”. We work hard to make it accurate and available, but we cannot promise that it is error-free or always online,
        or that a portal will accept a file. To the extent the law allows, we are not liable for indirect losses, such as a missed application deadline.</p>

      <h2>Changes and ending use</h2>
      <p>We may change these terms or the service; important changes will be shown before you next sign in. You can stop using FormEasy and delete your account at any time.</p>

      <h2>Law and complaints</h2>
      <p>These terms are governed by the laws of India. Complaints about content, misuse or these terms go to:</p>
      <Grievance l={l} />
    </article>
  );
}

/** Footer on the hosted website: legal links and the grievance contact. */
export function SiteFooter({ session }: { session: SessionInfo | null }) {
  if (!session?.multiUser) return null;
  const l = session.legal;
  return (
    <footer className="site-footer small">
      <a href="#privacy">Privacy Policy</a>
      <a href="#terms">Terms of Use</a>
      {l?.grievanceEmail && <span>Grievance Officer{l.grievanceName ? `: ${l.grievanceName}` : ""} · <a href={`mailto:${l.grievanceEmail}`}>{l.grievanceEmail}</a></span>}
      <span className="muted">Not affiliated with any government or exam body.</span>
    </footer>
  );
}
