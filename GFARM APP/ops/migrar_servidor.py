"""Migração segura do ESTQ: exportar, verificar ou restaurar banco + uploads.

Nunca inclui backend/.env, credenciais, chaves nem tokens no arquivo exportado.
Restauração somente em banco vazio, com comando explícito.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
UPLOADS = BACKEND / "uploads"
XML_INBOX = Path(os.environ.get(
    "ESTQ_XML_TICKET_DIR", str(Path.home() / "Documents" / "XML ERP")
))


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def verificar_arquivo(arquivo: Path) -> dict:
    arquivo = arquivo.resolve(strict=True)
    if not arquivo.is_file() or arquivo.suffix.lower() != ".zip":
        raise RuntimeError("Selecione um arquivo ZIP de migração válido.")

    checksum = Path(str(arquivo) + ".sha256")
    if not checksum.is_file():
        raise RuntimeError("SHA-256 ausente: transfira o ZIP junto com o arquivo .zip.sha256.")
    esperado = checksum.read_text(encoding="utf-8").strip().split()[0].lower()
    if len(esperado) != 64 or any(c not in "0123456789abcdef" for c in esperado):
        raise RuntimeError("Formato SHA-256 inválido.")
    atual = digest(arquivo)
    if atual != esperado:
        raise RuntimeError("Integridade inválida: o ZIP está diferente do arquivo de origem.")

    with zipfile.ZipFile(arquivo) as zf:
        members = zf.infolist()
        nomes = [info.filename for info in members]
        if len(nomes) != len(set(nomes)):
            raise RuntimeError("ZIP contém nomes duplicados.")
        if "database.dump" not in nomes or "manifest.json" not in nomes:
            raise RuntimeError("Backup incompleto (database.dump/manifest.json).")
        for info in members:
            name = info.filename
            parts = PurePosixPath(name)
            mode = (info.external_attr >> 16) & 0xF000
            if (
                name.startswith("/")
                or "\\" in name
                or ".." in parts.parts
                or parts.is_absolute()
                or (mode == 0xA000)  # link simbólico
                or (name not in {"database.dump", "manifest.json"}
                    and not name.startswith("uploads/")
                    and not name.startswith("xml_inbox/"))
            ):
                raise RuntimeError("ZIP contém caminho ou tipo de arquivo inseguro.")
        if zf.getinfo("database.dump").file_size == 0:
            raise RuntimeError("Dump PostgreSQL vazio.")
        if zf.testzip() is not None:
            raise RuntimeError("ZIP corrompido: falha no CRC.")
        manifest = json.loads(zf.read("manifest.json"))
        if manifest.get("formato_banco") != "pg_dump custom":
            raise RuntimeError("Arquivo não é um backup PostgreSQL custom reconhecido.")
    return {"arquivo": str(arquivo), "sha256": atual, "uploads": sum(
        name.startswith("uploads/") and not name.endswith("/") for name in nomes
    )}


def exportar(destino_dir: Path, confirmada_parada: bool) -> None:
    if not confirmada_parada:
        raise RuntimeError(
            "Para capturar banco + uploads coerentes, pause as operações "
            "do app (não o PostgreSQL) e repita com --operacoes-pausadas."
        )
    destino_dir = destino_dir.expanduser().resolve()
    if destino_dir == ROOT or ROOT in destino_dir.parents:
        raise RuntimeError("Não salve arquivos de migração dentro do repositório GitHub.")
    destino_dir.mkdir(parents=True, exist_ok=True)
    from app.services.backup_erp import criar_backup
    from app.core.config import settings

    def api_ativa() -> bool:
        try:
            with socket.create_connection(
                ("127.0.0.1", settings.APP_PORT), timeout=3
            ):
                return True
        except OSError:
            return False

    if api_ativa():
        raise RuntimeError(
            "A API ainda está no ar: execute GFARM.ps1 -Acao Parar "
            "antes do backup final de transferência."
        )

    backup = criar_backup(origem="transferencia_servidor")
    if api_ativa():
        raise RuntimeError(
            "A API voltou a iniciar durante o backup. Exportação recusada "
            "para evitar divergência entre banco e uploads."
        )
    origem = Path(backup["caminho"])
    destino = destino_dir / origem.name
    if destino.exists() or Path(str(destino) + ".sha256").exists():
        raise RuntimeError("Já existe um arquivo com esse nome. Nenhum arquivo foi substituído.")
    shutil.copy2(origem, destino)
    # XML ainda não processado é parte do estado operacional da pesagem.
    if XML_INBOX.is_dir():
        with zipfile.ZipFile(destino, "a", compression=zipfile.ZIP_DEFLATED) as zipf:
            for arquivo_xml in sorted(XML_INBOX.glob("*.xml")):
                if arquivo_xml.is_file() and not arquivo_xml.is_symlink():
                    zipf.write(arquivo_xml, f"xml_inbox/{arquivo_xml.name}")
    Path(str(destino) + ".sha256").write_text(digest(destino) + "\n", encoding="utf-8")
    resultado = verificar_arquivo(destino)
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
    print("IMPORTANTE: ZIP contém dados privados sem criptografia.")
    print("Transfira SOMENTE por mídia criptografada ou canal privado seguro.")
    print("backend/.env e credenciais NÃO estão no ZIP; configure-os separadamente.")


def restaurar(arquivo: Path, confirmado: bool) -> None:
    if not confirmado:
        raise RuntimeError("Restauração bloqueada: informe --destino-vazio-confirmado.")
    resultado = verificar_arquivo(arquivo)
    from app.core.config import settings
    from app.services.backup_erp import localizar_pg_restore

    import psycopg

    binary = localizar_pg_restore()
    if binary is None:
        raise RuntimeError("pg_restore não encontrado no sistema destino.")

    # A importação do backend só é permitida num banco novo e parado.
    # Checagem preventiva: não inicia nem reinicia o serviço.
    import urllib.request
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{settings.APP_PORT}/api/health",
            timeout=2,
        ) as response:
            if response.status == 200:
                raise RuntimeError(
                    "O backend está funcionando neste PC. Pare o serviço "
                    "antes de restaurar um backup."
                )
    except (OSError, TimeoutError):
        pass

    with psycopg.connect(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        dbname=settings.DB_NAME,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        connect_timeout=8,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema NOT IN ('pg_catalog', 'information_schema')"
            )
            count = int(cur.fetchone()[0])
            if count:
                raise RuntimeError(
                    f"Restauração recusada: banco destino já tem {count} tabela(s). "
                    "Nunca sobrescrevemos um banco existente."
                )

    if UPLOADS.exists() and any(UPLOADS.iterdir()):
        raise RuntimeError(
            "Restauração recusada: a pasta backend/uploads não está vazia."
        )
    if XML_INBOX.exists() and XML_INBOX.is_dir() and any(XML_INBOX.iterdir()):
        raise RuntimeError(
            "Restauração recusada: a caixa de entrada XML não está vazia."
        )

    arquivo = arquivo.expanduser().resolve()
    with tempfile.TemporaryDirectory(prefix="estq-restaurar-") as temp:
        temporario = Path(temp)
        with zipfile.ZipFile(arquivo) as zf:
            zf.extractall(temporario)
        dump = temporario / "database.dump"
        listagem = subprocess.run(
            [str(binary), "--list", str(dump)],
            capture_output=True, text=True,
        )
        if listagem.returncode != 0:
            raise RuntimeError("pg_restore não reconheceu o dump PostgreSQL.")
        env = os.environ.copy()
        env["PGPASSWORD"] = settings.DB_PASSWORD
        comando = [
            str(binary),
            "--exit-on-error",
            "--single-transaction",
            "--no-owner",
            "--no-privileges",
            "--host", settings.DB_HOST,
            "--port", str(settings.DB_PORT),
            "--username", settings.DB_USER,
            "--dbname", settings.DB_NAME,
            str(dump),
        ]
        print("Restaurando somente no banco previamente verificado como vazio...")
        execucao = subprocess.run(
            comando, env=env, capture_output=True, text=True,
        )
        if execucao.returncode != 0:
            raise RuntimeError(
                "pg_restore falhou e a transação do banco foi abortada. "
                + (execucao.stderr or "")[-1200:]
            )

        uploads_extraidos = temporario / "uploads"
        if uploads_extraidos.is_dir():
            UPLOADS.mkdir(parents=True, exist_ok=True)
            if any(UPLOADS.iterdir()):
                raise RuntimeError("Pasta de uploads foi alterada durante a operação.")
            for arquivo_upload in uploads_extraidos.iterdir():
                shutil.move(str(arquivo_upload), str(UPLOADS / arquivo_upload.name))

        caixa_xml = temporario / "xml_inbox"
        if caixa_xml.is_dir():
            XML_INBOX.mkdir(parents=True, exist_ok=True)
            if any(XML_INBOX.iterdir()):
                raise RuntimeError("Caixa XML alterada durante a restauração.")
            for xml in caixa_xml.iterdir():
                shutil.move(str(xml), str(XML_INBOX / xml.name))

    print("RESTAURAÇÃO CONCLUÍDA: PostgreSQL, uploads e caixa XML transferidos.")
    print(f"SHA-256 validado: {resultado['sha256']}")
    print("Confira os registros, uploads e saldos com o motor do estoque antes de")
    print("mudar o domínio. Não ligue o servidor antigo para novas movimentações.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="acao", required=True)
    exp = actions.add_parser("exportar")
    exp.add_argument("--destino", required=True, type=Path)
    exp.add_argument("--operacoes-pausadas", action="store_true")
    ver = actions.add_parser("verificar")
    ver.add_argument("--arquivo", required=True, type=Path)
    res = actions.add_parser("restaurar")
    res.add_argument("--arquivo", required=True, type=Path)
    res.add_argument("--destino-vazio-confirmado", action="store_true")
    args = parser.parse_args()
    try:
        if args.acao == "exportar":
            exportar(args.destino, args.operacoes_pausadas)
        elif args.acao == "verificar":
            print(json.dumps(verificar_arquivo(args.arquivo),
                             ensure_ascii=False, indent=2))
        else:
            restaurar(args.arquivo, args.destino_vazio_confirmado)
    except (OSError, RuntimeError, ValueError, zipfile.BadZipFile) as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
