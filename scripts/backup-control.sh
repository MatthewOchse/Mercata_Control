#!/usr/bin/env bash
# Nightly backup of mercata_control DB + invoice PDFs.
# Destination: /mnt/vault/backups/control/  Retention: 30 days.
#
# Cron (on caesar, as matthew):
#   15 2 * * * /home/matthew/caesar/control/scripts/backup-control.sh >> /home/matthew/caesar/control/backup.log 2>&1
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

CONTROL_DIR="${CONTROL_DIR:-/home/matthew/caesar/control}"
BACKUP_ROOT="/mnt/vault/backups/control"
RETENTION_DAYS=30
STAMP="$(date +%Y-%m-%d_%H%M%S)"

if ! mountpoint -q /mnt/vault; then
  echo "ERROR: /mnt/vault not mounted — aborting." >&2
  exit 1
fi

mkdir -p "$BACKUP_ROOT/mysql" "$BACKUP_ROOT/invoices"
chmod 700 "$BACKUP_ROOT" "$BACKUP_ROOT/mysql" "$BACKUP_ROOT/invoices"

cd "$CONTROL_DIR"

# Load root password from .env without sourcing the whole file into the shell env blindly
if [[ ! -f .env ]]; then
  echo "ERROR: $CONTROL_DIR/.env missing" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a
# shellcheck source=/dev/null
source <(grep -E '^(MYSQL_ROOT_PASSWORD|MYSQL_PASSWORD)=' .env | sed 's/\r$//')
set +a

: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD not set in .env}"

db_out="$BACKUP_ROOT/mysql/mercata_control_${STAMP}.sql.gz"
if docker compose exec -T mercata_control_db \
  mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" \
    --single-transaction --routines --triggers --no-tablespaces \
    mercata_control \
  | gzip > "$db_out" && [[ -s "$db_out" ]]; then
  echo "OK   db   $(basename "$db_out") ($(du -h "$db_out" | cut -f1))"
else
  echo "ERROR db dump failed" >&2
  rm -f "$db_out"
  exit 1
fi

inv_out="$BACKUP_ROOT/invoices/invoices_${STAMP}.tar.gz"
# Volume is mounted at /app/storage/invoices in mercata_admin
if docker compose exec -T mercata_admin \
  tar czf - -C /app/storage invoices 2>/dev/null \
  | cat > "$inv_out" && [[ -s "$inv_out" ]]; then
  echo "OK   inv  $(basename "$inv_out") ($(du -h "$inv_out" | cut -f1))"
else
  # Empty tree is still a valid backup — write an empty tar
  tar czf "$inv_out" --files-from /dev/null
  echo "OK   inv  $(basename "$inv_out") (empty tree)"
fi

find "$BACKUP_ROOT/mysql" -name 'mercata_control_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_ROOT/invoices" -name 'invoices_*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "Backup finished: $STAMP"
