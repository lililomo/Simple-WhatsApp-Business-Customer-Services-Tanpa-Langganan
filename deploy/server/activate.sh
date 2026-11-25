#!/usr/bin/env bash
# Mengaktifkan release yang sudah diunggah scripts/deploy.sh (dijalankan di server sebagai root):
# build → migrasi → ganti symlink app → restart lewat aaPanel → healthcheck (versi = SHA) → bersihkan release lama.
#
#   bash <APP_DIR>/releases/<release>/deploy/server/activate.sh <release> <sha>
#
# Setiap langkah dicek eksplisit. Jangan mengandalkan `set -e` di dalam fungsi yang dipanggil dari `if`.
set -uo pipefail

REL="${1:?pakai: activate.sh <release> <sha>}"
SHA="${2:?pakai: activate.sh <release> <sha>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_DIR="${APP_DIR:-$(cd "$RELEASE_DIR/../.." && pwd)}"
PROJECT_NAME="${PROJECT_NAME:-wa_kppbwi_app}"
NODE_DIR="${NODE_DIR:-/www/server/nodejs/v24.14.0/bin}"
RUN_USER="${RUN_USER:-www}"
LOG="${DEPLOY_LOG:-/www/wwwlogs/${PROJECT_NAME}-deploy.log}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
# AOS menjalankan proses Claude Code di samping Node. Bila MIN_MEMORY_MB diisi (mis. 2048), batas memori proyek di
# aaPanel dinaikkan sampai nilai itu; 0 = tidak diubah. Hanya diisi atas persetujuan pemilik server.
MIN_MEMORY_MB="${MIN_MEMORY_MB:-0}"
VENDOR_DIR="$APP_DIR/vendor/claude-agent-sdk"
APP_CMD='node --env-file=.env app/server/dist/index.js'
PLACEHOLDER_CMD='node placeholder/server.js'
PORT="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$APP_DIR/.env" | head -1)"
HEALTH_URL="http://127.0.0.1:${PORT:-3210}/healthz"
BUILD_LOG="$RELEASE_DIR/.build.log"
APP_HOME="/tmp/${PROJECT_NAME}-home"
export PATH="$NODE_DIR:$PATH"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

# Menunggu sebentar: watchdog memegang kunci yang sama beberapa saat tiap 5 menit.
exec 9>"/tmp/${PROJECT_NAME}-deploy.lock"
flock -w 20 9 || { echo "Deploy lain sedang berjalan."; exit 1; }

# Cache npm global aaPanel dimiliki root, jadi build sebagai www memakai cache sendiri.
as_app() {
  runuser -u "$RUN_USER" -- env PATH="$PATH" HOME="$APP_HOME" npm_config_cache="$APP_HOME/.npm" APP_VERSION="$SHA" "$@"
}

# Panggilan aaPanel bisa diganti stub saat uji sandbox (AAPANEL_STUB=<skrip>).
aapanel() {
  if [[ -n "${AAPANEL_STUB:-}" ]]; then bash "$AAPANEL_STUB" "$@"; return; fi
  case "$1" in
    restart) bash "$SCRIPT_DIR/bin/restart.sh" "$PROJECT_NAME" ;;
    set-script) (cd /www/server/panel && btpython "$SCRIPT_DIR/aapanel_project.py" set-script "$PROJECT_NAME" "$2" "$MIN_MEMORY_MB") ;;
  esac
}

# Restart dengan fd kunci ditutup agar proses Node tidak mewarisi kunci deploy.
restart_app() { aapanel restart >>"$BUILD_LOG" 2>&1 9>&-; }

wait_healthy() {
  local expect="$1" body="" version=""
  for _ in $(seq 1 20); do
    sleep 2
    body="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null)" || continue
    [[ -z "$expect" ]] && return 0
    version="$(printf '%s' "$body" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p')"
    # expect bisa SHA lengkap (deploy) atau 7 karakter (rollback, dari nama release).
    [[ ${#version} -ge 7 && ("$version" == "$expect"* || "$expect" == "$version"*) ]] && return 0
  done
  log "Healthcheck gagal: $HEALTH_URL (version: ${version:-tidak ada}, harapan: ${expect:0:7})"
  return 1
}

# Build gagal sebelum produksi disentuh: simpan log, hapus release, keluar.
abort_build() {
  local failed_log="/www/wwwlogs/${PROJECT_NAME}-build-failed.log"
  [[ -n "${AAPANEL_STUB:-}" ]] && failed_log="$APP_DIR/build-failed.log"
  cp "$BUILD_LOG" "$failed_log" 2>/dev/null
  rm -rf "$RELEASE_DIR"
  log "GAGAL $REL: $1. Produksi tidak berubah. Log: $failed_log"
  exit 1
}

sdk_version() {
  sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$1/node_modules/@anthropic-ai/claude-agent-sdk/package.json" 2>/dev/null | head -1
}

# Biner Claude Code yang dibawa Claude Agent SDK berukuran ±400 MB. Agar tidak tersalin di setiap release, satu
# salinan per versi SDK disimpan di <APP_DIR>/vendor dan dihapus dari node_modules release ini. Aplikasi mencarinya
# di sana (server/src/modules/assistant/engine.ts).
vendor_claude() {
  local version src dest
  version="$(sdk_version "$RELEASE_DIR")"
  [[ -n "$version" ]] || return 0
  src="$(find "$RELEASE_DIR/node_modules/@anthropic-ai" -maxdepth 2 -type f -name claude -path '*claude-agent-sdk-linux-*' 2>/dev/null | grep -v musl | head -1)"
  [[ -n "$src" ]] || src="$(find "$RELEASE_DIR/node_modules/@anthropic-ai" -maxdepth 2 -type f -name claude -path '*claude-agent-sdk-linux-*' 2>/dev/null | head -1)"
  dest="$VENDOR_DIR/$version"
  if [[ -s "$dest/claude" ]]; then
    [[ -n "$src" ]] && rm -f "$src"
    return 0
  fi
  [[ -n "$src" ]] || { echo "biner Claude Code tidak ada di node_modules"; return 1; }
  mkdir -p "$dest" && mv -f "$src" "$dest/claude" && chmod 755 "$dest/claude" && chown -R "$RUN_USER:$RUN_USER" "$APP_DIR/vendor"
}

# Versi biner yang tidak lagi dipakai release mana pun dihapus (release lama masih butuh versinya untuk rollback).
prune_vendor() {
  [[ -d "$VENDOR_DIR" ]] || return 0
  local keep="" rel v
  for rel in "$APP_DIR"/releases/*/; do
    v="$(sdk_version "${rel%/}")"
    [[ -n "$v" ]] && keep="$keep $v "
  done
  for v in "$VENDOR_DIR"/*/; do
    v="$(basename "$v")"
    [[ "$keep" == *" $v "* ]] || rm -rf "${VENDOR_DIR:?}/$v"
  done
}

mkdir -p "$APP_HOME" && chown "$RUN_USER:$RUN_USER" "$APP_HOME"
: >"$BUILD_LOG"
chown -R "$RUN_USER:$RUN_USER" "$RELEASE_DIR" || abort_build "chown release"

log "Build $REL"
(cd "$RELEASE_DIR" && as_app npm ci --no-audit --no-fund) >>"$BUILD_LOG" 2>&1 || abort_build "npm ci"
(cd "$RELEASE_DIR" && as_app npm run build) >>"$BUILD_LOG" 2>&1 || abort_build "npm run build"
# devDependencies hanya dibutuhkan saat build; buang agar tiap release tidak memakan ratusan MB.
(cd "$RELEASE_DIR" && as_app npm prune --omit=dev --no-audit --no-fund) >>"$BUILD_LOG" 2>&1 || abort_build "npm prune"
vendor_claude >>"$BUILD_LOG" 2>&1 || abort_build "simpan biner Claude Code"

log "Migrasi database"
(cd "$APP_DIR" && as_app node --env-file="$APP_DIR/.env" "$RELEASE_DIR/server/dist/cli.js" db:migrate) \
  >>"$BUILD_LOG" 2>&1 || abort_build "db:migrate"

# Uji asap sebelum live (SMOKE_TEST=1 dari deploy.sh saat halaman pemeliharaan terpasang): release baru dijalankan
# di port samping dan diperiksa sebelum produksi disentuh. Hanya saat pemeliharaan, supaya tidak ada dua worker
# webhook yang aktif bersamaan.
if [[ "${SMOKE_TEST:-0}" == "1" ]]; then
  log "Uji asap $REL"
  APP_DIR="$APP_DIR" RUN_USER="$RUN_USER" NODE_DIR="$NODE_DIR" bash "$SCRIPT_DIR/smoke.sh" "$RELEASE_DIR" "$SHA" \
    >>"$BUILD_LOG" 2>&1 9>&- || abort_build "uji asap"
fi

mkdir -p "$APP_DIR/bin" &&
  cp "$RELEASE_DIR"/deploy/server/bin/*.sh "$APP_DIR/bin/" &&
  chmod +x "$APP_DIR"/bin/*.sh || abort_build "salin bin/"

prev="$(readlink "$APP_DIR/app" 2>/dev/null || true)"
ln -sfn "releases/$REL" "$APP_DIR/app.new" && mv -Tf "$APP_DIR/app.new" "$APP_DIR/app" || abort_build "ganti symlink"
chown -h "$RUN_USER:$RUN_USER" "$APP_DIR/app"

aapanel set-script "$APP_CMD" >>"$BUILD_LOG" 2>&1 || log "Peringatan: gagal mengubah perintah jalan aaPanel"
# Hasil restart dinilai dari /healthz, bukan dari kode keluarnya: aaPanel bisa melapor gagal padahal proses hidup.
restart_app
if wait_healthy "$SHA"; then
  log "OK $REL"
  # Simpan release terbaru saja; release yang sedang aktif tidak pernah dihapus.
  ls -1 "$APP_DIR/releases" | sort -r | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
    [[ "releases/$old" == "releases/$REL" ]] || rm -rf "$APP_DIR/releases/$old"
  done
  prune_vendor
  exit 0
fi

log "GAGAL $REL saat restart/healthcheck. Rollback."
if [[ -n "$prev" && -d "$APP_DIR/$prev" ]]; then
  ln -sfn "$prev" "$APP_DIR/app.new" && mv -Tf "$APP_DIR/app.new" "$APP_DIR/app"
  expect="${prev##*-}"
else
  aapanel set-script "$PLACEHOLDER_CMD" >>"$BUILD_LOG" 2>&1
  rm -f "$APP_DIR/app"
  expect=""
fi
restart_app
if wait_healthy "$expect"; then
  log "Rollback selesai (${prev:-placeholder})"
else
  log "ROLLBACK GAGAL: cek manual"
fi
# Release yang gagal dihapus agar tidak pernah menjadi target rollback.sh.
cp "$BUILD_LOG" "$(dirname "$LOG")/${PROJECT_NAME}-activate-failed.log" 2>/dev/null
rm -rf "$RELEASE_DIR"
exit 1
