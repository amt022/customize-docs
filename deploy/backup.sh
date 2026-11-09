#!/usr/bin/env bash
# Nightly copy of the database + documents (+ access logs) into /var/backups/formeasy, keeping 7 days.
# Installed as a cron job by setup.sh. Copy the folder off the server too (or to R2) for real safety.
set -euo pipefail
cd /opt/formeasy/deploy
OUT=/var/backups/formeasy
mkdir -p "$OUT"
stamp=$(date +%F)

# consistent SQLite copy while the app keeps running
docker compose exec -T app python -c "
import sqlite3
src = sqlite3.connect('/data/pdfmaster.db'); dst = sqlite3.connect('/data/backup.db')
src.backup(dst); dst.close(); src.close()"

volume=$(docker volume ls -q | grep 'formeasy-data$' | head -1)
docker run --rm -v "$volume":/data:ro -v "$OUT":/out alpine \
  tar czf "/out/formeasy-$stamp.tgz" -C /data --exclude=./pdfmaster.db --exclude=./pdfmaster.db-wal --exclude=./pdfmaster.db-shm .
docker compose exec -T app rm -f /data/backup.db

find "$OUT" -name 'formeasy-*.tgz' -mtime +7 -delete
echo "$(date) backup ok: $OUT/formeasy-$stamp.tgz"
