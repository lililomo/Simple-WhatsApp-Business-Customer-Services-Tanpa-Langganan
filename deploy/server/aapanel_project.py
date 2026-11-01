# Mengubah perintah jalan Node project lewat modul aaPanel (dijalankan dengan btpython dari /www/server/panel).
#   btpython aapanel_project.py set-script <nama_project> "<perintah>"
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
    if cfg.get("project_script") == cmd:
        print("perintah jalan sudah sesuai")
        sys.exit(0)
    get = public.dict_obj()
    get.project_name = name
    get.project_cwd = cfg["project_cwd"]
    get.project_script = cmd
    get.project_ps = site["ps"]
    get.port = cfg["port"]
    get.is_power_on = cfg["is_power_on"]
    get.run_user = cfg["run_user"]
    get.max_memory_limit = cfg["max_memory_limit"]
    get.nodejs_version = cfg["nodejs_version"]
    result = main().modify_project(get)
    print(result)
    sys.exit(0 if result.get("status") else 1)

print("aksi tidak dikenal:", action)
sys.exit(1)
