#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 22.04 / 24.04 server (run as root):
#   curl -fsSL https://raw.githubusercontent.com/amt022/customize-docs/main/deploy/setup.sh -o setup.sh && bash setup.sh
# Private repo? Clone it yourself into /opt/formeasy first, then run: bash /opt/formeasy/deploy/setup.sh
set -euo pipefail

REPO="${REPO:-https://github.com/amt022/customize-docs.git}"
DIR=/opt/formeasy

echo "== Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "== Swap (OCR + PDF work can spike memory on a 2-4 GB server)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Firewall: only SSH in (the website comes in through the Cloudflare Tunnel, which dials out)"
# Oracle Cloud images ship their own iptables rules (SSH only) and Oracle warns that ufw can break them; keep theirs.
if [ -f /etc/iptables/rules.v4 ] && grep -qi "InstanceServices\|169.254" /etc/iptables/rules.v4; then
  echo "Oracle Cloud firewall rules found, leaving them as they are"
elif command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null && ufw --force enable >/dev/null
fi

echo "== Automatic security updates"
apt-get install -y unattended-upgrades >/dev/null && dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo "== Code"
if [ ! -d "$DIR/.git" ]; then
  git clone "$REPO" "$DIR"
fi
cd "$DIR/deploy"

if [ ! -f .env ]; then
  cp .env.example .env
  secret=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  sed -i "s/^PDFMASTER_SECRET=$/PDFMASTER_SECRET=$secret/" .env
  chmod 600 .env
  echo
  echo "Created $DIR/deploy/.env (with a random PDFMASTER_SECRET)."
  echo "Fill in CLOUDFLARE_TUNNEL_TOKEN, operator / grievance details and SMTP settings:"
  echo "    nano $DIR/deploy/.env"
  echo "then run:  bash $DIR/deploy/setup.sh   again."
  exit 0
fi

echo "== Nightly backup at 03:30"
cat > /etc/cron.d/formeasy-backup <<EOF
30 3 * * * root bash $DIR/deploy/backup.sh >> /var/log/formeasy-backup.log 2>&1
EOF

echo "== Build and start (first build takes 5-10 minutes)"
docker compose up -d --build
sleep 20
docker compose ps
docker compose exec -T app python -c "import urllib.request as u; print('health', u.urlopen('http://127.0.0.1:8000/api/v1/health').status)"
echo
echo "Done. Open your site's address (the public hostname set on the tunnel)."
echo "Update later with:  bash $DIR/deploy/update.sh"
