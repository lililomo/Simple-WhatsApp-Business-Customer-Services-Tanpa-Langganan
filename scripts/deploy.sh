#!/usr/bin/env bash
# Deploy dari laptop ke server (Git Bash). Host dan folder dibaca dari deploy/deploy.local.env.
#
#   bash scripts/deploy.sh                    cek (lint, typecheck, test) → unggah → halaman pemeliharaan →
#                                             aktifkan → push ke GitHub
#   bash scripts/deploy.sh --no-maintenance   sama, tanpa halaman pemeliharaan (aplikasi lama melayani sampai restart)
#   bash scripts/deploy.sh --rollback         kembali ke release sebelumnya
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/deploy/deploy.local.env"
: "${DEPLOY_HOST:?DEPLOY_HOST belum diisi di deploy/deploy.local.env}"
: "${APP_DIR:?APP_DIR belum diisi di deploy/deploy.local.env}"
cd "$ROOT"

maintenance=1
case "${1:-}" in
  --rollback)
    ssh "$DEPLOY_HOST" "bash '$APP_DIR/bin/rollback.sh'"
    exit
    ;;
  --no-maintenance) maintenance=0 ;;
  '') ;;
  *)
    echo "Opsi tidak dikenal: $1"
    exit 1
    ;;
esac

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree belum bersih. Commit dulu, deploy selalu dari commit."
  exit 1
fi
npm run check

sha="$(git rev-parse HEAD)"
release="$(date +%Y%m%d-%H%M%S)-${sha:0:7}"
release_dir="$APP_DIR/releases/$release"
echo "Mengunggah $release ke $DEPLOY_HOST"
git archive --format=tar HEAD | ssh "$DEPLOY_HOST" "mkdir -p '$release_dir' && tar -x -C '$release_dir'"

activate="bash '$release_dir/deploy/server/activate.sh' '$release' '$sha'"
if ((maintenance)); then
  # Halaman pemeliharaan dipasang baru setelah cek dan unggah selesai, supaya situs tertutup sesingkat mungkin.
  # Semuanya satu perintah di server dengan SIGHUP/SIGPIPE diabaikan: bila koneksi SSH putus di tengah, aktivasi
  # tetap selesai dan situs tidak tertinggal di mode pemeliharaan. Aktivasi yang berhasil menjalankan aplikasi
  # lagi dengan sendirinya; bila gagal, "off" menjalankan lagi release lama.
  echo "Memasang halaman pemeliharaan lalu mengaktifkan $release"
  ssh "$DEPLOY_HOST" "trap '' HUP PIPE
export APP_DIR='$APP_DIR'
if ! bash '$release_dir/deploy/server/bin/maintenance.sh' on; then rm -rf '$release_dir'; exit 1; fi
$activate; rc=\$?
[ \$rc -eq 0 ] || bash '$APP_DIR/bin/maintenance.sh' off
exit \$rc"
else
  ssh "$DEPLOY_HOST" "$activate"
fi

git push -q origin HEAD || echo "Peringatan: push ke GitHub gagal (deploy tetap berhasil)."
echo "Selesai: $release"
