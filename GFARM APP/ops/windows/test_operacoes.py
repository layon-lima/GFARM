"""Regressões isoladas: nenhum teste abre PostgreSQL real ou tarefa Windows."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "gfarm_operacoes", ROOT / "GFARM-Operacoes.py"
)
operacoes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operacoes)


class OperacoesWindowsTest(unittest.TestCase):
    def test_powershell_nao_passa_python_inline_via_c(self):
        conteudo = (ROOT / "GFARM.ps1").read_text(encoding="utf-8")
        self.assertNotIn("& $py -c", conteudo)
        self.assertIn("& $py $operacoes banco", conteudo)
        self.assertIn("& $py $operations backup --data-root $homeDir", conteudo)
        self.assertIn("'GFARM-Operacoes.py'", conteudo)

    def test_consulta_select_1_sem_modificar_tabelas(self):
        from sqlalchemy import create_engine
        fake_app = ModuleType("app")
        fake_app_db = ModuleType("app.db")
        fake_app_database = ModuleType("app.db.database")
        engine = create_engine("sqlite+pysqlite:///:memory:")
        fake_app_database.engine = engine
        fake_app.db = fake_app_db
        fake_app_db.database = fake_app_database
        try:
            with patch.dict(
                sys.modules,
                {
                    "app": fake_app,
                    "app.db": fake_app_db,
                    "app.db.database": fake_app_database,
                },
            ):
                operacoes.verificar_banco()
                with engine.connect() as connection:
                    from sqlalchemy import text
                    total = connection.execute(
                        text("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
                    ).scalar_one()
                self.assertEqual(total, 0)
        finally:
            engine.dispose()

    def test_backup_chama_rotina_oficial_sem_banco_real(self):
        fake_app = ModuleType("app")
        fake_services = ModuleType("app.services")
        fake_backup = ModuleType("app.services.backup_erp")
        fake_app.services = fake_services
        fake_services.backup_erp = fake_backup
        chamados = []

        def criar_backup(*, origem):
            chamados.append((origem, fake_backup.BACKUP_DIR, fake_backup.UPLOAD_DIR))
            return {"caminho": "somente-teste.zip"}

        fake_backup.criar_backup = criar_backup
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict(
                sys.modules,
                {
                    "app": fake_app,
                    "app.services": fake_services,
                    "app.services.backup_erp": fake_backup,
                },
            ):
                operacoes.fazer_backup(Path(folder))
            self.assertEqual(len(chamados), 1)
            self.assertEqual(chamados[0][0], "powershell")
            self.assertEqual(chamados[0][1], Path(folder) / "backups")
            self.assertEqual(chamados[0][2], operacoes.BACKEND / "uploads")


if __name__ == "__main__":
    unittest.main()
