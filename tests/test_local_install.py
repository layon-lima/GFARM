import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from ops.local_install import (default_server_root, initial_server_root, is_estq_project,
                               locate_projects, project_from_process)
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


    def test_instalador_padroniza_pasta_do_servidor_em_area_gravavel(self):
        with tempfile.TemporaryDirectory() as base:
            with patch.dict("os.environ", {"LOCALAPPDATA": base}):
                self.assertEqual(default_server_root(), Path(base) / "GFARM" / "Servidor")
                self.assertEqual(initial_server_root({}), Path(base) / "GFARM" / "Servidor")
                self.assertEqual(initial_server_root({"project": "C:/Desatualizado"}),
                                 Path(base) / "GFARM" / "Servidor")

    def test_setup_nao_muda_servidor_ja_funcionando(self):
        with tempfile.TemporaryDirectory() as base:
            active = Path(base) / "Estoque Original"
            make_estq(active)
            with patch.dict("os.environ", {"LOCALAPPDATA": base}):
                self.assertEqual(initial_server_root({"project": str(active)}), active)
                self.assertEqual((active / "backend" / ".env").read_text(), "DB_NAME=PROD")
                self.assertFalse((Path(base) / "GFARM" / "Servidor").exists())

    def test_codigo_do_instalador_nao_apaga_dados_do_erp(self):
        installer = (Path(__file__).resolve().parents[1] / "ops" / "windows" / "GFARM_Instalador.iss")
        data = installer.read_text(encoding="utf-8")
        self.assertIn(r"DefaultDirName={sd}\Programas\GFARM", data)
        self.assertIn("ContemDadosDoServidor", data)
        self.assertIn("UninstallDisplayName=GFARM - Sistema de Estoque", data)
        self.assertNotIn("uninsalwaysuninstall", data.lower())
        self.assertNotIn("uninsdeletekeyifempty", data.lower())
        self.assertIn('Key: "Servidor"; String: "{app}\\Servidor"', data)
        self.assertIn('Parameters: "--install-gfarm"', data)
        self.assertIn("runascurrentuser", data)
        self.assertIn(r"Name: \"{app}\Servidor\"".replace(r"\"", '"'), data)

    def test_instalador_instala_aplicacao_em_pasta_escolhida(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base) / "GFARM"
            root.mkdir()
            manifest = root / "gfarm-install.ini"
            manifest.write_text("[GFARM]\nServidor = " + str(root / "Servidor") + "\n", encoding="utf-8")
            with patch("ops.local_install.sys.frozen", True, create=True), \
                 patch("ops.local_install.sys.executable", str(root / "PAINEL_ESTQ.exe")):
                self.assertEqual(default_server_root(), root / "Servidor")
                self.assertEqual(initial_server_root({}), root / "Servidor")

    def test_instalar_gfarm_nao_instala_duas_copias_se_servidor_online(self):
        panel = Painel.__new__(Painel)
        panel.project = lambda: Path("C:/Programas/GFARM/Servidor")
        with patch("ops.painel_estq.api_ok", return_value=True), \
             patch("ops.painel_estq.messagebox.showwarning") as warning, \
             patch.object(panel, "run_background") as background:
            panel.install_gfarm()
            warning.assert_called_once()
            background.assert_not_called()

    def test_instalar_gfarm_rejeita_servidor_existente_mesmo_parado(self):
        with tempfile.TemporaryDirectory() as base:
            original = Path(base) / "estoque atual"
            make_estq(original)
            other = Path(base) / "GFARM" / "Servidor"
            panel = Painel.__new__(Painel)
            panel.project = lambda: other
            with patch("ops.painel_estq.api_ok", return_value=False), \
                 patch("ops.painel_estq.port_busy", return_value=False), \
                 patch("ops.painel_estq.locate_projects",
                       return_value=[{"path": original, "source": "pasta encontrada", "git": False}]), \
                 patch("ops.painel_estq.messagebox.showwarning") as warning, \
                 patch.object(panel, "run_background") as background:
                panel.install_gfarm()
                warning.assert_called_once()
                background.assert_not_called()

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
