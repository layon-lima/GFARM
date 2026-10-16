"""Reinicia SOMENTE o GFARM Control web apos atualizar os arquivos no GitHub.

Helper externo: o processo antigo encerra antes de o Agendador reabrir o
bootstrap estavel. Se o novo codigo web nao iniciar, volta a configuracao
anterior e inicia novamente o bootstrap antigo. NUNCA altera PostgreSQL.
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path


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


def online(seconds=65):
    for _ in range(seconds):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8787/api/bootstrap", timeout=2) as response:
                if (response.status == 200 and
                        response.headers.get("Server", "").startswith("GFARMControl/")):
                    return True
        except (OSError, TimeoutError, urllib.error.URLError):
            pass
        time.sleep(1)
    return False


def rollback(home, previous_app, previous_version, expected_current):
    config = home / "control.json"
    data = json.loads(config.read_text(encoding="utf-8"))
    if Path(data.get("app_path", "")).resolve() != expected_current.resolve():
        raise RuntimeError("A instalacao ativa mudou. Rollback automatico bloqueado.")
    if not (previous_app / "ops" / "gfarm_control" / "server.py").is_file():
        raise RuntimeError("Codigo antigo do Control ausente. Revisao manual necessaria.")
    data["app_path"] = str(previous_app)
    data["version"] = previous_version
    temporary = config.with_suffix(".rollback.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, config)
    log(home, "Configuracao de aplicativo revertida sem tocar no PostgreSQL.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", required=True, type=Path)
    parser.add_argument("--parent-pid", required=True, type=int)
    parser.add_argument("--ready", required=True, type=Path)
    parser.add_argument("--previous-app", required=True, type=Path)
    parser.add_argument("--previous-version", required=True)
    parser.add_argument("--expected-app", required=True, type=Path)
    args = parser.parse_args()
    home = args.home.resolve(strict=True)

    # Envia sinal de pronto ao processo antigo antes do fechamento.
    ready_file = args.ready.resolve()
    if (home / "control-reload" not in ready_file.parents or
            ready_file.name != "ready.txt"):
        raise RuntimeError("Local do sinal de reinicio nao autorizado.")
    ready_file.parent.mkdir(parents=True, exist_ok=True)
    ready_file.write_text(str(args.parent_pid), encoding="ascii")
    try:
        wait_parent(args.parent_pid)
    finally:
        ready_file.unlink(missing_ok=True)

    try:
        time.sleep(2)
        task("/Run")
        if not online():
            raise RuntimeError("Novo codigo web do Control nao respondeu na porta 8787.")
        log(home, "Codigo atualizado do GFARM Control ativo na porta 8787.")
    except Exception as exc:
        log(home, "Falha na abertura do novo Control: " + str(exc))
        try:
            task("/End")
        except Exception as stop_exc:
            log(home, "Falha encerrando task durante rollback: " + str(stop_exc))
        rollback(home, args.previous_app, args.previous_version, args.expected_app)
        time.sleep(3)
        task("/Run")
        if not online():
            raise RuntimeError("Rollback configurado mas Control antigo nao iniciou; consulte os logs.")
        log(home, "Rollback concluido; Control anterior voltou ao ar.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # stderr disponivel quando chamado manualmente; log do helper registra
        # detalhes do fluxo principal; dados e banco permanecem intactos.
        raise
