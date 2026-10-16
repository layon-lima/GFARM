"""Testes isolados do nucleo do GFARM Control; nunca conecta ao banco real."""
import importlib
import json
import os
import shutil
import subprocess
import sys
import threading
import urllib.request
import http.cookiejar
import http.server
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock


class TestGFARMControl(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.override = mock.patch.dict(os.environ, {"GFARM_HOME": self.folder.name})
        self.override.start()
        self.addCleanup(self.override.stop)
        import engine
        self.engine = importlib.reload(engine)

    def make_zip(self, entries):
        dest = Path(self.folder.name) / "pacote.zip"
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
            for name, content in entries:
                z.writestr(name, content)
        return dest

    def test_locate_external_program_even_when_not_on_path(self):
        directory = Path(self.folder.name) / "bin"
        directory.mkdir()
        program = directory / ("gfarm-test-helper.exe" if os.name == "nt"
                               else "gfarm-test-helper")
        program.write_bytes(b"binary-test")
        program.chmod(0o755)
        with (mock.patch.object(self.engine, "_program_paths", return_value=[str(directory)]),
              mock.patch.dict(os.environ, {"PATH": ""})):
            self.assertEqual(Path(self.engine.resolve_program(program.name)), program)

    def test_missing_dependency_identifies_name(self):
        with (mock.patch.object(self.engine, "_program_paths", return_value=[]),
              mock.patch.dict(os.environ, {"PATH": ""})):
            with self.assertRaisesRegex(RuntimeError, "gfarm-binario-inexistente"):
                self.engine.resolve_program("gfarm-binario-inexistente")

    def test_run_error_identifies_program(self):
        import subprocess
        with (mock.patch.object(self.engine, "resolve_program", return_value="git"),
              mock.patch("engine.subprocess.run", side_effect=FileNotFoundError(
                  2, "The system cannot find the file specified", "git"))):
            with self.assertRaisesRegex(RuntimeError, "Nao foi possivel iniciar git"):
                self.engine.run(["git", "ls-remote", "origin"])

    def test_control_fingerprint_only_changes_when_control_changes(self):
        source = Path(self.folder.name) / "sample" / "ops" / "gfarm_control"
        source.mkdir(parents=True)
        for name in self.engine.CONTROL_SOURCES:
            (source / name).write_text("v1")
        first = self.engine.control_fingerprint(source.parents[1])
        (source / "app.js").write_text("v2")
        second = self.engine.control_fingerprint(source.parents[1])
        self.assertNotEqual(first, second)

    def test_control_web_changed_only_on_control_sources(self):
        root = Path(self.folder.name)
        old = root / "old"
        new = root / "new"
        for location in (old, new):
            source = location / "ops" / "gfarm_control"
            source.mkdir(parents=True)
            for name in self.engine.CONTROL_SOURCES:
                (source / name).write_text("same")
        self.assertFalse(self.engine.control_web_changed(old, new))
        (new / "ops" / "gfarm_control" / "ui.html").write_text("alterado")
        self.assertTrue(self.engine.control_web_changed(old, new))
        self.assertFalse((root / "data" / "backend.env").exists())

    def test_control_reload_flag_one_shot(self):
        self.engine.CONTROL_UPGRADE_PENDING = True
        self.assertTrue(self.engine.consume_control_restart())
        self.assertFalse(self.engine.consume_control_restart())

    def test_missing_control_file_requires_review(self):
        root = Path(self.folder.name) / "incomplete"
        (root / "ops" / "gfarm_control").mkdir(parents=True)
        with self.assertRaisesRegex(RuntimeError, "incompleto"):
            self.engine.control_fingerprint(root)

    def test_open_shortcut_never_reads_protected_programdata(self):
        # No desktop, o processo --open nao e SYSTEM. O diretorio
        # ProgramData\\GFARM pode negar qualquer leitura ao usuario.
        import server
        with (mock.patch("sys.argv", ["GFARM-Control.exe", "--open"]),
              mock.patch.object(server.engine, "load",
                                side_effect=PermissionError("Access denied")),
              mock.patch("webbrowser.open") as browser):
            server.start_control()
        browser.assert_called_once_with("http://127.0.0.1:8787/")

    def test_provision_shortcut_ignores_installed_control_loader(self):
        import server
        with (mock.patch("sys.argv", ["GFARM-Control.exe",
                                      "--setup-password-file", "senha.tmp"]),
              mock.patch.object(server.engine, "load",
                                side_effect=PermissionError("Access denied")),
              mock.patch.object(server, "main") as first_run):
            server.start_control()
        first_run.assert_called_once_with()

    def test_no_database_is_created_when_reading_status(self):
        current = self.engine.status()
        self.assertFalse(current["database_configured"])
        self.assertEqual(current["backup_count"], 0)
        self.assertFalse((Path(self.folder.name) / "data" / "backend.env").exists())

    def test_valid_zip_has_dump_and_manifest(self):
        archive = self.make_zip([
            ("database.dump", b"PGDMPfake-test-only"),
            ("manifest.json", json.dumps({"formato_banco": "pg_dump custom"})),
            ("uploads/foto.png", b"PNG"),
            ("xml_inbox/nota.xml", b"<xml/>"),
        ])
        details = self.engine.validate_archive(archive)
        self.assertEqual(details, {"uploads": 1, "xmls": 1})

    def test_browser_backup_upload_recovers_assets_without_database(self):
        import io
        archive = self.make_zip([
            ("database.dump", b"PGDMPtest"),
            ("manifest.json", json.dumps({"formato_banco": "pg_dump custom"})),
            ("uploads/produtos/oleo.png", b"imagem-testada"),
            ("xml_inbox/nota.xml", b"<xml/>"),
        ])
        payload = archive.read_bytes()
        with mock.patch.object(self.engine, "port_busy", return_value=False):
            staged = self.engine.receive_browser_backup(io.BytesIO(payload), len(payload))
            self.assertTrue(staged.exists())
            self.assertNotEqual(staged, archive)
            result = self.engine.import_assets_only(str(staged))
        self.assertEqual(result["importados"], 2)
        self.assertFalse(result["banco_alterado"])
        self.assertEqual((Path(self.folder.name) / "data" / "uploads" /
                          "produtos" / "oleo.png").read_bytes(), b"imagem-testada")
        self.assertFalse((Path(self.folder.name) / "data" / "backend.env").exists())
        staged.unlink()

    def test_browser_upload_rejects_truncated_and_invalid_backup(self):
        import io
        incoming = Path(self.folder.name) / "incoming"
        with mock.patch.object(self.engine, "port_busy", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "incompleto"):
                self.engine.receive_browser_backup(io.BytesIO(b"ABC"), 7)
            with self.assertRaises(zipfile.BadZipFile):
                self.engine.receive_browser_backup(io.BytesIO(b"not-a-zip"), 9)
        self.assertFalse(list(incoming.glob("gfarm-assets-*.zip")))

    def test_browser_upload_requires_stopped_gfarm(self):
        import io
        with mock.patch.object(self.engine, "port_busy", return_value=True):
            with self.assertRaisesRegex(RuntimeError, "Desligue"):
                self.engine.receive_browser_backup(io.BytesIO(b"ABC"), 3)

    def test_import_assets_only_preserves_database(self):
        archive = self.make_zip([
            ("database.dump", b"PGDMPtest-only"),
            ("manifest.json", json.dumps({"formato_banco": "pg_dump custom"})),
            ("uploads/foto.png", b"foto real da simulacao"),
            ("xml_inbox/nota.xml", b"<nota/>"),
        ])
        with mock.patch.object(self.engine, "port_busy", return_value=False):
            result = self.engine.import_assets_only(str(archive))
        self.assertEqual(result["importados"], 2)
        self.assertFalse(result["banco_alterado"])
        self.assertEqual((Path(self.folder.name) / "data" / "uploads" /
                          "foto.png").read_bytes(), b"foto real da simulacao")
        self.assertFalse((Path(self.folder.name) / "data" / "backend.env").exists())

    def test_rejects_path_traversal(self):
        archive = self.make_zip([
            ("database.dump", b"PGDMPfake"),
            ("manifest.json", json.dumps({"formato_banco": "pg_dump custom"})),
            ("../outside.txt", b"INVALID"),
        ])
        with self.assertRaisesRegex(RuntimeError, "inseguro"):
            self.engine.validate_archive(archive)

    def test_rejects_archive_without_database(self):
        archive = self.make_zip([("manifest.json", '{"formato_banco": "pg_dump custom"}')])
        with self.assertRaisesRegex(RuntimeError, "incompleto"):
            self.engine.validate_archive(archive)

    def test_config_rejects_remote_database(self):
        data = dict(DB_HOST="10.0.0.8", DB_PORT="5432", DB_NAME="teste",
                    DB_USER="test", DB_PASSWORD="test", SECRET_KEY="test_secret",
                    APP_HOST="127.0.0.1", APP_PORT="8000")
        with self.assertRaisesRegex(RuntimeError, "PostgreSQL local"):
            self.engine.save_database(data)

    def test_save_database_does_not_touch_real_db(self):
        data = dict(DB_HOST="127.0.0.1", DB_PORT="5432", DB_NAME="existente",
                    DB_USER="gestor", DB_PASSWORD="senha com # e ;", SECRET_KEY="segredo",
                    APP_HOST="127.0.0.1", APP_PORT="8000")
        with (mock.patch.object(self.engine, "port_busy", return_value=False),
              mock.patch.object(self.engine, "pg_binary", return_value="psql"),
              mock.patch.object(self.engine, "run", return_value="1")):
            outcome = self.engine.save_database(data)
        self.assertIn("nao foi modificado", outcome)
        txt = (Path(self.folder.name) / "data" / "backend.env").read_text()
        self.assertIn('DB_PASSWORD="senha com # e ;"', txt)
        self.assertFalse((Path(self.folder.name) / "data" / "uploads").exists())

    def test_manual_stop_sets_desired_running_false(self):
        with mock.patch.object(self.engine, "port_busy", return_value=False):
            self.engine.stop()
        self.assertFalse(self.engine.load()["desired_running"])

    def test_control_restart_restores_requested_running_state_once_without_retry_loop(self):
        self.engine.DATA.mkdir(parents=True)
        (self.engine.DATA / "backend.env").write_text("# test fixture\n")
        self.engine.save({"app_path": str(self.engine.APP), "automatic": False, "desired_running": True})
        with (mock.patch.object(self.engine, "owned", return_value=False),
              mock.patch.object(self.engine, "port_busy", return_value=False),
              mock.patch.object(self.engine, "start") as start,
              mock.patch.object(self.engine.time, "monotonic", return_value=10),
              mock.patch.object(self.engine.time, "sleep", side_effect=[None, StopIteration])):
            with self.assertRaises(StopIteration):
                self.engine.watchdog()
        start.assert_called_once_with()

    def test_unsafe_restore_requires_explicit_confirmation(self):
        with self.assertRaisesRegex(RuntimeError, "Confirme"):
            self.engine.restore_empty("GFARM_COMPLETO_dummy.zip", "nao")
        self.assertFalse((Path(self.folder.name) / "data" / "backend.env").exists())


class IncrementalUpdateTest(unittest.TestCase):
    """Git REAL local, comandos de build simulados e nenhum banco/servidor real."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.override = mock.patch.dict(os.environ, {"GFARM_HOME": str(self.root / "control")})
        self.override.start()
        self.addCleanup(self.override.stop)
        import engine
        self.engine = importlib.reload(engine)
        self.repo = self.root / "origin"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "GFARM Test")
        self.git("config", "user.email", "gfarm-test@example.invalid")
        files = {
            "backend/run_production.py": "# backend\n",
            "backend/requirements.txt": "# pinned fixture\n",
            "backend/alembic/versions/initial.py": "# schema\n",
            "src/main.jsx": "old source\n",
            "src/obsolete.js": "old file\n",
            "src/unchanged.js": "unchanged\n",
            "package.json": "{}\n",
        }
        source = Path(__file__).resolve().parent
        for name in self.engine.CONTROL_SOURCES:
            files["ops/gfarm_control/" + name] = (source / name).read_text(encoding="utf-8")
        for name, text in files.items():
            self.put(name, text)
        self.git("add", ".")
        self.git("commit", "-m", "installed")
        self.previous = self.git("rev-parse", "HEAD")
        self.app = self.root / "installed" / "GFARM APP"
        shutil.copytree(self.repo / "GFARM APP", self.app)
        (self.app / "node_modules").mkdir()
        (self.app / "dist").mkdir()
        (self.app / "dist/index.html").write_text('old <div id="root"></div>')
        (self.app / "dist/same.css").write_bytes(b"unchanged generated asset")
        (self.app / "backend/.env").write_text("fixture-persistent-configuration")
        (self.app / "backend/uploads").mkdir()
        (self.app / "backend/uploads/photo.jpg").write_bytes(b"persistent-photo")
        self.engine.save({"app_path": str(self.app), "version": self.previous,
                          "desired_running": False, "automatic": True})
        self.put("src/main.jsx", "new source\n")
        self.put("src/new.js", "new file\n")
        (self.repo / "GFARM APP/src/obsolete.js").unlink()
        self.git("add", ".")
        self.git("commit", "-m", "available")
        self.revision = self.git("rev-parse", "HEAD")
        self.commands = []
        self.real_run = self.engine.run
        self.fail_build = False
        self.patches = [
            mock.patch.object(self.engine, "REPO", str(self.repo)),
            mock.patch.object(self.engine, "ssh_environment", return_value={}),
            mock.patch.object(self.engine, "executable", return_value=Path(sys.executable)),
            mock.patch.object(self.engine, "npm_command", side_effect=lambda *args: ["npm", *args]),
            mock.patch.object(self.engine, "port_busy", return_value=False),
            mock.patch.object(self.engine, "run", side_effect=self.command),
            mock.patch.object(self.engine, "schedule_web_control_reload", return_value=False),
        ]
        for patch in self.patches:
            patch.start()
            self.addCleanup(patch.stop)

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, capture_output=True,
                              text=True, check=True).stdout.strip()

    def put(self, name, text):
        path = self.repo / "GFARM APP" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-m", "additional change")
        return self.git("rev-parse", "HEAD")

    def command(self, args, **kwargs):
        cmd = list(map(str, args))
        self.commands.append(cmd)
        if cmd[0] == "git":
            return self.real_run(args, **kwargs)
        if cmd[:3] == ["npm", "run", "build"]:
            if self.fail_build:
                raise RuntimeError("simulated build failure")
            output = Path(cmd[cmd.index("--outDir") + 1])
            output.mkdir(parents=True, exist_ok=True)
            (output / "index.html").write_text('new <div id="root"></div>')
            (output / "same.css").write_bytes(b"unchanged generated asset")
        return ""

    def update(self):
        return self.engine.update(lambda *args: None)

    def assert_persistent(self):
        self.assertEqual((self.app / "backend/.env").read_text(), "fixture-persistent-configuration")
        self.assertEqual((self.app / "backend/uploads/photo.jpg").read_bytes(), b"persistent-photo")
        self.assertEqual(self.engine.project(), self.app)

    def test_real_git_updates_only_changed_files_in_same_installation(self):
        unchanged = (self.app / "src/unchanged.js").stat().st_mtime_ns
        asset_time = (self.app / "dist/same.css").stat().st_mtime_ns
        result = self.update()
        self.assertIn(self.revision[:12], result)
        self.assertEqual((self.app / "src/main.jsx").read_text(), "new source\n")
        self.assertTrue((self.app / "src/new.js").is_file())
        self.assertFalse((self.app / "src/obsolete.js").exists())
        self.assertEqual((self.app / "src/unchanged.js").stat().st_mtime_ns, unchanged)
        self.assertEqual((self.app / "dist/same.css").stat().st_mtime_ns, asset_time)
        self.assertEqual(self.engine.load()["version"], self.revision)
        self.assertFalse(any("clone" in cmd or "checkout" in cmd for cmd in self.commands))
        blobs = [cmd[-1] for cmd in self.commands if "cat-file" in cmd]
        self.assertEqual(len(blobs), 2)  # new main.jsx + new.js; deletion has no download.
        self.assertFalse((self.engine.ROOT / "releases").exists())
        self.assertFalse((self.engine.ROOT / "update/pending.json").exists())
        self.assert_persistent()
        count = len(self.commands)
        self.assertIn("ultima versao", self.update())
        self.assertEqual(len(self.commands) - count, 1)

    def test_build_failure_restores_replaced_deleted_and_added_files(self):
        self.fail_build = True
        with self.assertRaisesRegex(RuntimeError, "simulated build failure"):
            self.update()
        self.assertEqual((self.app / "src/main.jsx").read_text(), "old source\n")
        self.assertTrue((self.app / "src/obsolete.js").is_file())
        self.assertFalse((self.app / "src/new.js").exists())
        self.assertEqual((self.app / "dist/index.html").read_text(), 'old <div id="root"></div>')
        self.assertEqual(self.engine.load()["version"], self.previous)
        self.assert_persistent()

    def test_local_edit_is_preserved_and_update_blocked(self):
        (self.app / "src/main.jsx").write_text("local work")
        with self.assertRaisesRegex(RuntimeError, "diverge"):
            self.update()
        self.assertEqual((self.app / "src/main.jsx").read_text(), "local work")
        self.assertEqual(self.engine.load()["version"], self.previous)

    def test_changed_migration_blocks_before_installation_changes(self):
        self.put("backend/alembic/versions/initial.py", "# unsafe new schema\n")
        self.commit()
        with self.assertRaisesRegex(RuntimeError, "migrations"):
            self.update()
        self.assertEqual((self.app / "src/main.jsx").read_text(), "old source\n")
        self.assert_persistent()

    def test_incoming_persistent_file_is_rejected(self):
        self.put("backend/uploads/photo.jpg", "incoming overwrite")
        self.commit()
        with self.assertRaisesRegex(RuntimeError, "protegido"):
            self.update()
        self.assert_persistent()

    def test_control_reload_failure_rolls_back_entire_update(self):
        self.put("ops/gfarm_control/ui.html", "new control UI")
        self.commit()
        with mock.patch.object(self.engine, "schedule_web_control_reload", side_effect=RuntimeError("helper failed")):
            with self.assertRaisesRegex(RuntimeError, "helper failed"):
                self.update()
        self.assertEqual((self.app / "src/main.jsx").read_text(), "old source\n")
        self.assertEqual(self.engine.load()["version"], self.previous)
        self.assert_persistent()

    def test_backend_only_update_skips_npm_and_preserves_frontend(self):
        # Revert source changes in available commit, then alter backend only.
        self.git("reset", "--hard", self.previous)  # exclusively disposable test origin.
        self.put("backend/run_production.py", "# changed backend\n")
        self.commit()
        self.update()
        self.assertFalse(any(cmd[0] == "npm" for cmd in self.commands))
        self.assertEqual((self.app / "dist/index.html").read_text(), 'old <div id="root"></div>')

    def test_crlf_windows_checkout_is_accepted_without_rewriting_unchanged_file(self):
        (self.app / "src/main.jsx").write_bytes(b"old source\r\n")
        self.update()
        self.assert_persistent()

    def test_download_failure_leaves_installed_code_and_version_untouched(self):
        original = self.command
        def fail_blob(args, **kwargs):
            if "cat-file" in args:
                raise RuntimeError("network unavailable")
            return original(args, **kwargs)
        with mock.patch.object(self.engine, "run", side_effect=fail_blob):
            with self.assertRaisesRegex(RuntimeError, "network unavailable"):
                self.update()
        self.assertEqual((self.app / "src/main.jsx").read_text(), "old source\n")
        self.assertEqual(self.engine.load()["version"], self.previous)
        self.assertFalse((self.engine.ROOT / "update/pending.json").exists())

    def test_blob_integrity_failure_is_detected_before_any_installation_write(self):
        original = self.command
        def corrupt(args, **kwargs):
            return b"corrupt blob" if "cat-file" in args else original(args, **kwargs)
        with mock.patch.object(self.engine, "run", side_effect=corrupt):
            with self.assertRaisesRegex(RuntimeError, "Integridade Git"):
                self.update()
        self.assertEqual((self.app / "src/main.jsx").read_text(), "old source\n")
        self.assert_persistent()

    def test_second_update_reuses_cache_and_downloads_only_next_changed_blob(self):
        self.update()
        self.commands.clear()
        self.put("backend/run_production.py", "# subsequent version\n")
        revision = self.commit()
        self.update()
        self.assertEqual(len([cmd for cmd in self.commands if "cat-file" in cmd]), 1)
        self.assertEqual(self.engine.load()["version"], revision)
        self.assert_persistent()


class FileRecoveryTest(unittest.TestCase):
    def setUp(self):
        from update_transaction import FileUpdate
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.app = self.home / "installed"
        self.app.mkdir()
        (self.app / "module.py").write_bytes(b"previous\n")
        (self.home / "control.json").write_text(json.dumps({"app_path": str(self.app), "version": "old"}))
        self.update = FileUpdate(self.home, self.app, "old", "new")

    def test_interrupted_update_restores_files_before_bootstrap_imports_server(self):
        from update_transaction import recover_pending
        self.update.apply("module.py", b"new\n")
        self.update.apply("added.py", b"new file\n")
        recover_pending(self.home)
        self.assertEqual((self.app / "module.py").read_bytes(), b"previous\n")
        self.assertFalse((self.app / "added.py").exists())
        self.assertFalse(self.update.pending.exists())

    def test_candidate_control_has_only_one_attempt_before_automatic_recovery(self):
        from update_transaction import FileUpdate, recover_pending
        self.update.apply("module.py", b"new\n")
        self.update.state("awaiting_control")
        recover_pending(self.home)
        self.assertEqual(FileUpdate(self.home).info["state"], "checking_control")
        self.assertEqual((self.app / "module.py").read_bytes(), b"new\n")
        recover_pending(self.home)
        self.assertEqual((self.app / "module.py").read_bytes(), b"previous\n")

    def test_commit_retains_new_files_and_clears_pending_journal(self):
        from update_transaction import recover_pending
        self.update.apply("module.py", b"new\n")
        self.update.finish()
        recover_pending(self.home)
        self.assertEqual((self.app / "module.py").read_bytes(), b"new\n")

    def test_rollback_does_not_touch_another_active_installation(self):
        self.update.apply("module.py", b"new\n")
        (self.home / "control.json").write_text(json.dumps({"app_path": str(self.home / "other")}))
        with self.assertRaisesRegex(RuntimeError, "ativa mudou"):
            self.update.rollback()
        self.assertEqual((self.app / "module.py").read_bytes(), b"new\n")

    def test_corrupted_file_backup_blocks_rollback_before_overwriting_any_program(self):
        self.update.apply("module.py", b"new\n")
        (self.update.folder / "files/0").write_bytes(b"corrupted")
        with self.assertRaisesRegex(RuntimeError, "corrompido"):
            self.update.rollback()
        self.assertEqual((self.app / "module.py").read_bytes(), b"new\n")

    def test_failed_control_start_restores_files_and_restarts_previous_control(self):
        import control_reload
        self.update.apply("module.py", b"new\n")
        self.update.info.update(fingerprint="candidate", previous_fingerprint="previous", port=8000)
        self.update.state("awaiting_control")
        with (mock.patch.object(control_reload, "task") as task,
              mock.patch.object(control_reload, "online", side_effect=[False, True]),
              mock.patch.object(control_reload.time, "sleep"),
              mock.patch.object(control_reload.socket, "create_connection", side_effect=OSError)):
            control_reload.complete_reload(self.home, self.update)
        self.assertEqual(task.call_args_list, [mock.call("/Run"), mock.call("/End"), mock.call("/Run")])
        self.assertEqual((self.app / "module.py").read_bytes(), b"previous\n")

    def test_unconfirmed_control_stop_keeps_journal_without_overwriting_active_code(self):
        import control_reload
        self.update.apply("module.py", b"new\n")
        self.update.info.update(fingerprint="candidate", previous_fingerprint="previous", port=8000)
        self.update.state("awaiting_control")
        with (mock.patch.object(control_reload, "task", side_effect=[None, RuntimeError("cannot stop")]),
              mock.patch.object(control_reload, "online", return_value=False),
              mock.patch.object(control_reload.time, "sleep")):
            with self.assertRaisesRegex(RuntimeError, "cannot stop"):
                control_reload.complete_reload(self.home, self.update)
        self.assertEqual((self.app / "module.py").read_bytes(), b"new\n")
        self.assertTrue(self.update.pending.exists())

    def test_unsafe_paths_and_persistent_data_are_never_captured(self):
        from update_transaction import program_path
        for name in ("../outside", "/outside", "backend/.env", "backend/uploads/photo",
                     "data/secret", "x:y", "x\\y", "folder./x"):
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                program_path(self.app, name)

    def test_symlink_cannot_redirect_writes_outside_app(self):
        if os.name == "nt":
            self.skipTest("Windows junction verificado em teste proprio do CI")
        from update_transaction import program_path
        (self.app / "linked").symlink_to(self.home, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "Link/junction"):
            program_path(self.app, "linked/private.py")

    @unittest.skipUnless(os.name == "nt", "Requer Windows Job Objects")
    def test_windows_job_ends_only_owned_backend_child(self):
        import engine
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], creationflags=0x4)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        handle = engine.own_child(process, suspended=True)
        engine.close_child_job(handle)
        process.wait(timeout=10)
        self.assertIsNotNone(process.returncode)


    @unittest.skipUnless(os.name == "nt", "Requer junction Windows")
    def test_windows_junction_cannot_redirect_updates_to_data(self):
        from update_transaction import program_path
        junction = self.app / "linked"
        subprocess.run(["cmd.exe", "/c", "mklink", "/J", str(junction), str(self.home)],
                       capture_output=True, check=True)
        with self.assertRaisesRegex(RuntimeError, "Link/junction"):
            program_path(self.app, "linked/private.py")


class ControlHTTPTest(unittest.TestCase):
    def test_web_control_login_and_status_work_without_backend_or_database(self):
        import engine
        import server
        with tempfile.TemporaryDirectory() as folder:
            with mock.patch.dict(os.environ, {"GFARM_HOME": folder}):
                importlib.reload(engine)
                with (mock.patch.object(server, "PASSWORD_PATH", Path(folder) / "control-auth.json"),
                      mock.patch.object(engine, "running_health", return_value=False)):
                    server.provision("isolated-test-password")
                    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
                    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
                    thread.start()
                    try:
                        base = "http://127.0.0.1:%d" % httpd.server_address[1]
                        client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                        for path, expected in (("/", b"GFARM"), ("/app.js", b"renderStatus")):
                            with client.open(base + path, timeout=5) as response:
                                self.assertEqual(response.status, 200)
                                self.assertIn(expected, response.read())
                        with client.open(base + "/api/bootstrap", timeout=5) as response:
                            self.assertEqual(json.load(response)["control_fingerprint"], server.CONTROL_FINGERPRINT)
                        request = urllib.request.Request(base + "/api/login",
                            data=json.dumps({"password": "isolated-test-password"}).encode(),
                            headers={"Content-Type": "application/json", "Origin": base})
                        with client.open(request, timeout=5) as response:
                            self.assertEqual(response.status, 200)
                        with client.open(base + "/api/status", timeout=5) as response:
                            status = json.load(response)
                            self.assertFalse(status["system"]["database_configured"])
                            self.assertFalse(status["system"]["app_online"])
                        self.assertFalse((Path(folder) / "data/backend.env").exists())
                    finally:
                        httpd.shutdown()
                        httpd.server_close()
                        thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
