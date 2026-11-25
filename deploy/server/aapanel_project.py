# Mengubah perintah jalan Node project lewat modul aaPanel (dijalankan dengan btpython dari /www/server/panel).
#   btpython aapanel_project.py set-script <nama_project> "<perintah>" [memori_minimal_mb]
# Bila memori_minimal_mb diisi, batas memori proyek dinaikkan sampai nilai itu (tidak pernah diturunkan).
import json
import os
import sys

os.chdir("/www/server/panel")
sys.path[0:0] = ["class", "/www/server/panel"]
import public  # noqa: E402
from projectModel.nodejsModel import main  # noqa: E402

action, name = sys.argv[1], sys.argv[2]
site = public.M("sites").where("name=?", (name,)).find()
if not site:
    print("project tidak ditemukan:", name)
    sys.exit(1)
cfg = json.loads(site["project_config"])

if action == "set-script":
    cmd = sys.argv[3]
    try:
        current_memory = int(cfg.get("max_memory_limit") or 0)
    except (TypeError, ValueError):
        current_memory = 0
    min_memory = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4].isdigit() else 0
    memory = max(current_memory, min_memory) if min_memory else cfg["max_memory_limit"]
    if cfg.get("project_script") == cmd and (not min_memory or current_memory >= min_memory):
        print("perintah jalan dan batas memori sudah sesuai")
        sys.exit(0)
    get = public.dict_obj()
    get.project_name = name
    get.project_cwd = cfg["project_cwd"]
    get.project_script = cmd
    get.project_ps = site["ps"]
    get.port = cfg["port"]
    get.is_power_on = cfg["is_power_on"]
    get.run_user = cfg["run_user"]
    get.max_memory_limit = memory
    get.nodejs_version = cfg["nodejs_version"]
    result = main().modify_project(get)
    print(result)
    sys.exit(0 if result.get("status") else 1)

print("aksi tidak dikenal:", action)
sys.exit(1)
