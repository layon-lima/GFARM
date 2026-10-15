from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from app.core.config import settings
from app.core.logging_config import (
    DATA_ROOT,
)


logger = logging.getLogger(__name__)

BACKUP_DIR = (
    DATA_ROOT
    / "backups"
)

UPLOAD_DIR = (
    Path(__file__).resolve()
    .parents[2]
    / "uploads"
)

RETENCAO_BACKUPS = 30


def _localizar_binario(
    nome: str,
) -> Path | None:
    direto = shutil.which(
        nome
    )

    if direto:
        return Path(
            direto
        )

    raiz = (
        Path(
            os.environ.get(
                "ProgramFiles",
                r"C:\Program Files",
            )
        )
        / "PostgreSQL"
    )

    if raiz.exists():
        candidatos = sorted(
            raiz.glob(
                f"*/bin/{nome}.exe"
            ),
            reverse=True,
        )

        if candidatos:
            return candidatos[0]

    return None


def localizar_pg_dump():
    return _localizar_binario(
        "pg_dump"
    )


def localizar_pg_restore():
    return _localizar_binario(
        "pg_restore"
    )


def _dump_banco(
    destino: Path,
):
    pg_dump = (
        localizar_pg_dump()
    )

    if pg_dump is None:
        raise RuntimeError(
            "pg_dump não encontrado."
        )

    env = os.environ.copy()

    env["PGPASSWORD"] = (
        settings.DB_PASSWORD
    )

    resultado = subprocess.run(
        [
            str(pg_dump),
            "--format=custom",
            "--no-owner",
            "--no-privileges",
            "--host",
            settings.DB_HOST,
            "--port",
            str(
                settings.DB_PORT
            ),
            "--username",
            settings.DB_USER,
            "--file",
            str(destino),
            settings.DB_NAME,
        ],
        env=env,
        text=True,
        capture_output=True,
    )

    if resultado.returncode != 0:
        raise RuntimeError(
            (
                resultado.stderr
                or "Falha no pg_dump."
            ).strip()
        )


def _adicionar_uploads(
    zf: zipfile.ZipFile,
):
    if not UPLOAD_DIR.exists():
        return

    for arquivo in (
        UPLOAD_DIR.rglob("*")
    ):
        if not arquivo.is_file():
            continue

        relativo = (
            arquivo.relative_to(
                UPLOAD_DIR
            )
        )

        zf.write(
            arquivo,
            (
                Path("uploads")
                / relativo
            ).as_posix(),
        )


def _limpar_retencao():
    arquivos = sorted(
        BACKUP_DIR.glob(
            "INDEX_ERP_*.zip"
        ),
        key=lambda p:
            p.stat().st_mtime,
        reverse=True,
    )

    for antigo in arquivos[
        RETENCAO_BACKUPS:
    ]:
        try:
            antigo.unlink()
        except OSError:
            logger.exception(
                "Falha ao remover backup antigo: %s",
                antigo,
            )


def criar_backup(
    origem: str = "manual",
) -> dict:
    BACKUP_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    agora = datetime.now()

    nome = (
        "INDEX_ERP_"
        + agora.strftime(
            "%Y%m%d_%H%M%S"
        )
        + ".zip"
    )

    destino = (
        BACKUP_DIR
        / nome
    )

    with (
        tempfile
        .TemporaryDirectory(
            prefix=(
                "index_erp_backup_"
            )
        )
    ) as temp:
        temp_dir = Path(
            temp
        )

        dump = (
            temp_dir
            / "database.dump"
        )

        _dump_banco(
            dump
        )

        manifesto = {
            "criado_em":
                agora.isoformat(),
            "origem":
                origem,
            "banco":
                settings.DB_NAME,
            "db_host":
                settings.DB_HOST,
            "db_port":
                settings.DB_PORT,
            "inclui_uploads":
                UPLOAD_DIR.exists(),
            "formato_banco":
                "pg_dump custom",
        }

        with zipfile.ZipFile(
            destino,
            "w",
            compression=(
                zipfile
                .ZIP_DEFLATED
            ),
        ) as zf:
            zf.write(
                dump,
                "database.dump",
            )

            zf.writestr(
                "manifest.json",
                json.dumps(
                    manifesto,
                    ensure_ascii=False,
                    indent=2,
                ),
            )

            _adicionar_uploads(
                zf
            )

    _limpar_retencao()

    tamanho = (
        destino
        .stat()
        .st_size
    )

    logger.info(
        "Backup ERP criado: %s",
        destino,
    )

    return {
        "nome":
            nome,
        "caminho":
            str(destino),
        "tamanho_bytes":
            tamanho,
        "criado_em":
            agora.isoformat(),
        "origem":
            origem,
    }


def listar_backups():
    BACKUP_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    resultado = []

    for arquivo in sorted(
        BACKUP_DIR.glob(
            "INDEX_ERP_*.zip"
        ),
        key=lambda p:
            p.stat().st_mtime,
        reverse=True,
    ):
        stat = (
            arquivo.stat()
        )

        resultado.append(
            {
                "nome":
                    arquivo.name,
                "caminho":
                    str(arquivo),
                "tamanho_bytes":
                    stat.st_size,
                "modificado_em":
                    datetime.fromtimestamp(
                        stat.st_mtime
                    ).isoformat(),
            }
        )

    return resultado


def verificar_backup(
    nome: str,
):
    if (
        Path(nome).name
        != nome
        or not nome.startswith(
            "INDEX_ERP_"
        )
        or not nome.endswith(
            ".zip"
        )
    ):
        raise RuntimeError(
            "Nome de backup inválido."
        )

    arquivo = (
        BACKUP_DIR
        / nome
    )

    if not arquivo.exists():
        raise RuntimeError(
            "Backup não encontrado."
        )

    pg_restore = (
        localizar_pg_restore()
    )

    if pg_restore is None:
        raise RuntimeError(
            "pg_restore não encontrado."
        )

    with (
        tempfile
        .TemporaryDirectory(
            prefix=(
                "index_erp_verify_"
            )
        )
    ) as temp:
        temp_dir = Path(
            temp
        )

        with zipfile.ZipFile(
            arquivo,
            "r",
        ) as zf:
            nomes = set(
                zf.namelist()
            )

            if (
                "database.dump"
                not in nomes
                or "manifest.json"
                not in nomes
            ):
                raise RuntimeError(
                    "Backup incompleto."
                )

            zf.extract(
                "database.dump",
                temp_dir,
            )

        dump = (
            temp_dir
            / "database.dump"
        )

        resultado = (
            subprocess.run(
                [
                    str(
                        pg_restore
                    ),
                    "--list",
                    str(dump),
                ],
                text=True,
                capture_output=True,
            )
        )

        if (
            resultado.returncode
            != 0
        ):
            raise RuntimeError(
                (
                    resultado.stderr
                    or (
                        "pg_restore não "
                        "conseguiu ler o dump."
                    )
                ).strip()
            )

    return {
        "nome":
            nome,
        "valido":
            True,
        "mensagem":
            (
                "Estrutura do backup "
                "validada."
            ),
    }
