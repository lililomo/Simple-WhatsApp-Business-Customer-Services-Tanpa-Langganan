#!/usr/bin/env bash
# Restart Node project lewat aaPanel supaya status di panel tetap sinkron.
#   bash restart.sh <nama_project_aapanel>          restart
#   bash restart.sh <nama_project_aapanel> adopt    hanya menyamakan file pid panel dengan proses yang hidup
#
# aaPanel melacak proyek hanya lewat file pid. Dua hal membuatnya mudah meleset:
#   - Node 24 menamai prosesnya "MainThread", sedangkan panel mencari proses bernama "node", jadi panel tidak pernah
#     menemukan kembali aplikasi yang file pid-nya hilang;
#   - sejak pembaruan 25 Nov 2026 ada Project Daemon yang menyalakan sendiri proyek yang mati. Ia bisa menyala di
#     sela stop dan start di bawah; dua proses lalu berebut port dan file pid hilang.
# Tanpa file pid, restart_project bawaan menolak dengan "Project did not start" dan tidak menyalakan apa pun.
# Karena itu skrip ini mencari proses proyek sendiri (cwd + NODE_PROJECT_NAME), menulis ulang file pid sebelum stop,
# tetap menjalankan start walau stop gagal, dan menilai hasilnya dari proses yang benar-benar hidup.
# Pemanggil tetap wajib memeriksa /healthz: itulah kebenarannya, bukan kode keluar skrip ini.
set -euo pipefail
PROJECT_NAME="${1:?pakai: restart.sh <nama_project_aapanel> [adopt]}"
MODE="${2:-restart}"

cd /www/server/panel
btpython - "$PROJECT_NAME" "$MODE" <<'PY'
import os, sys, time
os.chdir("/www/server/panel")
sys.path.insert(0, "class")
sys.path.insert(0, "/www/server/panel")
import psutil
import public
from projectModel.nodejsModel import main

name, mode = sys.argv[1], sys.argv[2]
get = public.dict_obj()
get.project_name = name
node = main()
project = node.get_project_find(name)
if not project:
    print("project tidak ditemukan:", name)
    sys.exit(1)
path = project["path"]
run_user = project["project_config"].get("run_user", "www")
pid_file = "{}/{}.pid".format(node._node_pid_path, name)


def live():
    """Proses Node milik proyek ini: dijalankan skrip start panel (NODE_PROJECT_NAME) dari folder proyek."""
    found = []
    for proc in psutil.process_iter():
        try:
            if proc.cwd() != path or os.path.basename(proc.exe()) != "node":
                continue
            if proc.environ().get("NODE_PROJECT_NAME") != name:
                continue
            found.append(proc.pid)
        except Exception:
            continue
    return sorted(found)


def track(pids):
    """Samakan file pid panel dengan proses yang hidup. Mengembalikan True bila file diubah."""
    if not pids:
        return False
    current = (public.readFile(pid_file) or "").strip() if os.path.exists(pid_file) else ""
    if current == str(pids[0]):
        return False
    public.writeFile(pid_file, str(pids[0]))
    public.set_own(pid_file, run_user, run_user)
    return True


if mode == "adopt":
    pids = live()
    print({"mode": "adopt", "pids": pids, "pid_file_diubah": track(pids)})
    sys.exit(0 if pids else 1)

before = live()
track(before)
stop = node.stop_project(get)
# stop_project hanya mematikan proses yang ditunjuk file pid; sisanya (mis. proses kedua hasil tabrakan) di sini.
for _ in range(10):
    left = live()
    if not left:
        break
    for pid in left:
        try:
            psutil.Process(pid).kill()
        except Exception:
            pass
    time.sleep(0.5)

result = node.start_project(get)
pids = []
for _ in range(6):
    time.sleep(1)
    pids = live()
    # Tepat satu proses berarti selesai; dua berarti masih berebut port dengan proses yang dinyalakan daemon.
    if len(pids) == 1:
        break
track(pids)
print({"mode": "restart", "sebelum": before, "stop": str(stop.get("data") if isinstance(stop, dict) else stop)[:80],
       "start": str(result.get("data") if isinstance(result, dict) else result)[:200], "pids": pids})
sys.exit(0 if pids else 1)
PY
