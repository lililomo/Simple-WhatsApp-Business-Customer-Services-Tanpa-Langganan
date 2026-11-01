#!/usr/bin/env bash
# Menjalankan CLI aplikasi sebagai user www, memakai release yang aktif.
#   bash /www/wwwroot/wa.kppbwi.app/bin/cli.sh <perintah> [argumen]
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_DIR="${NODE_DIR:-/www/server/nodejs/v24.14.0/bin}"
cd "$APP_DIR"
exec runuser -u "${RUN_USER:-www}" -- "$NODE_DIR/node" --env-file="$APP_DIR/.env" "$APP_DIR/app/server/dist/cli.js" "$@"
