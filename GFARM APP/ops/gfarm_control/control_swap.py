"""Troca segura do GFARM-Control.exe após a instância atual encerrar.

Executado como processo isolado a partir do ambiente Python do GFARM.
NÃO cria banco, altera uploads, desinstala o aplicativo ou publica Releases.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

TASK = "GFARM Control"


def log(root: Path, message: str):
    root.mkdir(parents=True, exist_ok=True)
    with (root / "control-selfupdate.log").open("a", encoding="utf-8") as file:
        file.write(datetime.now().isoformat(timespec="seconds") + " | " + message + "\n")


def sha256(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def wait_parent(pid: int, timeout_ms=120000):
    """Espera o HANDLE do processo antigo ficar sinalizado, sem adivinhar por porta."""
    if os.name != "nt":
        raise RuntimeError("Troca de executavel disponivel apenas no Windows.")
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    kernel32.WaitForSingleObject.restype = ctypes.c_uint32
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel32.OpenProcess(0x00100000, 0, pid)  # SYNCHRONIZE
    if not handle:
        # ERROR_INVALID_PARAMETER: o processo ja encerrou antes do helper abrir seu HANDLE.
        if ctypes.get_last_error() == 87:
            return
        raise RuntimeError("Nao foi possivel verificar a saida do Control antigo.")
    try:
        result = kernel32.WaitForSingleObject(handle, timeout_ms)
        if result != 0:  # WAIT_OBJECT_0
            raise RuntimeError("Control antigo nao encerrou; EXE anterior preservado.")
    finally:
        kernel32.CloseHandle(handle)


def task(action: str):
    cmd = ["schtasks.exe", action, "/TN", TASK]
    result = subprocess.run(cmd, capture_output=True, text=True,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                            timeout=40)
    if result.returncode != 0:
        raise RuntimeError("Falha na tarefa do Windows: " + (result.stderr or result.stdout)[-500:])


def check_control_online(seconds=65):
    for _ in range(seconds):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8787/api/bootstrap", timeout=2) as result:
                if result.status == 200 and result.headers.get("Server", "").startswith("GFARMControl/"):
                    return
        except (OSError, TimeoutError, urllib.error.URLError):
            pass
        time.sleep(1)
    raise RuntimeError("GFARM Control atualizado nao voltou a responder na porta 8787.")


def copy_retry(source: Path, destination: Path, attempts=25):
    error = None
    for _ in range(attempts):
        try:
            shutil.copy2(source, destination)
            return
        except (OSError, PermissionError) as exc:
            error = exc
            time.sleep(1)
    raise RuntimeError("Nao foi possivel copiar o executavel: " + str(error))


def save_fingerprint(root: Path, fingerprint: str):
    path = root / "control-version.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"fingerprint": fingerprint}, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def perform(root: Path, staged: Path, target: Path, pid: int, expected: str, fingerprint: str):
    if os.name != "nt":
        raise RuntimeError("Atualizador exclusivo do Windows.")
    # Evitar redirecionamento para executaveis/diretorios arbitrarios.
    expected_target = Path(os.environ["ProgramFiles"]) / "GFARM" / "GFARM-Control.exe"
    if os.path.normcase(str(target.resolve())) != os.path.normcase(str(expected_target.resolve())):
        raise RuntimeError("Executavel de destino inesperado; nenhuma alteracao efetuada.")
    staged_root = root / "control-upgrades"
    if staged.is_symlink() or staged_root not in staged.resolve().parents:
        raise RuntimeError("Executavel de atualizacao fora da pasta protegida.")
    if staged.name != "GFARM-Control.exe" or staged.stat().st_size < 1_000_000:
        raise RuntimeError("Novo Control invalido ou incompleto.")
    if sha256(staged).lower() != expected.lower():
        raise RuntimeError("Novo Control falhou na verificacao SHA-256.")
    if not target.is_file():
        raise RuntimeError("GFARM Control antigo nao encontrado.")

    log(root, "Aguardando Control antigo encerrar para trocar executavel...")
    wait_parent(pid)
    backup_dir = root / "control-previous"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / ("GFARM-Control-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".exe")
    copy_retry(target, backup)
    log(root, "Control anterior preservado em " + str(backup))

    try:
        copy_retry(staged, target)
        if sha256(target).lower() != expected.lower():
            raise RuntimeError("Arquivo instalado nao corresponde ao SHA-256 esperado.")
        task("/Run")
        check_control_online()
        save_fingerprint(root, fingerprint)
        log(root, "Control atualizado e validado na porta 8787.")
    except Exception as err:
        log(root, "FALHA atualizando Control: " + str(err) + "; restaurando executavel anterior.")
        try:
            task("/End")
        except Exception as stop_err:
            log(root, "Aviso ao parar a tarefa para rollback: " + str(stop_err))
        copy_retry(backup, target)
        task("/Run")
        check_control_online()
        log(root, "Rollback concluido: Control anterior restaurado.")
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--staged", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--parent-pid", type=int, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--fingerprint", required=True)
    args = parser.parse_args()
    root = args.home.resolve(strict=True)
    try:
        perform(root, args.staged.resolve(strict=True), args.target,
                args.parent_pid, args.sha256, args.fingerprint)
    except Exception as exc:
        log(root, "ATUALIZACAO DO CONTROL FALHOU: " + type(exc).__name__ + ": " + str(exc))
        raise


if __name__ == "__main__":
    main()
