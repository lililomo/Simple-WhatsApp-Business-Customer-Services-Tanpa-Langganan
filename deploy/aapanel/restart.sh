#!/usr/bin/env bash
# Restart Node project lewat aaPanel supaya status di panel tetap sinkron.
#   bash deploy/aapanel/restart.sh <nama_project_aapanel>
set -euo pipefail
PROJECT_NAME="${1:?pakai: restart.sh <nama_project_aapanel>}"

cd /www/server/panel
btpython - "$PROJECT_NAME" <<'PY'
import os, sys
os.chdir("/www/server/panel")
sys.path.insert(0, "class")
sys.path.insert(0, "/www/server/panel")
import public
from projectModel.nodejsModel import main

get = public.dict_obj()
get.project_name = sys.argv[1]
result = main().restart_project(get)
print(result)
sys.exit(0 if result.get("status") else 1)
PY
