"""Atualização remota conservadora do ESTQ.

Executado exclusivamente no computador servidor, por sessão SSH autenticada.
Não recebe shell/comandos livres; não modifica .env, banco ou uploads.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

REPO = "layon-lima/GFARM"
STATE = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ESTQ-Inicializacao"


def say(message: str) -> None:
    print(message, flush=True)


def run(args: list[str], cwd: Path, timeout: int = 300) -> str:
    result = subprocess.run(
        [str(arg) for arg in args], cwd=str(cwd), text=True,
        encoding="utf-8", errors="replace", capture_output=True,
        timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode:
        raise RuntimeError(
            f"{Path(str(args[0])).name} falhou ({result.returncode}): "
            + (result.stderr or result.stdout)[-900:]
        )
    return result.stdout.strip()


def git(project: Path, *args: str) -> str:
    root = project.parent if project.name == "GFARM APP" else project
    return run(["git", *args], root, timeout=180)


def health() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=3) as resp:
            return resp.status == 200 and json.load(resp).get("status") == "online"
    except (OSError, ValueError, TimeoutError, urllib.error.URLError):
        return False


def root_check(project: Path) -> None:
    git_root = project.parent if project.name == "GFARM APP" else project
    if not (git_root / ".git").exists() or not (project / "backend" / ".env").is_file():
        raise RuntimeError("Pasta do servidor inválida ou banco não configurado. Nenhuma alteração feita.")
    origin = git(project, "remote", "get-url", "origin")
    if REPO not in origin or git(project, "branch", "--show-current") != "main":
        raise RuntimeError("Somente a branch main do GitHub oficial pode ser atualizada.")
    if git(project, "status", "--porcelain", "--untracked-files=no"):
        raise RuntimeError("Arquivos versionados modificados no servidor: atualização bloqueada.")
    if not (project / "dist" / "index.html").is_file():
        raise RuntimeError("Frontend atual ausente. Não é seguro executar atualização remota.")
    if not (project / "backend" / ".venv" / "Scripts" / "python.exe").is_file():
        raise RuntimeError("Ambiente Python existente não encontrado.")
    if not health():
        raise RuntimeError("O estoque não está saudável antes da atualização. Nenhuma alteração feita.")


def monitor_owns_backend() -> bool:
    path = STATE / "monitor_state.json"
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        return bool(state.get("owns_backend")) and time.time() - float(state["timestamp"]) < 50
    except (OSError, ValueError, KeyError, TypeError):
        return False


def lock_acquire():
    STATE.mkdir(parents=True, exist_ok=True)
    lock = (STATE / "remote_update.lock").open("a+b")
    lock.seek(0)
    lock.write(b"0")
    lock.flush()
    lock.seek(0)
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        raise RuntimeError("Já existe uma atualização remota em execução.")
    return lock


def changes(project: Path, old: str, new: str) -> list[str]:
    return git(project, "diff", "--name-only", f"{old}..{new}").splitlines()


def status(project: Path) -> None:
    root_check(project)
    say("ESTQ_STATUS " + json.dumps({
        "commit": git(project, "rev-parse", "--short", "HEAD"),
        "online": health(), "monitor_controla_backend": monitor_owns_backend(),
        "projeto": str(project),
    }, ensure_ascii=False))


def update(project: Path) -> None:
    lock = lock_acquire()
    build_dir = None
    added_worktree = False
    previous_dist = None
    try:
        root_check(project)
        if (STATE / "maintenance.flag").is_file():
            raise RuntimeError("Servidor em manutenção. Atualização remota bloqueada.")
        if (STATE / "restart.request").is_file():
            raise RuntimeError("Há reinício pendente de outra operação. Confira o monitor antes.")
        say("ETAPA 1/6 — Verificando GitHub e segurança...")
        old = git(project, "rev-parse", "HEAD")
        git(project, "fetch", "--prune", "origin", "main")
        new = git(project, "rev-parse", "origin/main")
        if old == new:
            say("RESULTADO — Sistema já está atualizado. Nenhuma alteração necessária.")
            return
        # Não aceitar uma reescrita da main ou versões divergentes.
        git(project, "merge-base", "--is-ancestor", old, new)
        changed = changes(project, old, new)
        if project.name != "GFARM APP" and any(x.startswith("GFARM APP/") for x in changed):
            raise RuntimeError(
                "Reorganização do repositório detectada. Atualização automática "
                "de uma instalação antiga bloqueada para proteger o servidor."
            )
        prefix = "GFARM APP/" if project.name == "GFARM APP" else ""
        if any(x.startswith(prefix + "backend/alembic/") or
               x == prefix + "backend/requirements.txt" for x in changed):
            raise RuntimeError(
                "Esta versão altera migrations ou dependências do backend. "
                "Por segurança exige atualização local supervisionada e backup."
            )
        backend_changed = any(x.startswith(prefix + "backend/") for x in changed)
        if backend_changed and not monitor_owns_backend():
            raise RuntimeError(
                "O backend foi iniciado por outro painel ou monitor antigo. "
                "Para atualizar o backend remotamente, instale e teste primeiro o "
                "inicializador GitHub no computador servidor. Nenhuma versão aplicada."
            )
        say("ETAPA 2/6 — Montando a nova versão em pasta isolada...")
        repo_root = project.parent if project.name == "GFARM APP" else project
        build_dir = Path(tempfile.mkdtemp(prefix="estq-build-", dir=str(repo_root.parent)))
        # Git exige diretório inexistente ao criar um worktree.
        shutil.rmtree(build_dir)
        git(project, "worktree", "add", "--detach", str(build_dir), new)
        added_worktree = True
        say("ETAPA 3/6 — Instalando e compilando frontend separado do app online...")
        build_app = build_dir / "GFARM APP" if project.name == "GFARM APP" else build_dir
        run(["npm.cmd" if os.name == "nt" else "npm", "ci", "--no-audit", "--no-fund"],
            build_app, timeout=1800)
        run(["npm.cmd" if os.name == "nt" else "npm", "run", "build"],
            build_app, timeout=1200)
        staged_dist = build_app / "dist"
        if not (staged_dist / "index.html").is_file():
            raise RuntimeError("Novo frontend não foi compilado. App atual preservado.")
        # Uma segunda verificação antes da publicação protege contra concorrência.
        root_check(project)
        if git(project, "rev-parse", "HEAD") != old:
            raise RuntimeError("Versão local mudou durante compilação. Publicação cancelada.")
        say("ETAPA 4/6 — Publicando a versão compilada...")
        previous_dist = project / ".estq-dist-anterior"
        # Mantém sempre a versão imediatamente anterior, sem acumular backups antigos.
        # Só limpa a versão antiga após compilar e validar a nova integralmente.
        if previous_dist.exists():
            shutil.rmtree(previous_dist)
        current_dist = project / "dist"
        current_dist.rename(previous_dist)
        try:
            shutil.move(str(staged_dist), str(current_dist))
            # A atualização do código só ocorre depois que o frontend novo está pronto.
            git(project, "merge", "--ff-only", new)
        except Exception:
            if current_dist.exists():
                shutil.rmtree(current_dist)
            previous_dist.rename(current_dist)
            raise
        say("ETAPA 5/6 — Verificando aplicação...")
        if backend_changed:
            token = uuid.uuid4().hex
            STATE.mkdir(parents=True, exist_ok=True)
            ack = STATE / "restart.ack"
            ack.unlink(missing_ok=True)
            (STATE / "restart.request").write_text(token, encoding="ascii")
            say("Backend alterado: solicitando reinício somente ao monitor responsável...")
            for _ in range(90):
                if ack.is_file() and ack.read_text(encoding="ascii").strip() == token and health():
                    break
                time.sleep(2)
            else:
                raise RuntimeError(
                    "Atualização publicada, mas o backend não confirmou reinício saudável. "
                    "Não faça outra atualização; verifique monitor.log no servidor."
                )
        elif not health():
            raise RuntimeError(
                "Frontend publicado mas health da API falhou. Verifique servidor e logs."
            )
        say("ETAPA 6/6 — Concluído.")
        say("RESULTADO — Atualizado com sucesso. Commit " + new[:12] +
            ". Cópia do frontend anterior preservada em .estq-dist-anterior.")
    finally:
        if added_worktree:
            try:
                git(project, "worktree", "remove", "--force", str(build_dir))
            except Exception as exc:
                say("AVISO — Limpe a pasta de compilação manualmente: " + str(exc))
        elif build_dir is not None and build_dir.exists():
            shutil.rmtree(build_dir, ignore_errors=True)
        lock.close()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--project-dir", required=True, type=Path)
    p.add_argument("action", choices=["status", "update"])
    args = p.parse_args()
    project = args.project_dir.resolve(strict=True)
    try:
        if args.action == "status":
            status(project)
        else:
            update(project)
        return 0
    except (OSError, ValueError, subprocess.SubprocessError, RuntimeError) as exc:
        say("FALHOU — " + str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
