# FormEasy

One place to get every application requirement ready: government exams, jobs and admissions. The home page is a hub of tools:

- **Photo & Signature**: make photos and signatures meet an application's exact size, KB limit and format, with live checks.
- **PDF Studio**: edit, compress and check the PDFs (certificates, forms) you have to upload. The rest of this README describes it in detail (it was built first and is called "PDF Master" in the engine notes below).
- Planned: document scanner, document vault, exam checklist, tracker and reminders.

PDF Master edits the text of an **existing PDF in place**: you click a word, type the new text, and the rest of the page
stays exactly as it was — same fonts, sizes, colours, alignment and layout. It works on digital PDFs (text stored in the
file) and on scanned PDFs (photos of pages, via OCR).

Around that core it adds a document checker, page tools, annotations and signatures, compression on download,
password protection, an AI chat assistant, and a Windows desktop app that works offline.

---

## Contents

1. [Quick start](#1-quick-start)
2. [A tour of the app](#2-a-tour-of-the-app)
3. [How it works](#3-how-it-works)
4. [Features in detail](#4-features-in-detail)
5. [Configuration](#5-configuration)
6. [Project layout](#6-project-layout)
7. [REST API](#7-rest-api)
8. [Testing](#8-testing)
9. [Troubleshooting](#9-troubleshooting)
10. [Limitations](#10-limitations)
11. [Licences](#11-licences)

---

## 1. Quick start

**Requirements:** Windows, Python 3.11+, Node 20+.

```powershell
.\start.ps1            # first run: creates the Python environment, installs packages, builds the UI
                       # then serves everything on http://localhost:8000
.\start.ps1 -Dev       # development: API on :8000 plus a hot-reloading UI on http://localhost:5173
```

Open <http://localhost:8000>, drop a PDF onto the home page, and click a word to start editing.

### Optional extras

| Want | Do this |
|---|---|
| Edit **scanned** PDFs (OCR) | `winget install UB-Mannheim.TesseractOCR` and accept the administrator prompt. The Hindi model is downloaded automatically the first time it is needed. |
| Use the **AI assistant** | Set a Claude API key before starting: `$env:ANTHROPIC_API_KEY = "sk-ant-..."` then `.\start.ps1` |
| Run as a **desktop app** | `cd desktop; npm install; npm start` (development) or `npm run dist` (Windows installer) |

Without Tesseract, scanned pages show a notice and everything else still works. Without an API key, the assistant panel
shows setup instructions and everything else still works.

---

## 2. A tour of the app

**Home page** — upload a PDF (or a password-protected one; you are asked for the password) and see your documents.

**Editor toolbar**

| Button | What it does |
|---|---|
| Undo / Redo | Step through versions (Ctrl+Z / Ctrl+Y). Every change is a new version; nothing is ever overwritten. |
| Edit text | Select words and replace them. |
| 🖼 Images | Select, move, resize, rotate, replace, delete and insert pictures (see [Images](#images)). |
| Annotate | Highlight, underline, strikeout, notes, shapes, freehand drawing, signatures, stamps, insert image, watermark. |
| Pages | Rotate, delete, reorder, insert blank page, insert another PDF, extract or split. |
| Find & replace | Search the whole document and replace every match (Ctrl+F). |
| ✓ Check | Scan the PDF and your edits for problems (see [Document check](#document-check)). |
| ✦ Assistant | Chat with an AI that can read and change the document. |
| Edit / Original / Changes | Switch the view: current page, the untouched upload, or a red/blue diff of what changed. |
| Download | Choose a compression level and optionally protect with a password. |

**Editing a word**

1. Click a word. Shift-click to extend the selection along the line. Double-click (or press Enter) to edit.
2. Type the new text. While you type, a bar at the bottom shows a live dry run: whether the original font is used,
   whether the text fits, and what would move.
3. Press Enter to save. A verified result appears: *unchanged characters*, *pixels changed outside the edit*, and any warnings.
4. The right-hand panel lets you override the automatic behaviour: **Keep aligned to** (Auto / Left / Center / Right)
   and **When the length changes** (Automatic / Keep layout / Squeeze to fit / Shift rest of line).

---

## 3. How it works

### 3.1 Editing text without breaking the layout

Most "PDF editors" re-typeset a paragraph. PDF Master instead edits the page's **content stream** — the list of drawing
instructions inside the PDF — and changes only the instructions for the selected characters.

1. **Interpret.** A content-stream interpreter (`engine/interpreter.py`) walks every instruction and records each glyph
   with its font, size, colour, exact position, the clipping area it is drawn in, and *where in the file it came from*
   (stream, operator, array element). It follows text nested inside reusable form objects.
2. **Replace.** The selected glyphs are removed from their `TJ` (show-text) operators. Each removed glyph is replaced by
   a **kern** of exactly the same width, so everything after it stays put. The new text is inserted in the same operator.
3. **Use the original font.** New characters are encoded with the PDF's own embedded font whenever that font contains
   the glyph. PDF fonts are usually *subsets* (only the letters the document used), so this is often not possible.
4. **Fall back gracefully.** For characters the subset lacks, PDF Master finds the closest installed font (exact name,
   then same family, then a similar style), embeds a tiny subset of it, and switches to it only for those characters.
   Complex scripts such as Hindi are shaped with HarfBuzz and written with an `ActualText` marker so search and copy
   still return the real text.
5. **Align and fit.** The new text's width differs from the old. The editor decides what to do:

| Situation | Behaviour |
|---|---|
| Number columns (right-aligned) | The right edge stays fixed |
| Centred titles and names | The line grows or shrinks on **both** sides and stays centred |
| Mid-sentence edit in one text run | The rest of the line moves to close or open the gap |
| Table cells and separately placed text | Nothing moves; text that would hit a neighbour is narrowed (horizontal scaling) instead of overprinting |
| A line that would pass the page margin or its text box | Narrowed so it stays inside |
| Re-editing text that was previously narrowed | Returns to the line's normal width |

Alignment is **detected automatically** by comparing the selection with other text on the page (e.g. several lines
sharing one right edge or one centre line). You can override it per edit.

6. **Shared form objects.** If the text lives in a form object used on several pages (headers, footers, templates), only
   the page being edited gets its own copy; other pages are unchanged.

### 3.2 Verifying every edit

After each edit the result is re-read and rendered, and compared with the original:

- **Position check** — every untouched glyph must be at the same position (tolerance 0.05 pt).
- **Text check** — re-reading the page must return exactly the new text.
- **Pixel check** — the before/after renders (PDFium) are compared; pixels changed outside the edited area are counted.
- **Placement check** — new characters must not run off the page, be cut off by their text box, or overlap other text.

If any check fails the edit is still saved (so you can see it), but it is marked *layout not preserved* and the exact
reason is shown. Everything is reversible with Undo.

### 3.3 Scanned PDFs

A scan is an image, so there is no text to rewrite. PDF Master:

1. Runs **Tesseract OCR** (English + Hindi) as a background job and stores each word with its position in PDF space.
2. When you edit a word, it creates a small **patch image** on top of the scan: the old word is covered by
   reconstructed paper (matching colour and grain) and the new word is drawn with FreeType + HarfBuzz to match the
   original's size, width, baseline and ink colour. You choose sans / serif / mono and bold.
3. The original scan image is **never re-encoded**, so no JPEG quality is lost. Editing the same word again merges
   patches so nothing of the earlier edit remains.
4. **Make searchable** adds an invisible text layer (kept in sync with later edits) so the PDF can be searched and copied.

### 3.4 Versions and storage

- Every change creates an **immutable version** file (version 0 is the untouched upload). Undo/Redo move a pointer;
  editing after an undo discards the redo branch.
- Metadata lives in **SQLite** (`backend/data/pdfmaster.db`) or, on a hosted website, **PostgreSQL**:
  `documents` (with an `owner` per user), `document_versions` (with the file's `storage_key`), `edit_operations`
  (what was done and the verification report), `processing_jobs` (OCR), and for website accounts `users`,
  `sessions`, `otp_codes`.
- Files are stored under `backend/data/docs/<document id>/` (or in an S3 bucket) as `v<n>-<random>.pdf`, with OCR
  results in `ocr/` beside them. Older `v<n>.pdf` names are still read.
- Encrypted uploads are decrypted into a working copy; you can protect the download again.

---

## 4. Features in detail

### Text editing (digital PDFs)

- Click / Shift-click / double-click selection, live dry run, verified result.
- **Find & replace** across all pages, including OCR'd scans, with match-case and whole-word options. Selecting a word
  and clicking **Replace all occurrences…** opens it pre-filled.
- Original embedded font first, installed-font fallback only for missing letters, HarfBuzz shaping for Hindi and other
  complex scripts.
- Automatic alignment and fit (see [section 3.1](#31-editing-text-without-breaking-the-layout)).

### Text editing (scanned PDFs)

See [section 3.3](#33-scanned-pdfs). Requires Tesseract. The scan must be upright (a page `/Rotate` is fine;
a skewed image is not — the checker will tell you if a scan is skewed).

### Document check

Click **✓ Check** to scan the PDF and your edits. Findings are ranked *error*, *warning* or *note*, grouped by
category, each with an explanation and a suggested fix. Click one to jump to the page, where the affected characters
are outlined.

| Category | Examples of what it detects |
|---|---|
| **Editing** | edited text overlapping neighbours or strongly compressed; replacement fonts used; untouched text that moved; background changed around an edit; link text changed; digital signature invalidated; which pages differ from the original |
| **Layout** | text outside the page, cut off at the edge, or hidden by its clipping box; overlapping text; text at odd angles; invalid page size, rotation or crop box; mixed page sizes; inconsistent margins |
| **Text & fonts** | fonts not embedded; text that cannot be copied (no Unicode mapping); font or weight changes inside a word; text drawn twice; letters overlapping; words with no space character; unusual reading order; tiny or invisible text |
| **Scans & OCR** | low resolution, blur, skew, too dark, low contrast, faded text, uneven lighting, specks and noise; low-confidence OCR words; duplicate OCR layers |
| **File structure** | damaged or repaired files; corrupt images; unsupported compression; missing or inconsistent metadata; broken links and destinations; form fields without a name or appearance; password-protected original |

Findings from edits that were later replaced are not reported. Every edit also gets the placement checks at save
time, so a problem is flagged the moment it happens.

### AI assistant

Open **✦ Assistant** and ask about the PDF or tell it what to change:

> "Replace every 25,000 with 35,000" · "Change the customer name to Rahul Tripathi" · "Highlight all totals" ·
> "Add a DRAFT watermark" · "Rotate page 2" · "Summarise this document" · "Undo that"

The assistant (Claude Opus 5.5) can read pages, search, replace text, edit a line, highlight, add notes, watermark,
perform page operations and undo. It changes the document **through the same verified engine**, so fonts and layout
are preserved and every change is a new undoable version. Each reply lists the actions taken (✓ / ✕). It asks before
deleting pages or making very large replacements. Refusal fallbacks are enabled, so a request declined on safety
grounds is retried on a substitute model. Conversations are kept in server memory only.

### Pages

Rotate, delete, reorder (drag thumbnails or use ↑ ↓), insert a blank page, insert another PDF after the current page,
extract a page range into a new document, or split into one document per page. All undoable.

### Photo & Signature tab

The **Photo & Signature** tab on the home page is one tool for application photos and signatures: a standalone, in-browser editor (nothing is uploaded; `web/src/components/ImageEditor.tsx`). Load PNG/JPG/WebP files as layers on a canvas, then:

- **Application requirements:** enter what the portal asks for (width x height in px or mm, min and max KB, format), tick *Make my picture meet these limits*, and the canvas, format and file-size target are set for you while you edit. A live pass/fail check shows format, dimensions and size of what will be downloaded; a JPEG below the minimum size is padded with empty metadata. Limits can be saved by name (browser storage). The built-in limits are **examples only**: copy the exact limits from the official notification.
- **Resize / position:** drag corner handles, exact X/Y/width/height, keep aspect ratio, 50%/200%/original/fit.
- **Rotate / flip:** 90/180/270, any angle (slider or rotate handle, Shift snaps to 15°), flip H/V.
- **Crop / mask:** click *Crop with mouse* and drag the edge or corner handles (or type % values); rounded or circle mask.
- **Adjust:** brightness, contrast, saturation, opacity, blur, grayscale, black & white, sharpen, background removal.
- **Preset sizes:** pick passport (35×45 mm), US visa 2×2 in, stamp, postcard, photo print, wallet, ID card, signature, A4/A5, Instagram, story, YouTube thumbnail or Facebook cover from the *Size* list. Millimetre presets are converted at 150/300/600 dpi; the picture is filled or fitted to the new canvas, and *Rotate size* swaps portrait and landscape.
- **Border / shadow**, **replace**, **duplicate** (Ctrl+D, or Ctrl+C / Ctrl+V), delete.
- **Arrange:** align left/centre/right/top/middle/bottom, distribute, bring forward / send backward, lock position.
- **Download:** PNG, JPG or WebP. Choose a quality, or *Set file size* (e.g. at most 50 KB): the best quality that fits is used, and the picture is shrunk if needed. *Check size* shows the result without downloading.

### Images

The home page has its own **Images** section with two entry points: *Edit pictures in a PDF* (opens a PDF directly in the Images tool) and *Make a PDF from pictures* (choose JPG/PNG/GIF/WebP files; each becomes one page, via `POST /documents/from-images`). Both open the editor with the Images tool already active.

Click **🖼 Images** in the toolbar. Every picture on the page gets a selection box, and the side panel lists them.

- **Move** by dragging the picture. **Resize** by dragging any of the eight handles; the live size is shown in points.
  Proportions are kept by default (untick *Keep proportions*, or hold **Shift** while dragging, to stretch).
- **Exact size and position:** type X, Y, Width and Height in points, inches, cm or mm (measured from the top-left of the page).
  Quick buttons scale to 50 / 75 / 125 / 200 %, **Fit width** or **Fit page**.
- **Rotate** left or right in 90° steps, **Replace picture…** (keeps the place, fits the new picture inside the old frame),
  **Delete** (button or the Delete key).
- **Insert image…** adds a PNG, JPEG, GIF or WebP at the centre of the page, already selected so you can drag and resize it.
  *Annotate → Insert image* lets you drag out the area instead. JPEG photos are embedded exactly as they are, with no
  quality loss; transparency in PNG/GIF/WebP is kept. Pictures up to 25 MB.
- The panel shows each picture's pixel size and the resolution it is drawn at, and warns when it falls below 150 dpi.
- It works wherever the picture lives: in the page, under nested transforms, or inside a reusable page element
  (then only the current page changes). A picture that sits inside a cropping frame is flagged, because enlarging it
  cannot show more than the frame allows.
- Every change is a new version and can be undone. The picture itself is never re-encoded when moved or resized,
  only the instruction that draws it changes.

Signatures and the older annotation stamps are separate from page pictures and are not listed here.

### Annotations

Highlight, underline, strikeout, notes, rectangles, ellipses, freehand drawing, **signatures** (draw or upload),
image stamps, text stamps (APPROVED, PAID, …) and diagonal watermarks (add or remove). Each is a standard PDF
annotation with its own appearance stream, so it looks the same in Acrobat, Chrome, Edge and other viewers.
Annotations are listed per page and can be deleted.

### Compression on download

The **Download** dialog lists four levels and shows the resulting size of each *before* you download.

| Level | What it does |
|---|---|
| **No compression** | The file exactly as stored |
| **Lossless** (default) | Pages stay pixel-identical. Maximum Flate, compressed object streams, identical images and fonts stored once, Type 1 fonts re-encoded as compact CFF (LaTeX files often shrink by two thirds), font tables no viewer reads dropped, replacement-font subsets from separate edits merged into one, unused resources and thumbnails dropped |
| **Balanced** | Lossless **plus** TrueType font hinting removed (outlines unchanged; text looks the same, antialiasing differs by a fraction of a pixel, print is unaffected) **plus** photos and scans above 150 dpi downsampled to JPEG (quality 75) |
| **Smallest** | Balanced, but images above 100 dpi and JPEG quality 60, and accessibility tags and XMP metadata removed. Best for email |

Safeguards:

- Text, glyph outlines and vector graphics are never rasterised or changed — text stays sharp, searchable and editable.
- Screenshots and line art keep lossless compression; bilevel scans (CCITT/JBIG2), CMYK and indexed images are left alone.
- A file is **never made bigger** than the original.
- When a level cannot shrink a particular file further than the level before it, the dialog says so and explains why
  (e.g. "no large images, accessibility tags or metadata left to remove").
- Compression runs **before** password protection. Signed PDFs default to *No compression* so the signature stays valid.

Typical results: LaTeX resume 96 KB → 30 KB (Lossless); text invoice 61 KB → 27 KB (Balanced); scanned statement
95 KB → 34 KB (Balanced) or 19 KB (Smallest).

### Security

- **AES-256** password protection on download (password to open, optional permissions password) with restrictions on
  printing, copying and editing.
- Password-protected uploads are opened with their password; a decrypted working copy is kept.
- A warning appears for digitally signed PDFs: any change invalidates the signature.
- In desktop mode the engine listens only on loopback and rejects requests without a random per-launch token; the UI is
  sandboxed with context isolation and no Node access.

### Versions and comparison

Undo/Redo, a history list, and **Original** / **Changes** views. *Changes* shows removed ink in red and added ink in blue.

---

## 5. Configuration

Environment variables (all optional):

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the AI assistant |
| `PDFMASTER_TESSERACT` | Full path to `tesseract.exe` if it is not on the usual path |
| `PDFMASTER_DATA` | Folder for the database, versions and OCR data (default `backend/data`) |
| `PDFMASTER_TOKEN` | If set, every API request must send it as `X-PDFMaster-Token` (used by the desktop app) |
| `PDFMASTER_FONT_DIRS` | Extra folders to search for installed fonts used as replacements |
| `PDFMASTER_WEB` | Folder of the built UI to serve (default `web/dist`) |
| `PDFMASTER_CORS` | Allowed web origins for the API (default `http://localhost:5173`, the dev UI) |
| `PDFMASTER_MAX_UPLOAD_MB` | Largest upload / request (default 200) |
| `PDFMASTER_DATABASE_URL` | `postgresql://user:pass@host:5432/db` to keep metadata in PostgreSQL instead of `<data>/pdfmaster.db` |
| `PDFMASTER_STORAGE` | `local` (default, files under `<data>/docs`) or `s3` |
| `PDFMASTER_S3_BUCKET`, `PDFMASTER_S3_PREFIX` | Bucket and optional key prefix for `s3` storage |
| `PDFMASTER_S3_ENDPOINT`, `PDFMASTER_S3_REGION` | For Cloudflare R2 / Backblaze B2 / MinIO, or an AWS region such as `ap-south-1` |
| `PDFMASTER_S3_SSE` | Server-side encryption header (default `AES256`; empty for providers that reject it) |
| `PDFMASTER_MULTIUSER` | `1` = hosted website: each browser gets its own private documents via an anonymous session cookie |
| `PDFMASTER_COOKIE_SECURE` | `0` only for testing hosted mode over plain http |
| `PDFMASTER_RETENTION_HOURS` | Delete documents of browsers that did not sign in after this many idle hours (default 0 = never) |
| `PDFMASTER_ACCOUNT_RETENTION_DAYS` | Same for signed-in accounts (default 0 = keep until the user deletes them) |
| `PDFMASTER_EMAIL` | How emailed sign-in codes are sent: `smtp` or `console` (server log, local testing only). Hosted mode needs this and/or `PDFMASTER_SMS` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | SMTP server for `PDFMASTER_EMAIL=smtp` (port 587 + `starttls` by default; `ssl` uses 465) |
| `PDFMASTER_SMS` | How texted sign-in codes are sent: `msg91`, `twilio`, or `console`. Optional when email is set |
| `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | MSG91: auth key and a DLT-approved OTP template with an `##otp##` variable |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Twilio SMS |
| `PDFMASTER_SECRET` | Key for hashing codes and session tokens; must be the same on every server (default: `<data>/secret.key`) |
| `PDFMASTER_SINGLE_USER` | `1` to allow PostgreSQL / S3 or a network address without hosted mode (one-person server) |

Run the engine directly: `python -m pdfmaster --port 8000` (from `backend`).

### Hosted website

Full guide, including setting up the email (and optional SMS) provider for sign-in codes: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

The desktop app keeps everything on the user's PC. For a public website, run with:

```
PDFMASTER_MULTIUSER=1
PDFMASTER_RETENTION_HOURS=24
PDFMASTER_DATABASE_URL=postgresql://...      # managed PostgreSQL (Supabase, Neon, RDS)
PDFMASTER_STORAGE=s3
PDFMASTER_S3_BUCKET=formeasy-docs            # S3 / R2 / B2, ideally an India region
AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...
```

- Install `requirements-server.txt` as well (boto3, psycopg). `backend/Dockerfile` builds an image with the UI,
  Tesseract (English + Hindi) and these settings; build it from the project root.
- Serve over HTTPS (the session cookie is `Secure`). Uploaded documents are only visible to the browser that uploaded
  them. Signing in (email address or mobile number + one-time code, optional) moves them into an account that works on any device; users can
  sign out or delete their account and all its documents from the header menu.
- Set `PDFMASTER_EMAIL=smtp` (any SMTP provider) and/or `PDFMASTER_SMS=msg91` (India; DLT template first) or
  `twilio`, and a shared `PDFMASTER_SECRET`. The server refuses to start in hosted mode without one of them, and refuses PostgreSQL / S3 without
  `PDFMASTER_MULTIUSER=1`, so a shared document list cannot happen by accident.
- Try hosted mode locally with `python run_hosted.py` (port 8001, codes printed in the server log).
- Several server instances can share one database and bucket: edits use a version check, so a conflicting edit gets
  409 instead of overwriting. AI-assistant conversations are kept in memory per instance (use sticky sessions).
- `PDFMASTER_DATA` is then only a local scratch folder (Tesseract models, font index).

### Desktop app

```powershell
cd desktop
npm install
npm start          # runs the engine on a random loopback port with a per-launch token
npm run dist       # builds a Windows installer: PyInstaller freezes the engine, electron-builder packages the app
```

`npm start` has been verified. `npm run dist` is scripted but has not been run in this environment.

---

## 6. Project layout

```
start.ps1             set up and run (Windows PowerShell)
docs/DEPLOYMENT.md    putting the website online: status, OTP (SMS) setup, server settings, next steps
web/                  React + TypeScript + PDF.js editor UI
  src/api.ts          typed client for the REST API
  src/components/     Editor, Viewer, InlineEditor, PropertiesPanel, FindReplace, CheckPanel,
                      ImageLayer, ImagePanel, ChatPanel, Dialogs (download / watermark), Thumbnails, SignaturePad, …
desktop/              Electron shell (main.js, preload.js, build-server.js)
backend/
  requirements.txt
  requirements-server.txt  extra packages for the hosted website (boto3, psycopg) and its tests
  Dockerfile          hosted-website image (UI + Tesseract); build from the project root
  run_hosted.py       try website mode locally on port 8001
  pdfmaster/
    api.py            REST API (FastAPI), token / session-cookie middleware, start-up checks, serves the built UI
    service.py        documents, versions, owners, expiry, OCR jobs, orchestration
    storage.py        where files live: local folder or S3 / R2 / B2
    db.py             SQLite or PostgreSQL
    auth.py           website accounts: mobile number + OTP, sessions, SMS senders (MSG91, Twilio)
    assistant.py      Claude assistant: tool definitions and the tool loop
    engine/           framework-free PDF engine
      interpreter.py  content-stream interpreter: glyphs with geometry, style, clip and source location
      fonts.py        font decoding, widths, glyph availability in subset fonts
      cmap.py         CMap / ToUnicode parsing
      editor.py       in-place rewriting, font substitution, alignment and fit, form detaching
      sysfonts.py     installed-font matching, HarfBuzz shaping, embedded Type0 subsets
      document.py     apply edits, find, page model
      validate.py     position verification and pixel diff
      render.py       PDFium rendering and PDF ↔ pixel mapping
      ocr.py          Tesseract OCR, page identity, invisible text layer
      scanedit.py     scan patching with rasterised, shaped text
      pages.py        page operations
      annotate.py     annotations, signatures, stamps, watermarks
      images.py       page pictures: list, move / resize / rotate, delete, replace, insert
      preflight.py    document check
      compress.py     download compression
      security.py     AES-256 export with permissions
  tests/              automated tests and small PDF fixtures
```

---

## 7. REST API

Base path `/api/v1`. Responses have the shape `{success, message, data, timestamp}`.
A stale `baseVersion` returns **409**, an invalid edit **422**, missing OCR or assistant setup **503**.

| Method | Path | Purpose |
|---|---|---|
| GET | `/session` | Mode, auto-delete settings, upload limit, signed-in user |
| POST | `/auth/code` · `/auth/verify` | Website only: text a sign-in code `{phone}`; check it `{phone, code}` (signs in, creates the account on first use) |
| POST / DELETE | `/auth/logout` · `/auth/account` | Website only: sign out; delete the account and all its documents |
| POST | `/documents` | Upload (multipart `file`, optional `password`) |
| GET / DELETE | `/documents`, `/documents/{id}` | List; details with history; move to Recently deleted |
| GET · POST · DELETE | `/trash` · `/trash/{id}/restore` · `/trash/{id}` | Recently deleted: list; restore; erase for good (auto after `PDFMASTER_TRASH_DAYS`, default 30) |
| GET | `/documents/{id}/file?version=` · `/download` | PDF bytes / attachment |
| POST | `/documents/{id}/export` | Download with `compression` (`none`/`lossless`/`balanced`/`strong`) and optional AES-256 password + permissions |
| GET | `/documents/{id}/compression` | Resulting size at every compression level |
| GET | `/documents/{id}/pages/{n}/text` | Glyphs, lines and fonts (or OCR words for scans) |
| GET | `/documents/{id}/pages/{n}/render.png` | Server-side render |
| POST | `/documents/{id}/edit/replace-text` | `{page, edits:[{glyphs, text, anchor, fit, style}], baseVersion, dryRun}` |
| POST | `/documents/{id}/find` · `/edit/find-replace` | Search / replace everywhere |
| POST | `/documents/{id}/undo` · `/redo` | Move the version pointer |
| POST | `/documents/{id}/pages` | `{op: rotate \| delete \| move \| reorder \| insert-blank, …}` |
| POST | `/documents/{id}/merge` · `/extract` | Insert another PDF / create documents from page ranges |
| POST | `/documents/{id}/pages/{n}/images` | `{action: insert \| transform \| delete \| replace, index?, bbox?, rect?, rotate?, image?, fit?, baseVersion}`; the page's pictures are listed in `GET …/pages/{n}/text` under `images` |
| POST | `/documents/{id}/annotations` | highlight, underline, strikeout, squiggly, note, rect, ellipse, ink, signature, image, stamp |
| GET / DELETE | `/documents/{id}/pages/{n}/annotations[/{name}]` | List / delete |
| POST | `/documents/{id}/watermark` | Add, or remove with `remove: true` |
| POST | `/documents/{id}/ocr` → `GET /jobs/{jobId}` | Background OCR (202 + job) |
| POST | `/documents/{id}/ocr/text-layer` | Make scanned pages searchable |
| GET | `/ocr/status` | Whether Tesseract is available |
| GET | `/documents/{id}/check` | Document check: `{issues:[{category, severity, page, title, detail, fix, boxes}], summary}` |
| GET | `/documents/{id}/compare/{n}.png?a=&b=` | Visual diff between two versions |
| POST | `/documents/{id}/assistant` | Chat: `{message, conversationId?}` → reply, actions taken |
| DELETE | `/assistant/{conversationId}` | End a conversation |

---

## 8. Testing

```powershell
cd backend
.\.venv\Scripts\python -m pytest -q
```

85 tests cover the engine (same-width and different-width edits, alignment, reflow, centred lines, margins,
squeezed-text re-edit, Hindi shaping, shared forms, cross-stream edits), scanned-page editing (synthetic OCR),
annotations, page pictures (including pictures inside form objects and nested transforms), security, the REST API, the document checker (including seven kinds of degraded scans), compression
(pixel-identical Lossless, image downsampling, font conversion and slimming) and the assistant (using a scripted
stand-in for Claude), plus the hosted website: per-browser isolation, sign-in, expiry and safety checks
(`test_auth.py`), S3 storage against a simulated S3 and PostgreSQL against a throwaway server (`test_storage.py`;
needs `requirements-server.txt`, otherwise those tests are skipped). Real Claude responses, real Tesseract OCR and
real SMS sending are not exercised by the automated tests.

`tests/make_fixtures.py` regenerates the sample PDFs; it is a developer tool that needs PyMuPDF, which the app itself
does not use.

---

## 9. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| UI looks old after an update | Hard-refresh with **Ctrl+F5** |
| "Scanned page" banner says Tesseract isn't installed | `winget install UB-Mannheim.TesseractOCR`, or set `PDFMASTER_TESSERACT`; reopen the page |
| Assistant shows "needs a Claude API key" | Set `ANTHROPIC_API_KEY` in the shell that starts the server and restart it |
| Edited text is a slightly different shape | The original font lacked those letters, so an installed font was used. The check panel lists exactly which letters. Install the original font family and redo the edit for an exact match |
| Text looks squeezed | It would not fit its space, so it was narrowed. Use shorter text, or choose *Keep layout* in the side panel |
| Edit says "layout not preserved" | Open **✓ Check** for the reason; use **Undo** and try another fit mode |
| Two compression levels show the same size | That file has nothing more to remove at the stronger level; the dialog explains why |
| Port 8000 is busy | Stop the other server, or run `python -m pdfmaster --port 8001` from `backend` |

---

## 10. Limitations

- Type 3 fonts and vertical CJK text can be viewed and annotated but not edited as text.
- Scan editing needs an upright scan. JBIG2-compressed scans need `jbig2dec` to decode.
- Editing a digitally signed PDF invalidates its signature (the UI warns you). Compressing does too.
- Removing font hinting (Balanced / Smallest) can very slightly change how small text is smoothed on screen in
  viewers that use hinting; printing is unaffected.
- Fonts embedded in full (not subset) are not trimmed to the letters used.
- The checker reports likely problems; some are judgement calls (for example, text over images is not flagged because
  designs do it on purpose). It was tuned on a handful of documents, so expect the occasional false alarm.
- OCR reading order is not checked; paragraph spacing and line wrapping are not judged.
- Windows is the supported platform; the desktop installer build is untested.

---

## 11. Licences

All runtime dependencies are permissively licensed: pikepdf (MPL-2.0), PDFium / pypdfium2 (Apache-2.0 / BSD),
fontTools (MIT), HarfBuzz / uharfbuzz (MIT), FreeType (FTL), Pillow (HPND), NumPy (BSD), FastAPI (MIT),
Tesseract (Apache-2.0). The AI assistant uses the Anthropic SDK (MIT). PyMuPDF (AGPL) is not used by the app.

**Roadmap** (not built yet): exam requirement library, candidate profile vault, document scanner and validator, application tracker and deadline reminders.
