import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from ops.painel_estq import Painel, safe_project_folder


class TestPainelServidor(unittest.TestCase):
    def test_nao_sobrescreve_pasta_ocupada_sem_git(self):
        with tempfile.TemporaryDirectory() as base:
            folder = Path(base) / "ocupado"
            folder.mkdir()
            (folder / "meu-documento.txt").write_text("dado importante")
            with self.assertRaisesRegex(RuntimeError, "sobrescrita"):
                safe_project_folder(folder)
            self.assertEqual((folder / "meu-documento.txt").read_text(), "dado importante")

    def test_aceita_pasta_vazia_e_repositorio_git(self):
        with tempfile.TemporaryDirectory() as base:
            empty = Path(base) / "vazio"
            empty.mkdir()
            safe_project_folder(empty)
            repo = Path(base) / "repo"
            (repo / ".git").mkdir(parents=True)
            safe_project_folder(repo)

    def test_banco_sem_migrations_nao_pode_abrir_servidor(self):
        with tempfile.TemporaryDirectory() as base:
            backend = Path(base) / "backend"
            backend.mkdir()
            (backend / ".env").write_text(
                "DB_HOST=127.0.0.1\nDB_PORT=5432\nDB_NAME=teste\n"
                "DB_USER=teste\nDB_PASSWORD=nao-real\n"
            )
            panel = Painel.__new__(Painel)
            failed = SimpleNamespace(returncode=0, stdout="f\n", stderr="")
            with patch("ops.painel_estq.find_binary", return_value=Path("psql.exe")), \
                    patch("ops.painel_estq.subprocess.run", return_value=failed):
                with self.assertRaisesRegex(RuntimeError, "sem estrutura restaurada"):
                    panel._restored_database(Path(base))

    def test_banco_ja_restaurado_pode_abrir_servidor(self):
        with tempfile.TemporaryDirectory() as base:
            backend = Path(base) / "backend"
            backend.mkdir()
            (backend / ".env").write_text(
                "DB_HOST=127.0.0.1\nDB_PORT=5432\nDB_NAME=teste\n"
                "DB_USER=teste\nDB_PASSWORD=nao-real\n"
            )
            panel = Painel.__new__(Painel)
            ok = SimpleNamespace(returncode=0, stdout="t\n", stderr="")
            with patch("ops.painel_estq.find_binary", return_value=Path("psql.exe")), \
                    patch("ops.painel_estq.subprocess.run", return_value=ok):
                self.assertTrue(panel._restored_database(Path(base)))

    def test_migracao_passa_flags_de_backup_e_restore(self):
        with tempfile.TemporaryDirectory() as base:
            project = Path(base)
            script = project / "ops" / "migrar_servidor.py"
            script.parent.mkdir()
            script.write_text("# test\n")
            panel = Painel.__new__(Painel)
            with patch("ops.painel_estq.python_project", return_value=Path("python.exe")), \
                    patch.object(panel, "_run", return_value="OK") as runner:
                panel._migration(project, "exportar", folder="D:/Transferencia")
                self.assertIn("--operacoes-pausadas", runner.call_args.args[0])
                panel._migration(project, "restaurar", archive="D:/Transferencia/teste.zip")
                self.assertIn("--destino-vazio-confirmado", runner.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
