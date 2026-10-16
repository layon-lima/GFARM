"""Journal de arquivos para atualizacao incremental; nunca inclui dados do ERP.

Modulo stdlib tambem copiado para o bootstrap estavel. Formato do journal = 1.
O backup contem somente arquivos de programa substituidos/removidos.
"""
from __future__ import annotations

import json
import hashlib
import os
import subprocess
import tempfile
from pathlib import Path, PurePosixPath
from uuid import uuid4


def atomic_write(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + ".gfarm-", delete=False) as output:
            temporary = Path(output.name)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def program_path(app, relative):
    """Bloqueia dados persistentes, escapes, junctions e links simbolicos."""
    parts = PurePosixPath(relative).parts
    forbidden = {".git", ".venv", "venv", "node_modules", "uploads", "backups", "data", "secrets"}
    if (not parts or relative.startswith("/") or "\\" in relative or ":" in relative
            or any(p in (".", "..") or p.lower() in forbidden
                   or (p.lower().startswith(".env") and p.lower() != ".env.example")
                   or p.endswith((".", " ")) for p in parts)):
        raise RuntimeError("Caminho de programa inseguro/protegido: " + relative)
    app = Path(app).resolve(strict=True)
    target = app.joinpath(*parts)
    for item in (target, *target.parents):
        if item == app:
            break
        if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
            raise RuntimeError("Link/junction no caminho de atualizacao: " + relative)
    if not target.resolve().is_relative_to(app):
        raise RuntimeError("Arquivo fora da instalacao: " + relative)
    return target


class FileUpdate:
    def __init__(self, home, app=None, previous=None, revision=None):
        self.home = Path(home).resolve()
        self.pending = self.home / "update" / "pending.json"
        if app is None:
            self.info = json.loads(self.pending.read_text(encoding="utf-8"))
            if self.info.get("format") != 1:
                raise RuntimeError("Journal de atualizacao desconhecido; instalacao preservada.")
        else:
            if self.pending.exists():
                raise RuntimeError("Atualizacao anterior pendente; reinicie o Control para recuperar.")
            self.info = {"format": 1, "id": uuid4().hex, "app": str(Path(app).resolve()),
                         "previous": previous, "revision": revision, "state": "prepared",
                         "entries": [], "restore_commands": []}
        ident = self.info["id"]
        if len(ident) != 32 or any(c not in "0123456789abcdef" for c in ident):
            raise RuntimeError("Identificador de atualizacao invalido.")
        self.folder = self.home / "update" / "history" / ident
        self.folder.mkdir(parents=True, exist_ok=True)
        self.app = Path(self.info["app"]).resolve(strict=True)
        self.persist()

    def persist(self):
        content = json.dumps(self.info, ensure_ascii=False, indent=2).encode("utf-8")
        atomic_write(self.folder / "journal.json", content)
        atomic_write(self.pending, content)

    def state(self, value):
        self.info["state"] = value
        self.persist()

    def target(self, name):
        if name.startswith("@"):
            if name not in ("@control_bootstrap.py", "@update_transaction.py"):
                raise RuntimeError("Arquivo de bootstrap nao autorizado.")
            target = self.home / name[1:]
            if target.is_symlink():
                raise RuntimeError("Link no bootstrap; atualizacao bloqueada.")
            return target
        return program_path(self.app, name)

    def capture(self, name):
        if any(e["path"] == name for e in self.info["entries"]):
            return
        target = self.target(name)
        if target.exists() and not target.is_file():
            raise RuntimeError("Destino nao e um arquivo: " + name)
        index = len(self.info["entries"])
        digest = None
        if target.exists():
            backup = self.folder / "files" / str(index)
            backup.parent.mkdir(parents=True, exist_ok=True)
            content = target.read_bytes()
            atomic_write(backup, content)
            digest = hashlib.sha256(content).hexdigest()
        self.info["entries"].append({"path": name, "existed": target.exists(), "sha256": digest})
        # Registrar ANTES de qualquer substituicao para recuperar interrupcoes.
        self.persist()

    def apply(self, name, content):
        self.capture(name)
        self.state("applying")
        target = self.target(name)
        if content is None:
            target.unlink(missing_ok=True)
        else:
            atomic_write(target, content)

    def restore_command(self, argv, cwd):
        self.info["restore_commands"].append({"argv": list(map(str, argv)), "cwd": str(cwd)})
        self.persist()

    def finish(self):
        self.state("committed")
        self.pending.unlink(missing_ok=True)

    def rollback(self):
        config = self.home / "control.json"
        data = json.loads(config.read_text(encoding="utf-8"))
        if Path(data["app_path"]).resolve() != self.app:
            raise RuntimeError("A instalacao ativa mudou; rollback bloqueado.")
        # Verificar TODOS os destinos antes de escrever qualquer arquivo.
        targets = [self.target(e["path"]) for e in self.info["entries"]]
        for index, entry in enumerate(self.info["entries"]):
            if entry["existed"] and hashlib.sha256((self.folder / "files" / str(index)).read_bytes()).hexdigest() != entry["sha256"]:
                raise RuntimeError("Backup de programa corrompido; rollback bloqueado.")
        for index in reversed(range(len(targets))):
            entry, target = self.info["entries"][index], targets[index]
            if entry["existed"]:
                atomic_write(target, (self.folder / "files" / str(index)).read_bytes())
            else:
                target.unlink(missing_ok=True)
        for command in self.info["restore_commands"]:
            options = os.environ.copy()
            options["PATH"] = str(Path(command["argv"][0]).parent) + os.pathsep + options.get("PATH", "")
            result = subprocess.run(command["argv"], cwd=command["cwd"],
                                    stdin=subprocess.DEVNULL, capture_output=True,
                                    env=options,
                                    timeout=1800,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if result.returncode:
                raise RuntimeError("Falha recuperando dependencias; journal mantido para reparo.")
        data["version"] = self.info["previous"]
        atomic_write(config, json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))
        self.state("rolled_back")
        self.pending.unlink(missing_ok=True)


def recover_pending(home):
    """Chamado ANTES de importar o servidor; recupera uma troca interrompida."""
    if not (Path(home) / "update" / "pending.json").is_file():
        return
    update = FileUpdate(home)
    if update.info["state"] == "awaiting_control":
        # Uma unica abertura da versao candidata, observada pelo helper externo.
        update.state("checking_control")
    elif update.info["state"] in ("committed", "cancelled", "rolled_back"):
        update.pending.unlink(missing_ok=True)
    else:
        update.rollback()
