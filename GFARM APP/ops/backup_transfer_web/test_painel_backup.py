"""Testes sem acesso ao banco real e sem enviar dados ao GitHub."""
import importlib.util
import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("painel_backup", ROOT / "painel_backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class TransferenciaTestes(unittest.TestCase):
    def project(self, root):
        p = root / "PROJETO"
        (p / "backend" / "uploads").mkdir(parents=True)
        (p / "backend" / "run_production.py").touch()
        (p / "backend" / ".env").write_text(
            "DB_NAME=teste\nDB_USER=teste\nDB_PASSWORD=segredo\nDB_HOST=127.0.0.1\n")
        (p / "backend" / "uploads" / "foto.png").write_bytes(b"foto")
        return p

    def test_api_ativa_impede_backup(self):
        with tempfile.TemporaryDirectory() as d:
            project = self.project(Path(d))
            with patch.object(backup, "port", return_value=True):
                with self.assertRaisesRegex(RuntimeError, "API"):
                    backup.backup_full(project, lambda _: None)

    def test_gera_zip_com_banco_uploads_e_xml_sem_modificar_origem(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            project=self.project(root)
            xml=root/"xml";xml.mkdir()
            (xml/"ticket.xml").write_text("<ticket/>")
            def fake_cmd(args,**kwargs):
                if "--file" in args:
                    Path(args[args.index("--file")+1]).write_bytes(b"PGDMP mock")
                return ""
            with patch.object(backup, "BACKUPS", root/"saidas"), \
                 patch.object(backup, "port", return_value=False), \
                 patch.object(backup, "pg_bin", return_value=Path("pg_mock")), \
                 patch.object(backup, "xml_dir", return_value=xml), \
                 patch.object(backup, "command", side_effect=fake_cmd):
                zip_path,meta=backup.backup_full(project,lambda _:None)
            with zipfile.ZipFile(zip_path) as z:
                self.assertEqual(z.read("database.dump"), b"PGDMP mock")
                self.assertEqual(z.read("uploads/foto.png"), b"foto")
                self.assertEqual(z.read("xml_inbox/ticket.xml"), b"<ticket/>")
                self.assertEqual(json.loads(z.read("manifest.json"))["formato_banco"], "pg_dump custom")
                self.assertIsNone(z.testzip())
            self.assertEqual(meta["arquivos_uploads"], 1)
            self.assertEqual(meta["arquivos_xml"], 1)
            self.assertEqual(project.joinpath("backend","uploads","foto.png").read_bytes(),b"foto")
            self.assertEqual(Path(str(zip_path)+".sha256").read_text().split()[0],backup.checksum(zip_path))

    def test_checksum_invalido_bloqueia_envio(self):
        with tempfile.TemporaryDirectory() as d:
            zip_path=Path(d)/"GFARM_COMPLETO_1.zip"
            zip_path.write_bytes(b"conteudo")
            Path(str(zip_path)+".sha256").write_text("0"*64)
            with self.assertRaisesRegex(RuntimeError,"SHA-256"):
                backup.publish_backup(zip_path,lambda _:None)

    def test_erro_no_envio_nao_apaga_zip_local(self):
        with tempfile.TemporaryDirectory() as d:
            zip_path=Path(d)/"GFARM_COMPLETO_1.zip"
            zip_path.write_bytes(b"conteudo")
            Path(str(zip_path)+".sha256").write_text(backup.checksum(zip_path))
            with patch.object(backup.shutil,"which",return_value="git"), \
                 patch.object(backup,"command",side_effect=RuntimeError("sem autorizacao")):
                with self.assertRaisesRegex(RuntimeError,"autorizacao"):
                    backup.publish_backup(zip_path,lambda _:None)
            self.assertTrue(zip_path.exists())


if __name__ == "__main__":
    unittest.main()
