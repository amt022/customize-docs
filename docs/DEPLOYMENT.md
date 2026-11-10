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
| Docker image (`backend/Dockerfile`) | Written; built and health-checked by GitHub Actions (`.github/workflows/docker.yml`) on push, **not yet run there** |
| One-server deploy with Cloudflare Tunnel (`deploy/`) | Written (section 5), **not yet run on a real server** |
| Security headers (nosniff, no framing, HSTS over https), Docker HEALTHCHECK, `.dockerignore` | Done |
| Legal basics: Privacy Policy + Terms pages, consent checkbox at sign-in (version stored per user), grievance contact in the footer, forgery warning, 180-day access log | Done, tested. **Wording not yet checked by a lawyer** (section 4) |
| Load testing | Light test done on a dev PC (`backend/loadtest.py`: 40 people uploading and rendering at once, 0 errors, renders under 0.5 s). OCR-heavy and real-server (S3 + PostgreSQL) load not tested. Estimate: 20–40 people editing at once per 2-core server, 2 OCR jobs at a time per process |

Next steps, in order: email provider (section 2) → server + Cloudflare Tunnel (section 5) → load test.

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

## 5. Go live on one server with Cloudflare (cheapest setup, about ₹400–550 / month)

Everything is in `deploy/`: `docker-compose.yml` runs the app plus a **Cloudflare Tunnel**, so the server opens no
web ports, Cloudflare provides HTTPS / CDN / DDoS protection for free, and visitors' real IPs reach the rate limits
and access log (`PDFMASTER_CLIENT_IP_HEADER=cf-connecting-ip`). Database (SQLite) and documents live on the server's
disk in the `formeasy-data` volume, backed up nightly. No PostgreSQL or bucket needed at this size.

1. **Server.** Buy an Ubuntu 24.04 VPS with 2 CPUs / 4 GB RAM (Hetzner CX22 about €4–5, Hetzner Singapore is closest
   to India; or DigitalOcean / AWS Lightsail in Mumbai / Bangalore; Oracle Cloud "Always Free" ARM in Mumbai is
   free). Add your SSH key when creating it.
2. **Domain on Cloudflare.** Free Cloudflare account → *Add a domain* → change the nameservers at your registrar
   to the two Cloudflare gives you. (Buy a domain from Cloudflare Registrar if you have none.)
3. **Tunnel.** Cloudflare dashboard → *Zero Trust* → *Networks* → *Tunnels* → *Create a tunnel* → *Cloudflared* →
   name it `formeasy` → copy the **token** (the long string after `--token`). Skip the install step.
   Then *Public hostname*: subdomain empty or `www`, your domain, service **HTTP** `app:8000`.
4. **Install.** SSH into the server as root:
   ```bash
   git clone https://github.com/amt022/customize-docs.git /opt/formeasy
   bash /opt/formeasy/deploy/setup.sh          # installs Docker, swap, firewall, creates deploy/.env
   nano /opt/formeasy/deploy/.env              # tunnel token, operator + grievance details, SMTP (section 2)
   bash /opt/formeasy/deploy/setup.sh          # builds and starts; prints "health 200"
   ```
   (Private GitHub repo: clone with a personal access token, `https://<token>@github.com/...`.)
5. **Cloudflare settings** for the domain: *SSL/TLS* → Full; *SSL/TLS → Edge Certificates* → Always Use HTTPS on;
   Uploads above 100 MB are
   blocked by Cloudflare's free plan, so set `PDFMASTER_MAX_UPLOAD_MB=95` in `.env`.
6. **Check:** open the site, upload a PDF, sign in with your own email, look at `docker compose logs app` and
   `/var/lib/docker/volumes/deploy_formeasy-data/_data/logs`.

Day to day (in `/opt/formeasy/deploy`): `bash update.sh` after pushing new code; `docker compose logs -f app`;
backups in `/var/backups/formeasy` (7 days, copy them off the server now and then). The GitHub workflow
`.github/workflows/docker.yml` builds the image and checks `/health` on every push.

Growing later: move documents to Cloudflare R2 (`PDFMASTER_STORAGE=s3` lines in `.env.example`, 10 GB free) and the
database to Neon / Supabase PostgreSQL, then run several servers behind the same tunnel.

### 5b. Free version (₹0 / month)

Same steps, with an **Oracle Cloud "Always Free"** server instead of a paid one; Cloudflare (tunnel, HTTPS) and Brevo
(300 emails / day) are free anyway. The only cost is a domain (about ₹100–900 / year); a temporary random
`*.trycloudflare.com` address is possible for testing but changes on every restart.

- Sign up at oracle.com/cloud/free, home region **India West (Mumbai)** or **India South (Hyderabad)** (cannot be
  changed later). A card is needed for verification; nothing is charged within the free limits.
- Create instance: image **Ubuntu 24.04**, shape **Ampere A1 (VM.Standard.A1.Flex), 2 OCPU / 12 GB** (free up to
  4 OCPU / 24 GB), upload your SSH public key. "Out of capacity" → try another availability domain or later.
- Log in as `ubuntu` (not root): `ssh ubuntu@IP`, then `sudo git clone ...` and `sudo bash .../setup.sh`.
  `setup.sh` keeps Oracle's own firewall rules (Oracle warns against ufw); no ingress rule is needed for the tunnel.
- Oracle may reclaim Always Free servers that stay almost idle for 7 days. Upgrading the account to
  *Pay As You Go* (still ₹0 within the free limits) stops that; set a budget alert at ₹1 to be safe.

## 6. Free on Render (no server to manage)

`render.yaml` (repo root) is a Render Blueprint that builds `backend/Dockerfile`. Render's free web service has
512 MB, sleeps after 15 minutes without visitors (first visit then takes about a minute) and loses its disk on every
restart, so documents go to **Cloudflare R2** and the database to **Neon PostgreSQL** (both free tiers).

1. **Neon** (neon.tech, sign in with GitHub): new project `formeasy`, region Singapore. Copy the connection string
   (`postgresql://…?sslmode=require`).
2. **Cloudflare R2**: dashboard → R2 Object Storage (needs a payment method on file; 10 GB stays free) → Create bucket
   `formeasy-docs` (location hint Asia-Pacific). Then *Manage API tokens* → Create token, permission
   *Object Read & Write*, only that bucket → copy the Access Key ID and Secret Access Key.
   Endpoint: `https://<Cloudflare account id>.r2.cloudflarestorage.com`.
3. **Render** (render.com, sign in with GitHub): New → Blueprint → this repository → fill in the asked values
   (database URL, R2 endpoint + keys, operator / grievance details) → Apply. First build ~10 minutes; check
   `https://formeasy.onrender.com/api/v1/health`.
4. **Domain**: Render service → Settings → Custom Domains → add `formeasy.in` and `www.formeasy.in`. In Cloudflare DNS,
   set both `@` and `www` to CNAME `formeasy.onrender.com`, **DNS only** (grey cloud) until Render shows the
   certificate as issued; SSL/TLS mode Full.
5. **Email**: when Brevo is ready, change `PDFMASTER_EMAIL` to `smtp` and fill `SMTP_USER` / `SMTP_PASSWORD` in the
   Render Environment tab (codes are printed in the Render log while it is `console`).

Limits: access logs live in the container's `/tmp` and are lost on restart (CERT-In asks for 180 days; a paid
instance with a disk, or the server setup in section 5, keeps them); large OCR jobs may run out of memory on 512 MB.
