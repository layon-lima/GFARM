"""Testes isolados do nucleo do GFARM Control; nunca conecta ao banco real."""
import importlib
import json
import os
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

    def test_unsafe_restore_requires_explicit_confirmation(self):
        with self.assertRaisesRegex(RuntimeError, "Confirme"):
            self.engine.restore_empty("GFARM_COMPLETO_dummy.zip", "nao")
        self.assertFalse((Path(self.folder.name) / "data" / "backend.env").exists())


if __name__ == "__main__":
    unittest.main()
