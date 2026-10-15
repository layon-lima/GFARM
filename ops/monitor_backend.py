"""Monitor local do backend ESTQ. Inicializador de Windows versionado no GitHub.

Não interrompe servidor iniciado pelo painel; só reinicia quando /api/health falha,
a porta está livre e o projeto/ambiente de produção são válidos.
"""
from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path


def health(port: int) -> bool:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/health", timeout=4
        ) as response:
            return response.status == 200
    except (OSError, TimeoutError, urllib.error.URLError):
        return False


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except OSError:
        return False


def python_backend(root: Path) -> Path:
    candidates = [
        root / "backend" / ".venv" / "Scripts" / "python.exe",
        root / ".venv" / "Scripts" / "python.exe",
    ]
    for path in candidates:
        if path.is_file():
            return path
    raise RuntimeError("Python do backend não encontrado na .venv do projeto.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--intervalo", type=int, default=15)
    args = parser.parse_args()
    root = args.project_dir.resolve(strict=True)
    backend = root / "backend"
    launcher = backend / "run_production.py"
    if not launcher.is_file() or not (backend / ".env").is_file():
        raise RuntimeError("Projeto inválido ou backend/.env ausente.")
    python = python_backend(root)
    log_dir = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ESTQ-Inicializacao"
    log_dir.mkdir(parents=True, exist_ok=True)

    def log(msg: str) -> None:
        with (log_dir / "monitor.log").open("a", encoding="utf-8") as fp:
            fp.write(f"{datetime.now().isoformat(timespec='seconds')} | {msg}\n")

    # Impede dois monitores sobre o mesmo backend (Windows).
    lock = (log_dir / "monitor.lock").open("a+b")
    if os.name == "nt":
        import msvcrt
        lock.seek(0)
        lock.write(b"0")
        lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            log("Outro monitor já está ativo; segunda cópia encerrada.")
            return 0

    log(f"Monitor iniciado: projeto={root}, porta={args.port}")
    last_start = 0.0
    child = None
    while True:
        try:
            if (log_dir / "maintenance.flag").is_file():
                # Durante backup de migração, não reiniciar a API.
                time.sleep(max(args.intervalo, 5))
                continue
            if health(args.port):
                time.sleep(max(args.intervalo, 5))
                continue
            if port_open(args.port):
                log("A porta responde, mas /api/health falhou: não inicia cópia concorrente.")
                time.sleep(30)
                continue
            if time.monotonic() - last_start < 60:
                time.sleep(15)
                continue
            if not (root / "dist" / "index.html").is_file():
                log("Backend não iniciado: dist/index.html ausente. Publique o frontend.")
                time.sleep(60)
                continue

            last_start = time.monotonic()
            log("API indisponível; iniciando backend sem intervenção manual.")
            stdout = (log_dir / "backend-startup.log").open("a", encoding="utf-8")
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            try:
                child = subprocess.Popen(
                    [str(python), str(launcher)],
                    cwd=str(backend),
                    stdin=subprocess.DEVNULL,
                    stdout=stdout,
                    stderr=subprocess.STDOUT,
                    creationflags=creationflags,
                    close_fds=True,
                )
            finally:
                stdout.close()
            for _ in range(36):
                if health(args.port):
                    log(f"Backend online, PID={child.pid}.")
                    break
                if child.poll() is not None:
                    log(f"Backend encerrou com código {child.returncode}; veja backend-startup.log.")
                    break
                time.sleep(5)
            else:
                log("Backend não respondeu em 180 s; aguardando antes de tentar novamente.")
                if child.poll() is None:
                    # Não encerrar processo de migração ou inicialização lenta.
                    time.sleep(90)
        except Exception as exc:
            log(f"Erro no monitor: {type(exc).__name__}: {exc}")
            time.sleep(30)


if __name__ == "__main__":
    raise SystemExit(main())
