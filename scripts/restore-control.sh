#!/usr/bin/env bash
# Restore mercata_control from a vault backup.
#
# Usage:
#   ./scripts/restore-control.sh /mnt/vault/backups/control/mysql/mercata_control_YYYY-mm-dd_HHMMSS.sql.gz \
#       [/mnt/vault/backups/control/invoices/invoices_YYYY-mm-dd_HHMMSS.tar.gz]
#
# Optional env:
#   DRY_RUN=1
#   RESTORE_DB_NAME=…   (default: mercata_control)
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

CONTROL_DIR="${CONTROL_DIR:-/home/matthew/caesar/control}"
DUMP="${1:?Usage: restore-control.sh <dump.sql.gz> [invoices.tar.gz]}"
INVOICES_TAR="${2:-}"
RESTORE_DB_NAME="${RESTORE_DB_NAME:-mercata_control}"
DRY_RUN="${DRY_RUN:-0}"

if [[ ! -f "$DUMP" ]]; then
  echo "ERROR: dump not found: $DUMP" >&2
  exit 1
fi

cd "$CONTROL_DIR"
# shellcheck disable=SC1091
set -a
# shellcheck source=/dev/null
source <(grep -E '^(MYSQL_ROOT_PASSWORD|MYSQL_PASSWORD)=' .env | sed 's/\r$//')
set +a
: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD not set in .env}"

mysql_root() {
  docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mercata_control_db \
    mysql -uroot "$@"
}

echo "Restoring DB → ${RESTORE_DB_NAME} from $(basename "$DUMP")"

if [[ "$RESTORE_DB_NAME" == "mercata_control" && "$DRY_RUN" != "1" ]]; then
  echo "WARNING: This overwrites the live mercata_control database."
  echo "Press Ctrl-C within 5s to abort…"
  sleep 5
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY  create/load ${RESTORE_DB_NAME}"
else
  if [[ "$RESTORE_DB_NAME" != "mercata_control" ]]; then
    mysql_root -e "DROP DATABASE IF EXISTS \`${RESTORE_DB_NAME}\`; CREATE DATABASE \`${RESTORE_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  else
    mysql_root -e "CREATE DATABASE IF NOT EXISTS \`${RESTORE_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  fi
  gzip -dc "$DUMP" | mysql_root "$RESTORE_DB_NAME"
fi

if [[ -n "$INVOICES_TAR" ]]; then
  if [[ ! -f "$INVOICES_TAR" ]]; then
    echo "ERROR: invoices archive not found: $INVOICES_TAR" >&2
    exit 1
  fi
  echo "Restoring invoices from $(basename "$INVOICES_TAR")"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY  extract invoices into mercata_admin:/app/storage"
  else
    docker compose exec -T mercata_admin sh -c \
      'mkdir -p /app/storage/invoices && find /app/storage/invoices -mindepth 1 -delete'
    docker compose exec -T mercata_admin tar xzf - -C /app/storage < "$INVOICES_TAR"
  fi
fi

echo "Restore finished → ${RESTORE_DB_NAME}"
