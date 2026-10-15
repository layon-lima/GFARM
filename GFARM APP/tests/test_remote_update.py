import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from ops.painel_estq import Painel
from ops import remote_update


class FakeValue:
    def __init__(self, value):
        self.value = value

    def get(self):
        return self.value


class RemotePanelTests(unittest.TestCase):
    def make_panel(self, host="100.70.80.90", user="Servidor", project=r"C:\ESTQ_SERVIDOR"):
        panel = Painel.__new__(Painel)
        panel.remote_ip = FakeValue(host)
        panel.remote_user = FakeValue(user)
        panel.remote_project = FakeValue(project)
        panel.config = {}
        return panel

    def test_bloqueia_ip_publico_ssh(self):
        panel = self.make_panel(host="8.8.8.8")
        with self.assertRaisesRegex(RuntimeError, "Tailscale"):
            panel._remote_values()

    def test_bloqueia_injecao_em_pasta_remota(self):
        panel = self.make_panel(project=r"C:\ESTQ'; Remove-Item C:\Windows")
        with self.assertRaisesRegex(RuntimeError, "caracteres especiais"):
            panel._remote_values()

    def test_ssh_apenas_acao_fixa_com_chave_e_host_verificado(self):
        with tempfile.TemporaryDirectory() as folder:
            key = Path(folder) / "id_ed25519"
            hosts = Path(folder) / "known_hosts"
            key.write_text("private-test")
            hosts.write_text("100.70.80.90 ssh-ed25519 TEST")
            panel = self.make_panel()
            with patch("ops.painel_estq.REMOTE_KEY", key), \
                 patch("ops.painel_estq.REMOTE_HOSTS", hosts), \
                 patch("ops.painel_estq.find_binary", return_value=Path("ssh.exe")), \
                 patch("ops.painel_estq.save_config"):
                cmd = panel._remote_command("status")
            self.assertEqual(cmd[-1], "status")
            self.assertIn("StrictHostKeyChecking=yes", cmd)
            self.assertIn("BatchMode=yes", cmd)
            self.assertIn("ClearAllForwardings=yes", cmd)
            self.assertNotIn("powershell", " ".join(str(x) for x in cmd).lower())
            with self.assertRaisesRegex(RuntimeError, "não autorizada"):
                panel._remote_command("format C:")

    def test_monitor_antigo_nao_autoriza_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            (state / "monitor_state.json").write_text(json.dumps({
                "timestamp": time.time() - 500,
                "owns_backend": True,
            }))
            with patch.object(remote_update, "STATE", state):
                self.assertFalse(remote_update.monitor_owns_backend())

    def test_sem_saude_antes_update_nao_aplica(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / ".git").mkdir()
            (root / "backend").mkdir()
            (root / "backend" / ".env").write_text("test")
            (root / "dist").mkdir()
            (root / "dist" / "index.html").write_text("existing")
            (root / "backend" / ".venv" / "Scripts").mkdir(parents=True)
            (root / "backend" / ".venv" / "Scripts" / "python.exe").write_text("")
            def fake_git(project, *args):
                if args[0] == "remote":
                    return "https://github.com/layon-lima/GFARM.git"
                if args[0] == "branch":
                    return "main"
                return ""
            with patch.object(remote_update, "git", side_effect=fake_git), \
                 patch.object(remote_update, "health", return_value=False):
                with self.assertRaisesRegex(RuntimeError, "saudável"):
                    remote_update.root_check(root)
            self.assertEqual((root / "dist" / "index.html").read_text(), "existing")

    def test_nao_publica_backend_sem_monitor_controlado(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "ops").mkdir()
            actions = []
            def fake_git(project, *args):
                actions.append(args)
                if args == ("rev-parse", "HEAD"):
                    return "a" * 40
                if args == ("rev-parse", "origin/main"):
                    return "b" * 40
                if args[:2] == ("diff", "--name-only"):
                    return "backend/app/main.py"
                return ""
            with patch.object(remote_update, "STATE", Path(folder) / "state"), \
                 patch.object(remote_update, "git", side_effect=fake_git), \
                 patch.object(remote_update, "root_check"), \
                 patch.object(remote_update, "monitor_owns_backend", return_value=False):
                with self.assertRaisesRegex(RuntimeError, "monitor antigo"):
                    remote_update.update(root)
            self.assertFalse(any(args[0] == "merge" for args in actions))


if __name__ == "__main__":
    unittest.main()
