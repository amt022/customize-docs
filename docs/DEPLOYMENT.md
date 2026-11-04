# Putting FormEasy online (hosted website)

The desktop app needs none of this: it keeps everything on the user's PC. This guide is for running FormEasy as a
public website where many people use one server.

## Where things stand (Nov 2026)

| Piece | Status |
|---|---|
| Per-browser private documents (`PDFMASTER_MULTIUSER=1`) | Done, tested |
| Mobile number + OTP sign-in, sign-out, delete account | Done, tested with codes printed to the log (`PDFMASTER_SMS=console`) |
| PostgreSQL metadata (`PDFMASTER_DATABASE_URL`) | Done, tested against a real PostgreSQL (pgserver) |
| S3 / R2 / B2 file storage (`PDFMASTER_STORAGE=s3`) | Done, tested against a simulated S3 (moto) |
| Auto-delete of idle documents | Done, tested |
| Start-up safety checks | Done, tested |
| Real SMS sending (MSG91 / Twilio) | Code written, **not yet tried with a real account** |
| Docker image (`backend/Dockerfile`) | Written, **never built** (no Docker on the dev machine) |
| Load testing | **Not done.** Rough estimate: 20–40 people editing at once per 2-core server, 2 OCR jobs at a time per process |

Next steps, in order: SMS provider (below) → build the Docker image → database + bucket → deploy behind HTTPS →
load test.

## 1. Try hosted mode on your own PC

```bash
cd backend
./.venv/Scripts/python.exe run_hosted.py        # http://127.0.0.1:8001
```

- Uses its own folder `backend/data-hosted`, so desktop documents are not touched.
- Sign-in codes are not texted: they appear in this terminal as `OTP for +919876543210 is 123456`.
- Use two different browsers (or one Incognito window) to see two separate users. Two tabs of one browser are the
  same user.
- In Claude Code the same server is the launch configuration `pdfmaster-hosted`. The app may stop it after a while;
  start it again if the page says "This site can't be reached".

## 2. Set up the OTP (SMS) provider

The server sends a 6-digit code by SMS. Nothing else about sign-in needs setting up: the first sign-in with a number
creates the account, so there is no separate sign-up.

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
PDFMASTER_SMS=msg91 MSG91_AUTH_KEY=... MSG91_TEMPLATE_ID=... ./.venv/Scripts/python.exe run_hosted.py
```

Open http://127.0.0.1:8001, click **Sign in**, enter your own number. If sending fails the page says "Could not send
the code by SMS" and the terminal shows the provider's error.

### Limits built in (in `auth.py`)

| Rule | Value |
|---|---|
| Code length / lifetime | 6 digits / 10 minutes, single use |
| Wait before resending | 30 seconds |
| Codes per number | 5 per hour |
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
PDFMASTER_SMS=msg91  (+ MSG91_AUTH_KEY, MSG91_TEMPLATE_ID)
ANTHROPIC_API_KEY=...                         # optional, enables the AI assistant
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

The server refuses to start if PostgreSQL / S3 is set without `PDFMASTER_MULTIUSER=1`, or if hosted mode has no
`PDFMASTER_SMS`, so all visitors can never end up sharing one document list.

## 4. Still to do

- Run real SMS once (section 2) and build the Docker image once.
- Load test (many simulated users uploading, rendering, editing) to replace the estimate above.
- Optional: Google sign-in; moving OCR to a separate job queue so long OCR jobs do not slow editing.
