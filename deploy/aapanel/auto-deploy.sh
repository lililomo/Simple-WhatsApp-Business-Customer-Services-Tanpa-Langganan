#!/usr/bin/env bash
# Auto-deploy dari GitHub ke Node project aaPanel.
# Dijalankan cron aaPanel "WA Inbox – Auto deploy". Konfigurasi per server ada di
# <APP_DIR>/.deploy.env (tidak di-commit, contoh: deploy/aapanel/deploy.env.example).
#
#   bash deploy/aapanel/auto-deploy.sh            deploy hanya jika ada commit baru
#   bash deploy/aapanel/auto-deploy.sh --force    build & restart ulang commit sekarang
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Jalankan dari salinan sementara supaya git merge tidak mengubah skrip yang sedang dibaca bash.
if [[ "${WA_DEPLOY_COPY:-}" != 1 ]]; then
  tmp="$(mktemp /tmp/wa-auto-deploy.XXXXXX)"
  cp "${BASH_SOURCE[0]}" "$tmp"
  WA_DEPLOY_COPY=1 APP_DIR="$APP_DIR" exec bash "$tmp" "$@"
fi
trap 'rm -f "$0"' EXIT

# shellcheck source=/dev/null
source "$APP_DIR/.deploy.env"
: "${PROJECT_NAME:?PROJECT_NAME belum diisi di .deploy.env}"
: "${NODE_DIR:?NODE_DIR belum diisi di .deploy.env}"
: "${HEALTH_URL:?HEALTH_URL belum diisi di .deploy.env}"
BRANCH="${BRANCH:-main}"
RUN_USER="${RUN_USER:-www}"
LOG="${DEPLOY_LOG:-/www/wwwlogs/${PROJECT_NAME}-deploy.log}"
export PATH="$NODE_DIR:$PATH"

exec 9>"/tmp/${PROJECT_NAME}-deploy.lock"
flock -n 9 || exit 0

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
has_script() { [[ -f package.json ]] && node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)"; }

# npm & build dijalankan sebagai user aplikasi, bukan root, agar kepemilikan file konsisten.
APP_HOME="/tmp/${PROJECT_NAME}-home"
mkdir -p "$APP_HOME" && chown "$RUN_USER:$RUN_USER" "$APP_HOME"
as_app() { runuser -u "$RUN_USER" -- env PATH="$PATH" HOME="$APP_HOME" "$@"; }

build_and_restart() {
  chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"
  if has_script build; then
    as_app npm ci --no-audit --no-fund >>"$LOG" 2>&1
    as_app npm run build >>"$LOG" 2>&1
  fi
  # db:migrate wajib membaca .env sendiri (mis. node --env-file=.env server/dist/cli.js db:migrate).
  if has_script db:migrate; then
    as_app npm run db:migrate >>"$LOG" 2>&1
  fi
  bash "$APP_DIR/deploy/aapanel/restart.sh" "$PROJECT_NAME" >>"$LOG" 2>&1
  for _ in $(seq 1 20); do
    sleep 2
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
  done
  log "Healthcheck gagal: $HEALTH_URL"
  return 1
}

cd "$APP_DIR"
git fetch --quiet origin "$BRANCH"
before="$(git rev-parse HEAD)"
target="$(git rev-parse "origin/$BRANCH")"
if [[ "$before" == "$target" && "${1:-}" != "--force" ]]; then
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  log "BATAL: folder produksi punya perubahan yang belum di-commit. Folder ini hanya boleh menerima pull."
  git status --porcelain >>"$LOG"
  exit 1
fi

log "Deploy ${before:0:7} -> ${target:0:7}"
if ! git merge --ff-only --quiet "origin/$BRANCH" >>"$LOG" 2>&1; then
  log "BATAL: origin/$BRANCH tidak bisa fast-forward dari ${before:0:7} (riwayat ditulis ulang?)."
  exit 1
fi

if build_and_restart; then
  log "OK ${target:0:7}"
else
  log "GAGAL di ${target:0:7}, rollback ke ${before:0:7}"
  git reset --hard --quiet "$before"
  if build_and_restart; then
    log "Rollback selesai, produksi kembali ke ${before:0:7}"
  else
    log "ROLLBACK GAGAL: cek manual"
  fi
  exit 1
fi
