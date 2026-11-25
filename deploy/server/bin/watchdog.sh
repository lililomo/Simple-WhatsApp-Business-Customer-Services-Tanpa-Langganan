#!/usr/bin/env bash
# Dijalankan cron aaPanel "WA Inbox – Watchdog" tiap 5 menit.
# Me-restart lewat aaPanel jika /healthz gagal 2 kali berturut-turut. Project Daemon aaPanel (sejak 25 Nov 2026)
# hanya menyalakan proyek yang menurut file pid-nya mati; ia tidak tahu bila aplikasi hidup tetapi tidak menjawab.
# Saat sehat, skrip ini juga menyamakan file pid panel dengan proses yang hidup (restart.sh adopt), supaya daemon
# itu tidak mengira proyek mati dan mencoba menyalakannya terus.
set -uo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="${PROJECT_NAME:-wa_kppbwi_app}"
PORT="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$APP_DIR/.env" | head -1)"
STATE="/tmp/${PROJECT_NAME}-watchdog.fails"
LOG="/www/wwwlogs/${PROJECT_NAME}-watchdog.log"

# Jangan ikut campur saat deploy sedang berjalan.
exec 9>"/tmp/${PROJECT_NAME}-deploy.lock"
flock -n 9 || exit 0

if curl -fsS --max-time 5 "http://127.0.0.1:${PORT:-3210}/healthz" >/dev/null 2>&1; then
  rm -f "$STATE"
  # Kunci dilepas dulu supaya deploy tidak tertahan oleh langkah ini.
  exec 9>&-
  bash "$APP_DIR/bin/restart.sh" "$PROJECT_NAME" adopt >/dev/null 2>&1
  exit 0
fi

fails=$(($(cat "$STATE" 2>/dev/null || echo 0) + 1))
echo "$fails" >"$STATE"
if ((fails >= 2)); then
  echo "[$(date '+%F %T')] /healthz gagal ${fails}x berturut-turut, restart lewat aaPanel" >>"$LOG"
  bash "$APP_DIR/bin/restart.sh" "$PROJECT_NAME" >>"$LOG" 2>&1 9>&-
  rm -f "$STATE"
fi
