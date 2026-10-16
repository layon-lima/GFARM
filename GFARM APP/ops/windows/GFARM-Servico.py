"""Processo do GFARM no Windows, independente do antigo GFARM Control.

Executado diretamente pelo Agendador (SYSTEM) via pythonw.exe. O processo
da tarefa E o backend; encerrar a tarefa encerra somente este servidor.
Nao instala pacotes, nao toca migrations nem altera banco de dados.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path


def main() -> int:
    root = Path(os.environ["PROGRAMDATA"]) / "GFARM"
    logfile = root / "gfarm-servidor.log"
    root.mkdir(parents=True, exist_ok=True)

    # pythonw.exe nao tem console. Nunca descartar erros de inicializacao.
    output = logfile.open("a", encoding="utf-8", buffering=1)
    sys.stdout = output
    sys.stderr = output
    print(f"\n{datetime.now().isoformat(timespec='seconds')} | Iniciando GFARM")
    try:
        config = json.loads((root / "servidor.json").read_text(encoding="utf-8"))
        app = Path(config["app_path"]).resolve(strict=True)
        backend = app / "backend"
        if not (backend / ".env").is_file():
            raise RuntimeError("Configuracao backend/.env ausente; nao iniciando sem banco configurado.")
        if not (app / "dist" / "index.html").is_file():
            raise RuntimeError("Frontend nao compilado; GFARM preservado.")
        if not (backend / "app" / "main.py").is_file():
            raise RuntimeError("Backend do GFARM incompleto.")
        os.environ.setdefault("ESTQ_XML_TICKET_DIR", str(root / "data" / "xml-inbox"))
        # Valor explicito ja configurado no .env e preservado quando presente.
        for line in (backend / ".env").read_text(encoding="utf-8-sig").splitlines():
            if line.lstrip().startswith("ESTQ_XML_TICKET_DIR="):
                value = line.partition("=")[2].strip()
                if value.startswith('"') and value.endswith('"'):
                    value = json.loads(value)
                elif value.startswith("'") and value.endswith("'"):
                    value = value[1:-1]
                if value:
                    os.environ["ESTQ_XML_TICKET_DIR"] = value
                break
        os.chdir(backend)
        sys.path.insert(0, str(backend))
        import uvicorn

        uvicorn.run(
            "app.main:app",
            host="127.0.0.1",
            port=int(config.get("port", 8000)),
            workers=1,
            log_level="info",
        )
        return 0
    except BaseException as exc:
        print(f"Falha ao iniciar GFARM: {type(exc).__name__}: {exc}")
        traceback.print_exc(file=sys.stderr)
        return 1
    finally:
        output.flush()


if __name__ == "__main__":
    sys.exit(main())
