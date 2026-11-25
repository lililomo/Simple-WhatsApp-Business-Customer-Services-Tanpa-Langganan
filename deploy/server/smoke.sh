#!/usr/bin/env bash
# Uji asap sebelum live: menjalankan release yang baru dibangun di port samping (hanya 127.0.0.1) dengan .env dan
# database produksi, memeriksa jawabannya, lalu mematikannya. Dipanggil activate.sh sebelum produksi disentuh.
#   smoke.sh <folder_release> <sha>
set -uo pipefail

RELEASE_DIR="${1:?pakai: smoke.sh <folder_release> <sha>}"
SHA="${2:?pakai: smoke.sh <folder_release> <sha>}"
APP_DIR="${APP_DIR:-$(cd "$RELEASE_DIR/../.." && pwd)}"
RUN_USER="${RUN_USER:-www}"
NODE_DIR="${NODE_DIR:-/www/server/nodejs/v24.14.0/bin}"
PORT="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$APP_DIR/.env" | head -1)"
SMOKE_PORT="${SMOKE_PORT:-$((${PORT:-3210} + 9))}"
BASE="http://127.0.0.1:$SMOKE_PORT"
OUT="$RELEASE_DIR/.smoke.log"
pid=""

listening() { ss -ltn 2>/dev/null | grep -q ":$SMOKE_PORT "; }

stop_app() {
  [[ -n "$pid" ]] || return 0
  # runuser menjalankan node sebagai proses anak.
  pkill -TERM -P "$pid" 2>/dev/null
  kill "$pid" 2>/dev/null
  pid=""
  for _ in $(seq 1 10); do
    listening || return 0
    sleep 0.5
  done
}
trap stop_app EXIT

fail() {
  echo "UJI ASAP GAGAL: $*"
  echo "--- keluaran aplikasi"
  tail -20 "$OUT" 2>/dev/null
  exit 1
}

# $1 = status HTTP yang diharapkan, $2 = keterangan, sisanya = argumen curl.
expect() {
  local want="$1" what="$2" got
  shift 2
  got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@")"
  [[ "$got" == "$want" ]] || fail "$what: HTTP $got, seharusnya $want"
  echo "ok  $what ($got)"
}

listening && fail "port $SMOKE_PORT sedang dipakai"
# cwd = folder release, bukan folder proyek: aaPanel mengenali proses proyek dari cwd-nya dan tidak boleh
# menganggap proses uji ini sebagai aplikasi.
cd "$RELEASE_DIR" || fail "folder release tidak ada"
runuser -u "$RUN_USER" -- env PATH="$NODE_DIR:$PATH" PORT="$SMOKE_PORT" NODE_PROJECT_NAME=smoke-test \
  node --env-file="$APP_DIR/.env" server/dist/index.js >"$OUT" 2>&1 &
pid=$!

ready=""
for _ in $(seq 1 20); do
  sleep 1
  kill -0 "$pid" 2>/dev/null || fail "aplikasi berhenti saat dinyalakan"
  body="$(curl -fsS --max-time 3 "$BASE/healthz" 2>/dev/null)" || continue
  [[ "$body" == *"\"version\":\"$SHA\""* ]] && { ready=1; break; }
done
[[ -n "$ready" ]] || fail "/healthz tidak melaporkan versi ${SHA:0:7} dalam 20 detik"
echo "ok  /healthz versi ${SHA:0:7}"

html="$(curl -s --max-time 5 -H 'accept: text/html' "$BASE/")"
[[ "$html" == *'id="root"'* ]] || fail "halaman utama tidak memuat aplikasi web"
asset="$(printf '%s' "$html" | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' | head -1)"
[[ -n "$asset" ]] || fail "berkas JavaScript utama tidak disebut di halaman utama"
echo "ok  halaman utama memuat aplikasi web"
expect 200 "berkas web $asset" "$BASE$asset"
expect 200 "GET /privacy" "$BASE/privacy"
expect 200 "GET /api/auth/options" "$BASE/api/auth/options"
expect 401 "GET /api/auth/me tanpa login" "$BASE/api/auth/me"
expect 401 "GET /api/conversations tanpa login" "$BASE/api/conversations"
# Rute ini membaca tabel wa_accounts dan membuka App Secret dengan APP_KEY: bukti database dan kunci terbaca.
expect 401 "POST /webhooks/meta bertanda tangan palsu" -X POST -H 'content-type: application/json' \
  -H 'x-hub-signature-256: sha256=00' -d '{}' "$BASE/webhooks/meta"
grep -q '"level":\(50\|60\)' "$OUT" && fail "aplikasi mencatat error saat dinyalakan"

stop_app
listening && fail "proses uji tidak berhenti; port $SMOKE_PORT masih dipakai"
echo "Uji asap lulus"
