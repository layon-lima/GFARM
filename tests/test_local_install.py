import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ops.local_install import is_estq_project, locate_projects, project_from_process
from ops.painel_estq import Painel


def make_estq(root: Path):
    (root / "backend").mkdir(parents=True)
    (root / "backend" / "run_production.py").write_text("# servidor")
    (root / "backend" / ".env").write_text("DB_NAME=PROD")
    (root / "dist").mkdir()
    (root / "dist" / "index.html").write_text("em uso")


class LocalInstallTests(unittest.TestCase):
    def test_reconhece_erp_sem_git_mas_nao_outro_diretorio(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "instalacao existente"
            make_estq(root)
            self.assertTrue(is_estq_project(root))
            self.assertFalse(is_estq_project(root.parent))
            found = locate_projects(other_roots=[root], processes=[])
            self.assertEqual(len(found), 1)
            self.assertFalse(found[0]["git"])
            self.assertEqual(found[0]["path"], root.resolve())
            self.assertEqual((root / "backend" / ".env").read_text(), "DB_NAME=PROD")

    def test_prefere_backend_ativo_a_clone_de_teste(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            active = root / "ERP Ativo"
            other = root / "outro clone"
            make_estq(active)
            make_estq(other)
            process = {
                "ExecutablePath": str(active / "backend" / ".venv" / "Scripts" / "python.exe"),
                "CommandLine": '"' + str(active / "backend" / ".venv" / "Scripts" / "python.exe")
                               + '" "' + str(active / "backend" / "run_production.py") + '"',
            }
            found = locate_projects(other_roots=[other], processes=[process])
            self.assertEqual(found[0]["path"], active.resolve())
            self.assertEqual(found[0]["source"], "processo ativo")
            self.assertEqual(found[1]["path"], other.resolve())

    def test_ignora_pasta_com_git_mas_sem_backend_real(self):
        with tempfile.TemporaryDirectory() as d:
            git_only = Path(d) / "pasta"
            (git_only / ".git").mkdir(parents=True)
            self.assertFalse(locate_projects(other_roots=[git_only], processes=[]))

    def test_recusa_update_de_clone_diferente_do_servidor_ativo(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            active = root / "ativo"
            other = root / "outro"
            make_estq(active)
            make_estq(other)
            panel = Painel.__new__(Painel)
            process = [{
                "ExecutablePath": str(active / "backend" / ".venv" / "Scripts" / "python.exe"),
                "CommandLine": str(active / "backend" / "run_production.py"),
            }]
            with patch("ops.painel_estq.api_ok", return_value=True), \
                 patch("ops.painel_estq.windows_processes", return_value=process):
                with self.assertRaisesRegex(RuntimeError, "OUTRA pasta"):
                    panel._check_active_target(other)

    def test_nao_atualiza_pasta_sem_clone(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_estq(root)
            panel = Painel.__new__(Painel)
            with patch("ops.painel_estq.api_ok", return_value=True), \
                 patch.object(panel, "_check_active_target"):
                with self.assertRaisesRegex(RuntimeError, "não está vinculada"):
                    panel._update_publish(root)
            self.assertFalse((root / ".git").exists())
            self.assertEqual((root / "backend" / ".env").read_text(), "DB_NAME=PROD")

    def test_nunca_inicia_outro_servidor_durante_update(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_estq(root)
            (root / ".git").mkdir()
            (root / "ops").mkdir()
            (root / "ops" / "remote_update.py").write_text("# atualizador")
            panel = Painel.__new__(Painel)
            with patch("ops.painel_estq.api_ok", return_value=True), \
                 patch("ops.painel_estq.python_project", return_value=Path("python.exe")), \
                 patch.object(panel, "_check_active_target"), \
                 patch.object(panel, "_run", return_value="Atualizado") as run, \
                 patch.object(panel, "_prepare") as prepare, \
                 patch.object(panel, "_start") as start:
                panel._update_publish(root)
            prepare.assert_not_called()
            start.assert_not_called()
            self.assertIn("remote_update.py", str(run.call_args))


if __name__ == "__main__":
    unittest.main()
