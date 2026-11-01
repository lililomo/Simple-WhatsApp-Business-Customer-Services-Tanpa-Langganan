#!/usr/bin/env bash
# Auto-deploy dari GitHub ke Node project aaPanel.
# Dijalankan cron aaPanel "WA Inbox – Auto deploy". Konfigurasi per server ada di
# <APP_DIR>/.deploy.env (tidak di-commit, contoh: deploy/aapanel/deploy.env.example).
#
#   bash deploy/aapanel/auto-deploy.sh            deploy hanya jika ada commit baru
#   bash deploy/aapanel/auto-deploy.sh --force    build & restart ulang commit sekarang
#
# Commit yang gagal dicatat di .deploy-state/failed-sha dan tidak dicoba lagi
# sampai ada commit baru di branch (atau --force).
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
STATE_DIR="$APP_DIR/.deploy-state"
FAILED_FILE="$STATE_DIR/failed-sha"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1
export PATH="$NODE_DIR:$PATH"

exec 9>"/tmp/${PROJECT_NAME}-deploy.lock"
flock -n 9 || exit 0

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
has_script() { [[ -f package.json ]] && node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)"; }

# npm & build dijalankan sebagai user aplikasi, bukan root, agar kepemilikan file konsisten.
APP_HOME="/tmp/${PROJECT_NAME}-home"
mkdir -p "$APP_HOME" "$STATE_DIR" && chown "$RUN_USER:$RUN_USER" "$APP_HOME"
as_app() { runuser -u "$RUN_USER" -- env PATH="$PATH" HOME="$APP_HOME" "$@"; }

# Setelah ada script build, /healthz wajib mengembalikan "version" = SHA commit yang berjalan.
# Placeholder (tanpa build) cukup HTTP 200.
wait_healthy() {
  local sha="$1" need_version="$2" body="" version=""
  for _ in $(seq 1 20); do
    sleep 2
    body="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null)" || continue
    version="$(printf '%s' "$body" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p')"
    if [[ "$need_version" == 0 ]]; then return 0; fi
    if [[ ${#version} -ge 7 && "$sha" == "$version"* ]]; then return 0; fi
  done
  log "Healthcheck gagal: $HEALTH_URL (version: ${version:-tidak ada}, harapan: ${sha:0:7})"
  return 1
}

# Build, migrate, restart, dan healthcheck untuk commit yang sedang di-checkout.
# Output panjang (npm, build) ditulis ke $out yang ditimpa setiap kali, bukan ke log utama.
deploy_checkout() {
  local sha="$1" out="$2" need_version=0
  : >"$out"
  chown -R "$RUN_USER:$RUN_USER" "$APP_DIR" || { log "chown gagal"; return 1; }
  if has_script build; then
    need_version=1
    as_app npm ci --no-audit --no-fund >>"$out" 2>&1 || { log "npm ci gagal, lihat $out"; return 1; }
    as_app npm run build >>"$out" 2>&1 || { log "npm run build gagal, lihat $out"; return 1; }
  fi
  # db:migrate wajib membaca .env sendiri (mis. node --env-file=.env server/dist/cli.js db:migrate).
  if has_script db:migrate; then
    as_app npm run db:migrate >>"$out" 2>&1 || { log "db:migrate gagal, lihat $out"; return 1; }
  fi
  bash "$APP_DIR/deploy/aapanel/restart.sh" "$PROJECT_NAME" >>"$out" 2>&1 || { log "restart aaPanel gagal, lihat $out"; return 1; }
  wait_healthy "$sha" "$need_version"
}

cd "$APP_DIR"
git fetch --quiet origin "$BRANCH"
before="$(git rev-parse HEAD)"
target="$(git rev-parse "origin/$BRANCH")"

if [[ "$FORCE" == 0 ]]; then
  [[ "$before" == "$target" ]] && exit 0
  # Commit ini sudah pernah gagal: tunggu commit baru, jangan restart berulang tiap 2 menit.
  [[ -f "$FAILED_FILE" && "$(cat "$FAILED_FILE")" == "$target" ]] && exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  log "BATAL: folder produksi punya perubahan yang belum di-commit. Folder ini hanya boleh menerima pull."
  git status --porcelain >>"$LOG"
  exit 1
fi

if [[ "$before" != "$target" ]]; then
  log "Deploy ${before:0:7} -> ${target:0:7}"
  if ! git merge --ff-only --quiet "origin/$BRANCH" >>"$LOG" 2>&1; then
    log "BATAL: origin/$BRANCH tidak bisa fast-forward dari ${before:0:7} (riwayat ditulis ulang?)."
    echo "$target" >"$FAILED_FILE"
    exit 1
  fi
  # Perubahan yang hanya menyentuh dokumen tidak perlu build/restart.
  if [[ "$FORCE" == 0 ]] && ! git diff --name-only "$before" "$target" | grep -qvE '^(docs/|README\.md$|CLAUDE\.md$)'; then
    rm -f "$FAILED_FILE"
    log "OK ${target:0:7} (hanya dokumen, tanpa restart)"
    exit 0
  fi
else
  log "Deploy ulang ${target:0:7} (--force)"
fi

if deploy_checkout "$target" "$STATE_DIR/last-deploy.log"; then
  rm -f "$FAILED_FILE"
  log "OK ${target:0:7}"
  exit 0
fi

echo "$target" >"$FAILED_FILE"
if [[ "$before" == "$target" ]]; then
  log "GAGAL ${target:0:7} (--force), tidak ada commit sebelumnya untuk rollback"
  exit 1
fi
log "GAGAL ${target:0:7}, rollback ke ${before:0:7}. Commit ini dilewati sampai ada commit baru."
git reset --hard --quiet "$before"
if deploy_checkout "$before" "$STATE_DIR/last-rollback.log"; then
  log "Rollback selesai, produksi kembali ke ${before:0:7}"
else
  log "ROLLBACK GAGAL: cek manual ($STATE_DIR/last-rollback.log)"
fi
exit 1
