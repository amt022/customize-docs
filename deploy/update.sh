#!/usr/bin/env bash
# Pull the latest code and restart: bash /opt/formeasy/deploy/update.sh
set -euo pipefail
cd /opt/formeasy
git pull --ff-only
cd deploy
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
