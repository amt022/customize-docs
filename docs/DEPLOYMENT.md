# Putting FormEasy online (hosted website)

The desktop app needs none of this: it keeps everything on the user's PC. This guide is for running FormEasy as a
public website where many people use one server.

## Where things stand (Nov 2026)

| Piece | Status |
|---|---|
| Per-browser private documents (`PDFMASTER_MULTIUSER=1`) | Done, tested |
| Email or mobile number + OTP sign-in, sign-out, delete account | Done, tested with codes printed to the log (`PDFMASTER_EMAIL=console`, `PDFMASTER_SMS=console`) |
| PostgreSQL metadata (`PDFMASTER_DATABASE_URL`) | Done, tested against a real PostgreSQL (pgserver) |
| S3 / R2 / B2 file storage (`PDFMASTER_STORAGE=s3`) | Done, tested against a simulated S3 (moto) |
| Auto-delete of idle documents | Done, tested |
| Start-up safety checks | Done, tested |
| Real email sending (SMTP: Brevo, Resend, SES, Zoho…) | Code written and tested against a fake SMTP server, **not yet tried with a real account** |
| Real SMS sending (MSG91 / Twilio) | Optional. Code written, **not yet tried with a real account** |
| Docker image (`backend/Dockerfile`) | Written, **never built** (no Docker on the dev machine) |
| Security headers (nosniff, no framing, HSTS over https), Docker HEALTHCHECK, `.dockerignore` | Done |
| Legal basics: Privacy Policy + Terms pages, consent checkbox at sign-in (version stored per user), grievance contact in the footer, forgery warning, 180-day access log | Done, tested. **Wording not yet checked by a lawyer** (section 4) |
| Load testing | Light test done on a dev PC (`backend/loadtest.py`: 40 people uploading and rendering at once, 0 errors, renders under 0.5 s). OCR-heavy and real-server (S3 + PostgreSQL) load not tested. Estimate: 20–40 people editing at once per 2-core server, 2 OCR jobs at a time per process |

Next steps, in order: email provider (section 2) → build the Docker image → database + bucket → deploy behind HTTPS →
load test.

## 1. Try hosted mode on your own PC

```bash
cd backend
./.venv/Scripts/python.exe run_hosted.py        # http://127.0.0.1:8001
```

- Uses its own folder `backend/data-hosted`, so desktop documents are not touched.
- Sign-in codes are not emailed or texted: they appear in this terminal as `OTP for you@example.com is 123456`.
- Use two different browsers (or one Incognito window) to see two separate users. Two tabs of one browser are the
  same user.
- In Claude Code the same server is the launch configuration `pdfmaster-hosted`. The app may stop it after a while;
  start it again if the page says "This site can't be reached".

## 2. Set up the email provider (recommended way to sign in)

The server sends a 6-digit code by email or SMS. Nothing else about sign-in needs setting up: the first sign-in with
an address or number creates the account, so there is no separate sign-up. Set at least one of `PDFMASTER_EMAIL`
and `PDFMASTER_SMS`; the sign-in dialog shows a tab for each one that is set (email first).

Email is the easiest start: no DLT registration, free or nearly free, and every exam applicant already has an
address. Any provider that offers SMTP works:

| Provider | Free tier (Nov 2026, check their site) | SMTP host |
|---|---|---|
| Brevo | 300 emails / day | `smtp-relay.brevo.com` |
| Resend | 3,000 emails / month | `smtp.resend.com` (user `resend`, password = API key) |
| Amazon SES | ~₹8 per 1,000 after the free tier | `email-smtp.ap-south-1.amazonaws.com` |
| Zoho ZeptoMail | pay as you go | `smtp.zeptomail.in` |

1. Create an account with the provider.
2. **Verify your sending domain** (for example `formeasy.in`): the provider gives you SPF and DKIM DNS records to add
   at your domain registrar. Without them, codes land in spam. Also add a DMARC record
   (`v=DMARC1; p=none;`) if the provider suggests one.
3. Create SMTP credentials (user name + password or API key).
4. Settings on the server:
   ```
   PDFMASTER_EMAIL=smtp
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587                         # default; 465 with SMTP_SECURITY=ssl
   SMTP_SECURITY=starttls                # starttls (default), ssl or none
   SMTP_USER=<smtp user>
   SMTP_PASSWORD=<smtp password / API key>
   SMTP_FROM=FormEasy <no-reply@formeasy.in>
   ```
5. Test from your PC (below) with your own address, and check that the email arrives in the inbox, not spam.

The email's subject is `123456 is your FormEasy sign-in code` and it has a plain-text and an HTML part (see
`code_email` in `backend/pdfmaster/auth.py`).

## 2b. Optional: SMS provider (sign in with a mobile number)

### Option A: MSG91 (recommended for Indian numbers)

Indian law (TRAI) requires every business SMS to use a registered sender name and template ("DLT"). Plan a few
days for approval.

1. **DLT registration.** Register your business as a *Principal Entity* on a DLT portal (Jio, Airtel, Vodafone Idea
   "Vilpower", BSNL; any one works for all operators). You need PAN / GST or company documents.
2. **Sender ID (header).** On the DLT portal, register a 6-letter sender ID, for example `FRMESY`.
3. **Content template.** Register a *Service Implicit* (OTP) template, for example
   `{#var#} is your FormEasy sign-in code. It expires in 10 minutes.`
   Note the DLT template ID you get.
4. **MSG91 account.** Sign up at msg91.com and finish their verification. Add the sender ID and your DLT
   entity ID there.
5. **MSG91 template.** Create an SMS template in MSG91 with the same text, writing the variable as `##otp##`
   (the server fills a variable named `otp`), and link it to the DLT template ID. Copy MSG91's **template ID**.
6. **Auth key.** In MSG91, create an API auth key.
7. **Settings** on the server:
   ```
   PDFMASTER_SMS=msg91
   MSG91_AUTH_KEY=<auth key>
   MSG91_TEMPLATE_ID=<MSG91 template id>
   ```

The server calls `POST https://control.msg91.com/api/v5/flow/` with
`{"template_id": …, "recipients": [{"mobiles": "919876543210", "otp": "123456"}]}` (see `Msg91Sender` in
`backend/pdfmaster/auth.py`). If MSG91 changes its API, that class is the only place to update.

### Option B: Twilio (quick to start, good for non-Indian numbers)

1. Sign up at twilio.com and buy a phone number (or use the trial number; a trial can only text numbers you have
   verified).
2. Copy the Account SID and Auth Token from the console.
3. Settings:
   ```
   PDFMASTER_SMS=twilio
   TWILIO_ACCOUNT_SID=<AC…>
   TWILIO_AUTH_TOKEN=<token>
   TWILIO_FROM=<+1… your Twilio number>
   ```
   Texts to Indian numbers through Twilio are also subject to DLT rules, so for an Indian audience MSG91 is simpler.

### Test the provider before going live

The local server reads the same settings, so you can send yourself a real code from your PC:

```bash
cd backend
PDFMASTER_EMAIL=smtp SMTP_HOST=... SMTP_USER=... SMTP_PASSWORD=... SMTP_FROM=... ./.venv/Scripts/python.exe run_hosted.py
PDFMASTER_SMS=msg91 MSG91_AUTH_KEY=... MSG91_TEMPLATE_ID=... ./.venv/Scripts/python.exe run_hosted.py
```

Open http://127.0.0.1:8001, click **Sign in**, enter your own address or number. If sending fails the page says
"Could not send the code by email" (or SMS) and the terminal shows the provider's error.

### Limits built in (in `auth.py`)

| Rule | Value |
|---|---|
| Code length / lifetime | 6 digits / 10 minutes, single use |
| Wait before resending | 30 seconds |
| Codes per address / number | 5 per hour |
| Wrong guesses per code | 5 |
| Codes per network address | 20 per hour |
| Sign-in lasts | 30 days |

## 3. Everything else the server needs

```
PDFMASTER_MULTIUSER=1
PDFMASTER_RETENTION_HOURS=24                  # files of people who did not sign in
PDFMASTER_ACCOUNT_RETENTION_DAYS=0            # 0 = signed-in users keep files until they delete them
PDFMASTER_TRASH_DAYS=30                       # "Recently deleted" is erased after this (0 = never)
PDFMASTER_SECRET=<64 random hex characters>   # same value on every server
PDFMASTER_DATABASE_URL=postgresql://user:pass@host:5432/formeasy
PDFMASTER_STORAGE=s3
PDFMASTER_S3_BUCKET=formeasy-docs
PDFMASTER_S3_REGION=ap-south-1                # or PDFMASTER_S3_ENDPOINT for Cloudflare R2 / Backblaze B2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
PDFMASTER_EMAIL=smtp (+ SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM)
PDFMASTER_SMS=msg91  (optional; + MSG91_AUTH_KEY, MSG91_TEMPLATE_ID)
ANTHROPIC_API_KEY=...                         # optional, enables the AI assistant
PDFMASTER_OPERATOR=Ashish Tripathi           # required: who runs the site (shown on Privacy / Terms)
PDFMASTER_GRIEVANCE_EMAIL=grievance@formeasy.in   # required: grievance officer (IT Rules 2021, DPDP Act)
PDFMASTER_GRIEVANCE_NAME=Ashish Tripathi
PDFMASTER_ADDRESS=<postal address>
PDFMASTER_DATA_REGION=India (AWS Mumbai, ap-south-1)
PDFMASTER_LOG_DIR=/data/logs                  # persistent disk; access logs kept PDFMASTER_LOG_DAYS (180)
```

Make a secret with `python -c "import secrets; print(secrets.token_hex(32))"`.

- **Database:** any managed PostgreSQL (Supabase, Neon, AWS RDS). Tables are created on first start.
- **Files:** an S3-compatible bucket, ideally in an Indian region. Keep it private; the server reads and writes it
  with the keys above.
- **HTTPS is required:** the session cookie is marked Secure, so sign-in does not work over plain http (except
  `run_hosted.py`, which turns that off for local testing).
- **Build and run:** from the project root, `docker build -f backend/Dockerfile -t formeasy .`, then run the image
  with the settings above on any container host (Render, Railway, Fly.io, AWS App Runner, a VPS). The image
  includes the web UI and Tesseract (English + Hindi).
- **More capacity:** add `--workers N` (N = CPU cores) to the `uvicorn` command in the Dockerfile, or run several
  copies behind a load balancer with sticky sessions (AI chats are kept in each server's memory). Keep
  workers × 10 below PostgreSQL's connection limit.

The server refuses to start if PostgreSQL / S3 is set without `PDFMASTER_MULTIUSER=1`, or if hosted mode has neither
`PDFMASTER_EMAIL` nor `PDFMASTER_SMS`, or (with HTTPS cookies on) without `PDFMASTER_OPERATOR` and
`PDFMASTER_GRIEVANCE_EMAIL`, so all visitors can never end up sharing one document list.

## 3b. Legal (India)

Built in (`backend/pdfmaster/legal.py`, `web/src/components/Legal.tsx`):

| Rule | What the site does |
|---|---|
| DPDP Act 2023 / Rules 2025: notice and consent | Privacy Policy page (`#privacy`); sign-in needs a ticked "I agree… I am 18 or older, or my parent / guardian agrees" box; the version agreed (`legal.TERMS_VERSION`) and time are stored in `users.terms_version` / `terms_accepted_at`. Bump `TERMS_VERSION` when the pages change in substance |
| DPDP: erasure, withdrawal, retention | Delete document / Delete account; automatic deletion times are shown on the Privacy page from the server settings |
| DPDP: children | Policy and checkbox ask for parent / guardian agreement under 18. No tracking or ads |
| IT Rules 2021: grievance officer, terms | Footer on every home page shows Privacy Policy, Terms of Use and the grievance officer; Terms forbid forgery and impersonation |
| CERT-In directions 2022: logs for 180 days | Daily `access.log` files in `PDFMASTER_LOG_DIR` (default `<data>/logs`), kept `PDFMASTER_LOG_DAYS` (180): time (UTC), IP, pseudonymous account / browser id, request, status; sign-in and account deletion events. No emails, numbers or file names. In Docker put the folder on a persistent disk (the default `/tmp` is lost on restart) |
| Forgery risk (Bharatiya Nyaya Sanhita ss. 336–340) | Terms forbid it; the scan editor shows a warning; edited scan areas carry a `/PMPatch` marker inside the PDF |

Still your job before launch:

- Have a lawyer read the Privacy Policy and Terms wording (it is a sensible starting point, not legal advice).
- Use an Indian region for the database and bucket, and set `PDFMASTER_DATA_REGION` to match.
- CERT-In also asks for clocks synced to NTP (cloud servers do this by default) and for cyber incidents to be
  reported to CERT-In within 6 hours (incident@cert-in.org.in). Keep a short written plan for who does that.
- SMS sign-in only: register the sender ID and template on DLT (section 2b).
- If you ever charge money: GST registration and a refund policy page.

## 4. Still to do

- Send one real email code (section 2), optionally one real SMS (2b), and build the Docker image once.
- Fill in the operator / grievance settings and get the legal pages reviewed (section 3b).
- Re-run `python loadtest.py https://your-site 40` against the real deployment (S3 + PostgreSQL) before launch.
- Optional: Google sign-in; moving OCR to a separate job queue so long OCR jobs do not slow editing.
