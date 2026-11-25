#!/usr/bin/env bash
# Mode pemeliharaan: aplikasi diganti halaman "sedang pemeliharaan" lewat perintah jalan Node project aaPanel.
#   maintenance.sh on       pasang halaman pemeliharaan (scripts/deploy.sh menjalankannya sebelum aktivasi)
#   maintenance.sh off      jalankan lagi aplikasi (release yang ditunjuk symlink app)
#   maintenance.sh status   tampilkan keadaan sekarang
#
# Aktivasi release yang berhasil (activate.sh) mengembalikan perintah jalan aplikasi dengan sendirinya;
# "off" dipakai saat deploy gagal atau terputus, dan untuk pemeliharaan manual.
# Webhook Meta dijawab 503 selama pemeliharaan, jadi Meta mengirim ulang: pesan masuk tertunda, tidak hilang.
set -uo pipefail

ACTION="${1:-status}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Bisa dijalankan dari <APP_DIR>/bin atau dari releases/<rel>/deploy/server/bin (APP_DIR diberikan pemanggil).
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PROJECT_NAME="${PROJECT_NAME:-wa_kppbwi_app}"
RUN_USER="${RUN_USER:-www}"
LOG="${DEPLOY_LOG:-/www/wwwlogs/${PROJECT_NAME}-deploy.log}"
MAINT_DIR="$APP_DIR/maintenance"
APP_CMD='node --env-file=.env app/server/dist/index.js'
MAINT_CMD='node --env-file=.env maintenance/server.mjs'
PORT="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$APP_DIR/.env" | head -1)"
HEALTH_URL="http://127.0.0.1:${PORT:-3210}/healthz"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

# Berkas dicari di release asal skrip ini, lalu di release aktif, lalu salinan yang sudah terpasang.
find_file() {
  local rel="$1" installed="$2" candidate
  for candidate in "$SCRIPT_DIR/../$rel" "$APP_DIR/app/deploy/server/$rel" "$installed"; do
    [[ -f "$candidate" ]] && { echo "$candidate"; return 0; }
  done
  return 1
}

# Panggilan aaPanel bisa diganti stub saat uji sandbox (AAPANEL_STUB=<skrip>), sama seperti activate.sh.
aapanel() {
  if [[ -n "${AAPANEL_STUB:-}" ]]; then bash "$AAPANEL_STUB" "$@"; return; fi
  case "$1" in
    restart) bash "$APP_DIR/bin/restart.sh" "$PROJECT_NAME" ;;
    set-script) (cd /www/server/panel && btpython "$MAINT_DIR/aapanel_project.py" set-script "$PROJECT_NAME" "$2") ;;
  esac
}

health() { curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null; }

# $1 = potongan teks yang harus ada di jawaban /healthz.
wait_for() {
  for _ in $(seq 1 20); do
    sleep 2
    health | grep -q "$1" && return 0
  done
  return 1
}

# Ganti perintah jalan, restart, tunggu /healthz berisi $2. Kunci deploy tidak diwariskan ke proses Node.
switch_to() {
  aapanel set-script "$1" >/dev/null 2>&1 9>&- || return 1
  aapanel restart >/dev/null 2>&1 9>&- || return 1
  wait_for "$2"
}

if [[ "$ACTION" == "status" ]]; then
  body="$(health)" || { echo "tidak menjawab: $HEALTH_URL"; exit 1; }
  case "$body" in
    *'"app":"maintenance"'*) echo "pemeliharaan" ;;
    *'"version"'*) echo "aplikasi berjalan: $body" ;;
    *) echo "tidak dikenal: $body" ;;
  esac
  exit 0
fi

exec 9>"/tmp/${PROJECT_NAME}-deploy.lock"
flock -n 9 || { echo "Deploy lain sedang berjalan."; exit 1; }

case "$ACTION" in
  on)
    page="$(find_file maintenance/server.mjs "$MAINT_DIR/server.mjs")" || { log "Pemeliharaan: server.mjs tidak ditemukan"; exit 1; }
    helper="$(find_file aapanel_project.py "$MAINT_DIR/aapanel_project.py")" || { log "Pemeliharaan: aapanel_project.py tidak ditemukan"; exit 1; }
    mkdir -p "$MAINT_DIR" "$APP_DIR/bin" || exit 1
    [[ "$page" -ef "$MAINT_DIR/server.mjs" ]] || cp "$page" "$MAINT_DIR/server.mjs" || exit 1
    [[ "$helper" -ef "$MAINT_DIR/aapanel_project.py" ]] || cp "$helper" "$MAINT_DIR/aapanel_project.py" || exit 1
    # Salinan di bin/ dipakai "off" bila release asal skrip ini dihapus karena build gagal.
    [[ "${BASH_SOURCE[0]}" -ef "$APP_DIR/bin/maintenance.sh" ]] || cp "${BASH_SOURCE[0]}" "$APP_DIR/bin/maintenance.sh" || exit 1
    chmod +x "$APP_DIR/bin/maintenance.sh"
    chown -R "$RUN_USER:$RUN_USER" "$MAINT_DIR" "$APP_DIR/bin/maintenance.sh"

    log "Pemeliharaan: dipasang"
    if switch_to "$MAINT_CMD" '"app":"maintenance"'; then
      log "Pemeliharaan: aktif"
      exit 0
    fi
    log "Pemeliharaan: halaman tidak menjawab, aplikasi dijalankan lagi"
    switch_to "$APP_CMD" '"version"' && log "Aplikasi berjalan lagi" || log "GAGAL menjalankan aplikasi lagi: cek manual"
    exit 1
    ;;
  off)
    [[ -f "$MAINT_DIR/aapanel_project.py" || -n "${AAPANEL_STUB:-}" ]] || { log "Pemeliharaan: aapanel_project.py belum terpasang"; exit 1; }
    if health | grep -q '"version"'; then
      # Aplikasi sudah berjalan (mis. activate.sh sudah mengaktifkannya); cukup pastikan perintah jalannya benar.
      aapanel set-script "$APP_CMD" >/dev/null 2>&1 9>&-
      log "Pemeliharaan: sudah selesai, aplikasi berjalan"
      exit 0
    fi
    log "Pemeliharaan: diakhiri"
    if switch_to "$APP_CMD" '"version"'; then
      log "Aplikasi berjalan lagi"
      exit 0
    fi
    log "GAGAL menjalankan aplikasi lagi: cek manual"
    exit 1
    ;;
  *)
    echo "pakai: maintenance.sh on|off|status"
    exit 1
    ;;
esac
