"""Identificação SOMENTE LEITURA do servidor ESTQ em um Windows já em uso.

Não altera banco, processos, Git, credenciais nem arquivos da aplicação.
Busca primeiro o Python que mantém o backend ativo (quando visível por CIM),
depois pastas prováveis. Resultados ambíguos exigem escolha humana.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path


def is_estq_project(folder: Path) -> bool:
    """Pasta precisa conter os arquivos característicos da INSTALAÇÃO, não só o .git."""
    try:
        return (
            folder.is_dir()
            and (folder / "backend" / "run_production.py").is_file()
            and (folder / "backend" / ".env").is_file()
            and (folder / "dist" / "index.html").is_file()
        )
    except OSError:
        return False


def project_from_process(process: dict) -> list[Path]:
    """Usa apenas caminhos absolutos de arquivos/processos; não confia em cwd suposto."""
    cmd = str(process.get("CommandLine") or "")
    exe = str(process.get("ExecutablePath") or "")
    candidates: list[Path] = []
    # Script Python apontando explicitamente para este backend.
    for match in re.finditer(
        r"([A-Za-z]:[\\/][^\"\r\n]*?[\\/]backend[\\/]run_production\.py)",
        cmd, re.IGNORECASE,
    ):
        candidates.append(Path(match.group(1)).parent.parent)
    # Se o Python pertence à .venv do estoque, sua própria localização é pista forte.
    if re.search(r"(?:run_production\.py|uvicorn.*app\.main)", cmd, re.IGNORECASE):
        executable = Path(exe)
        if executable.name.lower() in ("python.exe", "pythonw.exe"):
            if executable.parent.name.lower() == "scripts":
                venv = executable.parent.parent
                if venv.name.lower() == ".venv":
                    root = venv.parent
                    if root.name.lower() == "backend":
                        root = root.parent
                    candidates.append(root)
    return candidates


def windows_processes() -> list[dict]:
    if os.name != "nt":
        return []
    command = (
        "Get-CimInstance Win32_Process | "
        "Where-Object { $_.Name -in @('python.exe','pythonw.exe','uvicorn.exe') } | "
        "Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
    )
    try:
        done = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True, encoding="utf-8", errors="replace", text=True,
            timeout=15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if done.returncode:
            return []
        parsed = json.loads(done.stdout)
        if isinstance(parsed, dict):
            return [parsed]
        return [p for p in parsed if isinstance(p, dict)] if isinstance(parsed, list) else []
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return []


def probable_roots(current: Path | None = None) -> list[Path]:
    home = Path.home()
    bases = [
        home / "Documents", home / "Desktop",
        home / "OneDrive" / "Documents",
        home / "OneDrive" / "Documentos",
        Path(os.environ.get("USERPROFILE", str(home))) / "Documents",
        Path("C:/ESTQ"), Path("C:/ESTQ_SERVIDOR"),
        Path("C:/INDEX ERP"), Path("C:/Estoque"),
    ]
    if current:
        bases.extend([current, current.parent])
    if not getattr(sys, "frozen", False):
        bases.append(Path(__file__).resolve().parent.parent)
    result: list[Path] = []
    for base in bases:
        result.append(base)
        if not base.is_dir():
            continue
        # Apenas filhos diretos das pastas usuais; nunca varre o disco inteiro.
        try:
            for child in base.iterdir():
                if child.is_dir():
                    result.append(child)
        except (OSError, PermissionError):
            pass
    return result


def locate_projects(current: Path | None = None, processes: list[dict] | None = None,
                    other_roots: list[Path] | None = None) -> list[dict]:
    """Retorna caminhos com evidência e origem; active é preferido, mas não é escolha automática."""
    if processes is None:
        processes = windows_processes()
    ranked = []
    for proc in processes:
        ranked.extend((p, "processo ativo") for p in project_from_process(proc))
    fallback = probable_roots(current) if other_roots is None else other_roots
    ranked.extend((p, "pasta encontrada") for p in fallback)
    results: list[dict] = []
    seen = set()
    for path, origin in ranked:
        try:
            path = path.expanduser().resolve()
        except (OSError, RuntimeError):
            continue
        key = os.path.normcase(str(path)).casefold()
        if key in seen or not is_estq_project(path):
            continue
        seen.add(key)
        results.append({
            "path": path, "source": origin,
            "git": (path / ".git").exists(),
        })
    return results
