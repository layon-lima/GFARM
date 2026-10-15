import hashlib
import json
import sys
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ops.migrar_servidor import verificar_arquivo


class TestMigracaoServidor(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.arquivo = Path(self.tmp.name) / "migration.zip"

    def montar(self, extras=None):
        with zipfile.ZipFile(self.arquivo, "w") as zf:
            zf.writestr("database.dump", b"PGDMP-test")
            zf.writestr("manifest.json", json.dumps({"formato_banco": "pg_dump custom"}))
            for nome, conteudo in (extras or []):
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    zf.writestr(nome, conteudo)
        sha = hashlib.sha256(self.arquivo.read_bytes()).hexdigest()
        Path(str(self.arquivo) + ".sha256").write_text(sha + "\n")

    def test_arquivo_valido_aceita_uploads_e_xml_pendentes(self):
        self.montar([
            ("uploads/a.png", b"foto"),
            ("xml_inbox/pendente.xml", b"<xml />"),
        ])
        resultado = verificar_arquivo(self.arquivo)
        self.assertEqual(resultado["uploads"], 1)
        self.assertEqual(len(resultado["sha256"]), 64)

    def test_zip_alterado_apos_assinatura_e_rejeitado(self):
        self.montar()
        with self.arquivo.open("ab") as stream:
            stream.write(b"alterado")
        with self.assertRaisesRegex(RuntimeError, "Integridade inválida"):
            verificar_arquivo(self.arquivo)

    def test_falta_sha256_bloqueia_transferencia(self):
        self.montar()
        Path(str(self.arquivo) + ".sha256").unlink()
        with self.assertRaisesRegex(RuntimeError, "SHA-256 ausente"):
            verificar_arquivo(self.arquivo)

    def test_traversal_nao_pode_entrar_no_backup(self):
        self.montar([("uploads/../../roubo.txt", b"abc")])
        with self.assertRaisesRegex(RuntimeError, "caminho ou tipo de arquivo inseguro"):
            verificar_arquivo(self.arquivo)

    def test_segundo_manifesto_injetado_bloqueia(self):
        self.montar([("manifest.json", b"outro")])
        with self.assertRaisesRegex(RuntimeError, "nomes duplicados"):
            verificar_arquivo(self.arquivo)

    def test_credenciais_nao_podem_entrar_no_pacote(self):
        self.montar([("backend/.env", b"DB_PASSWORD=segredo")])
        with self.assertRaisesRegex(RuntimeError, "caminho ou tipo de arquivo inseguro"):
            verificar_arquivo(self.arquivo)


if __name__ == "__main__":
    unittest.main()
