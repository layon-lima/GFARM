"""Operações auxiliares do GFARM, sem comandos Python embutidos no PowerShell.

Executar por caminho de arquivo evita as diferenças de escape de aspas
entre Windows PowerShell 5.1, Python e o runtime do Windows.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
BACKEND = PROJECT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def verificar_banco() -> None:
    # Somente leitura. Nunca cria banco, tabela, migration ou dado.
    from sqlalchemy import text
    from app.db.database import engine

    with engine.connect() as connection:
        resultado = connection.execute(text("SELECT 1")).scalar_one()
    if resultado != 1:
        raise RuntimeError("Consulta SELECT 1 retornou valor inesperado.")
    print("PostgreSQL existente validado com SELECT 1.")


def fazer_backup(data_root: Path) -> None:
    from app.services import backup_erp

    # Dados reais persistem fora do checkout; usa a rotina oficial do ERP.
    backup_erp.BACKUP_DIR = data_root / "backups"
    backup_erp.UPLOAD_DIR = BACKEND / "uploads"
    backup_erp.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    resultado = backup_erp.criar_backup(origem="powershell")
    print("Backup oficial gerado:", resultado.get("caminho", resultado))


def main() -> None:
    parser = argparse.ArgumentParser(description="Operações oficiais do GFARM")
    parser.add_argument("acao", choices=("banco", "backup"))
    parser.add_argument("--data-root", type=Path)
    args = parser.parse_args()

    if args.acao == "banco":
        verificar_banco()
    elif args.acao == "backup":
        if args.data_root is None:
            parser.error("--data-root é obrigatório para backup")
        fazer_backup(args.data_root.resolve())


if __name__ == "__main__":
    main()
