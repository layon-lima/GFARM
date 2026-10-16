"""Iniciador ESTAVEL de servico WEB GFARM Control para tarefa do Windows.

A tarefa executa Python do runtime isolado; nenhum GFARM-Control.exe e criado.
A cada inicio le a versao ativa em control.json e executa o server.py dessa versao.
Os segredos em ProgramData sao acessados apenas pelo servico SYSTEM.
"""
from __future__ import annotations

import json
import os
import runpy
import sys
import traceback
from datetime import datetime
from pathlib import Path


def start(home=None):
    home = Path(home or (Path(os.environ.get("PROGRAMDATA", str(Path.home()))) / "GFARM"))
    recovery = home / "update_transaction.py"
    if (home / "update" / "pending.json").is_file():
        if not recovery.is_file():
            raise RuntimeError("Atualizacao interrompida sem recuperador; execute o reparo.")
        runpy.run_path(str(recovery))["recover_pending"](home)
    config = home / "control.json"
    if not config.is_file():
        raise RuntimeError("GFARM Control ainda nao tem instalacao configurada.")
    active = json.loads(config.read_text(encoding="utf-8")).get("app_path")
    if not active:
        raise RuntimeError("Caminho do GFARM ausente em control.json.")
    source = Path(active).resolve() / "ops" / "gfarm_control" / "server.py"
    if not source.is_file():
        raise RuntimeError("Control web nao encontrado: " + str(source))
    parent = str(source.parent)
    if parent not in sys.path:
        sys.path.insert(0, parent)
    sys.argv = [str(source)]
    runpy.run_path(str(source), run_name="__main__")


if __name__ == "__main__":
    home = Path(os.environ.get("PROGRAMDATA", str(Path.home()))) / "GFARM"
    try:
        start(home)
    except BaseException as exc:
        try:
            home.mkdir(parents=True, exist_ok=True)
            with (home / "control-startup.log").open("a", encoding="utf-8") as out:
                out.write(datetime.now().isoformat(timespec="seconds") + " | " +
                          type(exc).__name__ + ": " + str(exc) + "\n")
                out.write(traceback.format_exc()[-5000:] + "\n")
        except OSError:
            pass
        raise
