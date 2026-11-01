#!/usr/bin/env bash
# Deploy dari laptop ke server (Git Bash). Host dan folder dibaca dari deploy/deploy.local.env.
#
#   bash scripts/deploy.sh              cek (lint, typecheck, test) → unggah → aktifkan → push ke GitHub
#   bash scripts/deploy.sh --rollback   kembali ke release sebelumnya
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/deploy/deploy.local.env"
: "${DEPLOY_HOST:?DEPLOY_HOST belum diisi di deploy/deploy.local.env}"
: "${APP_DIR:?APP_DIR belum diisi di deploy/deploy.local.env}"
cd "$ROOT"

if [[ "${1:-}" == "--rollback" ]]; then
  ssh "$DEPLOY_HOST" "bash '$APP_DIR/bin/rollback.sh'"
  exit
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree belum bersih. Commit dulu, deploy selalu dari commit."
  exit 1
fi
npm run check

sha="$(git rev-parse HEAD)"
release="$(date +%Y%m%d-%H%M%S)-${sha:0:7}"
echo "Mengunggah $release ke $DEPLOY_HOST"
git archive --format=tar HEAD | ssh "$DEPLOY_HOST" "mkdir -p '$APP_DIR/releases/$release' && tar -x -C '$APP_DIR/releases/$release'"
ssh "$DEPLOY_HOST" "bash '$APP_DIR/releases/$release/deploy/server/activate.sh' '$release' '$sha'"

git push -q origin HEAD || echo "Peringatan: push ke GitHub gagal (deploy tetap berhasil)."
echo "Selesai: $release"
