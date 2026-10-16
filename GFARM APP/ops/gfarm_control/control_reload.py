"""Reinicia SOMENTE o GFARM Control web apos atualizar os arquivos no GitHub.

Helper externo: o processo antigo encerra antes de o Agendador reabrir o
bootstrap estavel. Se o novo codigo web nao iniciar, volta a configuracao
anterior e inicia novamente o bootstrap antigo. NUNCA altera PostgreSQL.
"""
from __future__ import annotations

import argparse
import ctypes
import json
import socket
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from update_transaction import FileUpdate


def log(home, text):
    with (home / "control-reload.log").open("a", encoding="utf-8") as stream:
        stream.write(datetime.now().isoformat(timespec="seconds") + " | " + text + "\n")


def wait_parent(pid):
    if os.name != "nt":
        raise RuntimeError("Reinicio do Control disponivel somente no Windows.")
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    kernel.WaitForSingleObject.restype = ctypes.c_uint32
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x00100000, 0, pid)
    if not handle:
        if ctypes.get_last_error() == 87:
            return
        raise RuntimeError("Nao foi possivel aguardar o Control anterior.")
    try:
        if kernel.WaitForSingleObject(handle, 120000) != 0:
            raise RuntimeError("Control anterior nao encerrou em 120 segundos.")
    finally:
        kernel.CloseHandle(handle)


def task(operation):
    cmd = ["schtasks.exe", operation, "/TN", "GFARM Control"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=45,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise RuntimeError("Agendador do Windows: " + (result.stderr or result.stdout)[-500:])


def online(fingerprint, seconds=65):
    for _ in range(seconds):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8787/api/bootstrap", timeout=2) as response:
                if (response.status == 200 and
                        response.headers.get("Server", "").startswith("GFARMControl/") and
                        json.load(response).get("control_fingerprint") == fingerprint):
                    return True
        except (OSError, ValueError, TimeoutError, urllib.error.URLError):
            pass
        time.sleep(1)
    return False


def backend_online(port, seconds=65):
    for _ in range(seconds):
        try:
            base = "http://127.0.0.1:%d" % port
            with urllib.request.urlopen(base + "/api/health", timeout=2) as response:
                healthy = json.load(response).get("status") == "online"
            with urllib.request.urlopen(base + "/", timeout=2) as response:
                if healthy and b'id="root"' in response.read():
                    return True
        except (OSError, ValueError, TimeoutError):
            pass
        time.sleep(1)
    return False


def complete_reload(home, update):
    try:
        time.sleep(2)
        task("/Run")
        if not online(update.info["fingerprint"]):
            raise RuntimeError("O novo Control nao confirmou o codigo carregado.")
        if update.info.get("was_running") and not backend_online(update.info["port"]):
            raise RuntimeError("O GFARM nao confirmou API e interface apos reiniciar.")
        # Recarregar o journal alterado pelo bootstrap (checking_control).
        FileUpdate(home).finish()
        log(home, "Atualizacao incremental validada: GFARM e Control na mesma pasta.")
    except Exception as exc:
        log(home, "Falha ao validar a atualizacao: " + str(exc))
        # O job Windows do Control encerra apenas o backend filho iniciado por ele.
        # Se nao pudermos parar a tarefa, NAO substituir codigo em uso.
        task("/End")
        for _ in range(30):
            try:
                with socket.create_connection(("127.0.0.1", update.info["port"]), timeout=0.3):
                    pass
            except OSError:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Backend ainda ativo; rollback preservado para revisao segura.")
        update.rollback()
        task("/Run")
        if not online(update.info["previous_fingerprint"]):
            raise RuntimeError("Arquivos revertidos; Control antigo requer verificacao local.")
        log(home, "Arquivos anteriores recuperados sem restaurar/modificar o PostgreSQL.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", required=True, type=Path)
    parser.add_argument("--parent-pid", required=True, type=int)
    parser.add_argument("--ready", required=True, type=Path)
    args = parser.parse_args()
    home = args.home.resolve(strict=True)
    update = FileUpdate(home)
    ready = update.folder / "ready.txt"
    if args.ready.resolve() != ready.resolve():
        raise RuntimeError("Sinal de reinicio fora da transacao atual.")
    ready.write_text(str(args.parent_pid), encoding="ascii")
    try:
        wait_parent(args.parent_pid)
    finally:
        ready.unlink(missing_ok=True)
    update = FileUpdate(home)
    if update.info["state"] != "awaiting_control":
        raise RuntimeError("Transacao cancelada; reinicio nao sera executado.")
    complete_reload(home, update)


if __name__ == "__main__":
    main()
