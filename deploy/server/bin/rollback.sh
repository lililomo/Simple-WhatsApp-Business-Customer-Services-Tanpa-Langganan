#!/usr/bin/env bash
# Mengarahkan symlink app ke release sebelumnya, lalu restart lewat aaPanel dan healthcheck.
# Jika release sebelumnya tidak sehat, kembali lagi ke release semula.
#   bash /www/wwwroot/wa.kppbwi.app/bin/rollback.sh
set -uo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="${PROJECT_NAME:-wa_kppbwi_app}"
PORT="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$APP_DIR/.env" | head -1)"
LOG="${DEPLOY_LOG:-/www/wwwlogs/${PROJECT_NAME}-deploy.log}"
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

exec 9>"/tmp/${PROJECT_NAME}-deploy.lock"
flock -n 9 || { echo "Deploy lain sedang berjalan."; exit 1; }

switch_to() {
  ln -sfn "releases/$1" "$APP_DIR/app.new" && mv -Tf "$APP_DIR/app.new" "$APP_DIR/app" || return 1
  bash "$APP_DIR/bin/restart.sh" "$PROJECT_NAME" >/dev/null 2>&1 9>&- || return 1
  for _ in $(seq 1 20); do
    sleep 2
    curl -fsS --max-time 3 "http://127.0.0.1:${PORT:-3210}/healthz" 2>/dev/null | grep -q "\"version\":\"${1##*-}" && return 0
  done
  return 1
}

current="$(basename "$(readlink "$APP_DIR/app")")"
target="$(ls -1 "$APP_DIR/releases" | sort -r | awk -v cur="$current" 'found { print; exit } $0 == cur { found = 1 }')"
if [[ -z "$target" ]]; then
  log "Rollback dibatalkan: tidak ada release sebelum $current"
  exit 1
fi

log "Rollback $current -> $target"
if switch_to "$target"; then
  log "Rollback OK: $target"
  exit 0
fi
log "Rollback: $target tidak sehat, kembali ke $current"
switch_to "$current" && log "Kembali ke $current" || log "GAGAL kembali ke $current: cek manual"
exit 1
