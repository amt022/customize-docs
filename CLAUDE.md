# FormEasy (project root: C:\ashish\editing)

All-in-one app for government / exam / admission paperwork: hub home, Photo & Signature tool, PDF Studio.

## Stack and layout
- `backend/pdfmaster` – Python, FastAPI, pikepdf. `engine/` holds the PDF/scan logic, `service.py` the API layer, `tests/` pytest (98 tests, all passing); `storage.py` (local folder or S3) and `db.py` (SQLite or PostgreSQL) hold the data.
- `web/` – React + TS + Vite. Build with `npm run build` after changes.
- `desktop/` – Electron wrapper.

## Commands (Windows / Git Bash)
- Python: `backend/.venv/Scripts/python.exe` (set `PYTHONIOENCODING=utf-8` for Hindi output).
- Tests (run from `backend/`, else `pdfmaster` won't import): `cd backend && .venv/Scripts/python.exe -m pytest tests`
- Installer: `cd desktop && npm run dist` → `desktop/dist/FormEasy Setup <ver>.exe`. Needs internet (pip) and Tesseract installed on the build machine; check `PDFMASTER_SMOKE=1 dist/win-unpacked/FormEasy.exe` prints `api 200`.
- Restart the server after any backend change (preview_stop, then preview_start "pdfmaster").
- Launch configs (`.claude/launch.json`): `pdfmaster` = desktop mode, port 8000, data in `backend/data` (the user's real documents; never test destructive things there). `pdfmaster-hosted` = website mode via `backend/run_hosted.py`, port 8001, data in `backend/data-hosted`, OTP codes printed in its log (`preview_logs` search "OTP for"). The app sometimes stops these servers; restart if "site can't be reached".
- Write python patch scripts with the Write tool, not shell heredocs.

## Key facts
- Theme: `<html data-theme>`, tokens in `web/src/dark.css`, localStorage `formeasy.theme`.
- OCR: Tesseract (needs `configs/` in TESSDATA_PREFIX copy). Results cached per page in `data/docs/<id>/ocr/*.json`; bump `OCR_VERSION` in `engine/ocr.py` to invalidate.
- Scan editing: `engine/scanedit.py` `edit_scan` draws a patch image over the scan. numpy only (no cv2/scipy). Steps: tilt estimate, auto font match, fit (condense, shrink, else error), erase old ink with inpainting, draw text.
- Shift+click selects several OCR words on one line (Viewer.tsx `handleWordClick`).

## Two modes: desktop vs hosted website
- Desktop (default, Electron): one user, owner `""`, SQLite + files under `PDFMASTER_DATA`, no sign-in, no expiry.
- Hosted (`PDFMASTER_MULTIUSER=1`): every document row has `owner`; `service.current_owner` (ContextVar) is set per request in `api.py` middleware from the `formeasy_sid` cookie: signed-in → `u:<user id>`, otherwise sha256 of the cookie. `service.get()` filters by owner, so every endpoint is scoped through it. Optional sign-in = email or mobile OTP (`auth.py`, endpoints `/auth/code`, `/auth/verify`, `/auth/logout`, `DELETE /auth/account`, `GET /session`); sign-in moves the browser's documents to the account.
- Storage: `storage.py` LocalStore / S3Store (`PDFMASTER_STORAGE=s3`); `db.py` SQLite / PostgreSQL (`PDFMASTER_DATABASE_URL`, `?` placeholders translated, literal `%` doubled). Version blobs `docs/<id>/v<n>-<random>.pdf`, name in `document_versions.storage_key`; OCR `docs/<id>/ocr/<page key>.json`.
- Deployment status, OTP provider setup (SMTP email; MSG91 / Twilio SMS), env vars and next steps: **`docs/DEPLOYMENT.md`** (start there for any "go live" work). Not yet done: real email / SMS test, Docker build, load test.

## Known limitations
- New text is slightly lighter than bold photographed text; faint smooth patch on grainy backgrounds.
- Long single-word replacements are refused (select following words too) instead of reflowing.
- Tilt handled by shear only.

## Change log (newest first; add a line after each task)
- Email sign-in: OTP by email as well as SMS (`auth.py` `normalize_login`/`mask_login`, `ConsoleEmailSender`, `SmtpSender` + `code_email`; `senders_from_env` needs `PDFMASTER_EMAIL` and/or `PDFMASTER_SMS`). Login (email lower-cased or +phone) stored in the existing `phone` columns, no migration. API takes `login` (old `phone` still accepted), returns `sentTo`/`kind`; session has `signIn` methods and `user {login, kind}`. Dialog: Email / Mobile number tabs (email first), spam-folder hint. `run_hosted.py` sets both to console; Dockerfile defaults to `PDFMASTER_EMAIL=smtp`. DEPLOYMENT.md section 2 = email providers (Brevo, Resend, SES, ZeptoMail, SPF/DKIM). Tests: 5 new in `test_auth.py`.
- Exam presets + name/date on photo: `requirements.ts` TEMPLATES now grouped presets (SSC, UPSC, IBPS/SBI/RBI incl. thumb + declaration, NTA NEET/JEE/CUET, RRB, PAN, General) with `note` and `nameDate`; choosing one turns limits on at once (also applied to the first uploaded picture). New "Name and date on photo" panel: white band at the bottom (`Art.stamp`, drawn in `render`, part of undo), name uppercased and remembered (`formeasy.stampName`), date defaults to today, photo refitted above the band; UPSC and NTA photos switch it on. Limits are commonly published values, UI says to check the notification.
- Photo & Signature download: format list now also has PDF (one page the picture's size, 96 px/in) and Word (picture at natural size, max text width); both wrap the JPEG in the browser (`web/src/wrap.ts`: tiny PDF writer + stored zip), so quality and "Set file size" work for them too.
- Download in other formats: Download dialog now has a Format picker (PDF, JPG, PNG, Word, Excel, Text) with page range and image quality (100/150/300 dpi). `GET /documents/{id}/convert?format=&pages=&dpi=` (`engine/convert.py`, `service.convert`); several pages of JPG/PNG come as a .zip; Word/Excel written as raw Office XML (no new deps); Excel finds columns from merged cell spans (right-aligned amounts line up) and stores amounts (also ₹/Rs prefixed) as numbers; un-OCR'd scan pages go into Word as pictures (`X-Pages-Without-Text` header, UI warns). Tests: `test_convert.py`.
- Scan edit on striped tables (price list, grey row): word box is >50% ink so `_ink_bool` now takes the paper from the strips beside the word (was mid-grey, so strokes came out thin/pale); `inpaint` fills row by row from the same row left/right of the hole first (band edge behind the word stayed smeared as a bluish halo); `ink_mask` only treats lighter-than-paper pixels as shadow when they hug the letters. Test: `test_erase_keeps_a_band_edge_that_runs_behind_the_word`.
- Scan edit bug (doc.pdf, small price digits drawn as thin bars): `rasterize` now loads glyphs with `FT_LOAD_NO_BITMAP`; Calibri/Arial 1-bit strikes at small sizes were read as 8-bit gray. Test: `test_small_text_is_rasterized_from_outlines_not_1bit_strikes`.
- Production prep: security headers middleware (hosted only), Dockerfile HEALTHCHECK + WEB_CONCURRENCY, `.dockerignore`, `backend/loadtest.py` (40 users, 0 errors locally). Still needs real SMS, Docker build, real deploy.
- Sign-in dialog now reads "Sign in or sign up" and says a new number creates the account automatically.
- Recently deleted: ✕ in Recent documents now sets `documents.deleted_at` (soft delete) and shows an 8 s Undo bar; collapsible "Recently deleted" list on PDF Studio with Restore and Delete forever (confirm dialog). API `GET /trash`, `POST /trash/{id}/restore`, `DELETE /trash/{id}`; trash erased after `PDFMASTER_TRASH_DAYS` (default 30, 0 = never) by the sweep thread, which now always runs. Tests: `test_delete_goes_to_trash_and_can_be_restored`, `test_trash_is_emptied_after_days`.
- Docs: `docs/DEPLOYMENT.md` (status table, OTP provider setup, server settings, next steps); README storage / layout / API / testing sections brought up to date; CLAUDE.md mode + launch-config notes.
- Accounts: optional mobile-number OTP sign-in (`auth.py`; users/sessions/otp_codes tables, keyed hashes, 30 s resend, 5 sends/h, 5 guesses counted atomically before compare); sign-in moves the browser's documents to owner `u:<id>`, new cookie value; sign-out, delete account (erases documents). `PDFMASTER_SMS` msg91/twilio/console, `PDFMASTER_ACCOUNT_RETENTION_DAYS`. Start-up refuses S3/Postgres without MULTIUSER, hosted mode without SMS, and `python -m pdfmaster` on a network host. UI: header Account menu + sign-in dialog, keep-note under the drop zone, real upload limit; Dialog now renders through a portal (blurred header trapped it). Local hosted test server: `run_hosted.py` / launch `pdfmaster-hosted` (port 8001). Test: `test_auth.py`.
- Hosted-website storage: `PDFMASTER_DATABASE_URL` (PostgreSQL), `PDFMASTER_STORAGE=s3` (+bucket/endpoint, SSE AES256), `PDFMASTER_MULTIUSER=1` (anonymous `formeasy_sid` cookie, documents scoped by hashed owner), `PDFMASTER_RETENTION_HOURS` sweep. Version blobs get random names (`storage_key`), old `v0.pdf` layout still read; commits guarded by `current_version` (Conflict instead of overwrite). Linux tessdata lookup; `backend/Dockerfile`, `requirements-server.txt`. Tests: `test_storage.py` (moto S3, pgserver Postgres).
- Release blockers: installer now builds and runs (PyInstaller `--collect-all numpy`, else the engine crashed at start; `signAndEditExecutable: false` since winCodeSign needs symlink rights). Tesseract exe/DLLs + eng/hin/osd models bundled into `resources/tesseract` (`build-server.js`), main.js sets `PDFMASTER_TESSERACT`. Upload limits: 200 MB per request/PDF (`PDFMASTER_MAX_UPLOAD_MB`), 40 MB per picture, 200 pictures; HTTPException returns `{message}`. Test: `test_upload_size_limit`.
- Sequential scan edits: patches now identify their scan by content hash (`PMPatch.Base = "sha1:…"`, old "num gen" still accepted) because saving renumbers objects; new patch drawn above any surviving one; dropped patches remove their q/cm/Q wrapper. One typeface per line (edited OCR words store `font`); regular vs bold chosen by least correction; `_body` uses 75th-percentile row (a '+' bar no longer inflates size); texture tiles without a clean source reuse the nearest found tile. Test: `test_edits_stay_on_top_after_objects_are_renumbered`.
- Banner / photo edits: other words' boxes are protected from erase growth (`protect`, `ink_mask(block=)`); fill gets real texture copied tile-by-tile from clean nearby background (`texture`); `_ink_bool` measures along the paper→ink direction so drop shadows aren't counted as letters; drop shadow detected and redrawn; bold cut tried when strokes need it (`_style` fixes match_font ignoring bold for names like "Tahoma"); new text starts at the old ink's left edge; shorter text pulls the rest of the line left.
- Scan edit sizing rewritten: old word re-rendered in the chosen font and measured like the scan (`_body` x-height band, `_scan_like` threshold) to set size, width, baseline (undoing unshear) and stroke weight (`_fit_weight`/`_reweight`). Identity edits match within ~0.1pt.
- Longer replacement (February→September) no longer shrinks: rest of the line slides right (needs room before page edge). Size now measured the same way for scan word and font probe; font match uses 240x48 fingerprints, local weight 0.85/page 0.15, page rank only from same-size lines.
- Header phone-number edit: overflow now condenses/shrinks then errors; grain estimate ignores bright specks; Editor banner mentions Shift+click.
- Scan edits: tilt-aware, typeface auto-match, consistent font per page, cleaner erase (inpaint, level shift, feathering).
- OCR fixed (tessdata configs, grayscale autocontrast, OCR_VERSION=2).
- Dark mode + hub / Photo & Signature / PDF editor visual polish.

## Working rules
- Keep replies short; verify with tests before claiming done.
- After finishing a task, append one line to the change log above.
