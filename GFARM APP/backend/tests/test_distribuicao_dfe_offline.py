"""Validacoes isoladas: nunca consultam SEFAZ, nunca usam certificados reais."""
import base64
import gzip
import os
import unittest
from unittest.mock import MagicMock, patch

from app.services.distribuicao_dfe import (
    _chave_nfe,
    _descompactar,
    _destinatario_valido,
    _envelope,
    _configuracoes,
    _executar_perfil,
    _xml_seguro,
    executar_sincronizacao_silenciosa,
)

NS = "http://www.portalfiscal.inf.br/nfe"


class DistribuicaoDfeSemRedeTest(unittest.TestCase):
    def test_flag_desativada_nao_acessa_db_ou_rede(self):
        with (
            patch.dict(os.environ, {"GFARM_DFE_ENABLED": "0"}),
            patch("app.services.distribuicao_dfe.SessionLocal") as db,
            patch("app.services.distribuicao_dfe._consultar_sefaz") as rede,
        ):
            executar_sincronizacao_silenciosa()
            rede.assert_not_called()
            db.assert_not_called()

    def test_envelope_sequencia_nsu_e_cnpj_correto(self):
        xml = _envelope("00000000000000", "21", 123)
        root = _xml_seguro(xml)
        self.assertEqual(
            root.find(f".//{{{NS}}}ultNSU").text,
            "000000000000123",
        )
        self.assertEqual(
            root.find(f".//{{{NS}}}CNPJ").text,
            "00000000000000",
        )
        self.assertEqual(
            root.find(f".//{{{NS}}}cUFAutor").text, "21",
        )

    def test_envelope_pf_usa_cpf_em_vez_de_cnpj(self):
        cpf = "12345678901"  # ficticio, somente montagem XML local
        root = _xml_seguro(_envelope(cpf, "21", 987))
        self.assertEqual(root.find(f".//{{{NS}}}CPF").text, cpf)
        self.assertIsNone(root.find(f".//{{{NS}}}CNPJ"))
        self.assertEqual(root.find(f".//{{{NS}}}ultNSU").text,
                         "000000000000987")

    def test_perfis_separam_cinco_cpfs_e_nao_aceitam_duplicidade(self):
        import json
        cpfs = ["12345678901", "12345678902", "12345678903",
                "12345678904", "12345678905"]
        dados = [{"cpf": cpf, "cuf": "21", "cert_path": "/cert.pfx",
                  "password_file": "/cert.pass"} for cpf in cpfs]
        dados.append(dados[0])
        with (patch.dict(os.environ, {
            "GFARM_DFE_PROFILES": json.dumps(dados),
            "GFARM_DFE_ENABLED": "0",
        }),
            patch("app.services.distribuicao_dfe.Path.is_file", return_value=True)):
            perfis = _configuracoes()
        self.assertEqual([p["cpf"] for p in perfis], cpfs)
        self.assertTrue(all(p["cnpj"] == "" for p in perfis))

    def test_cpf_e_cnpj_nao_compartilham_tabelas_nsu(self):
        for identificador, tabela in [
            ({"cpf": "12345678901", "cnpj": ""}, "gfarm_dfe_cursores_pf"),
            ({"cpf": "", "cnpj": "12345678000199"}, "gfarm_dfe_cursores"),
        ]:
            with self.subTest(tabela=tabela):
                db = MagicMock()
                db.execute.return_value.mappings.return_value.first.return_value = None
                perfil = {**identificador,
                          "interessado": identificador["cpf"] or identificador["cnpj"],
                          "cuf": "21"}
                with patch("app.services.distribuicao_dfe._consultar_sefaz") as rede:
                    self.assertEqual(_executar_perfil(db, perfil), 0)
                    rede.assert_not_called()
                sql = " ".join(str(args[0][0]) for args in db.execute.call_args_list)
                self.assertIn(tabela, sql)
                self.assertIn("SKIP LOCKED", sql)

    def test_doczip_resumo_nao_e_xml_completo(self):
        chave = "1" * 44
        xml = f'<resNFe xmlns="{NS}"><chNFe>{chave}</chNFe></resNFe>'.encode()
        comprimido = base64.b64encode(gzip.compress(xml)).decode()
        self.assertEqual(_descompactar(comprimido), xml)
        self.assertEqual(_chave_nfe(xml), (chave, "resumo"))

    def test_doczip_nfe_completa_valida_chave_e_destinatario(self):
        chave = "2" * 44
        xml = (
            f'<nfeProc xmlns="{NS}"><NFe>'
            f'<infNFe Id="NFe{chave}">'
            '<dest><CNPJ>12345678000199</CNPJ></dest>'
            '</infNFe></NFe></nfeProc>'
        ).encode()
        self.assertEqual(_chave_nfe(xml), (chave, "completo"))
        self.assertTrue(_destinatario_valido(xml, "12345678000199"))
        self.assertFalse(_destinatario_valido(xml, "99999999000199"))

    def test_xml_destinado_a_cpf_so_serve_para_seu_proprio_titular(self):
        cpf = "12345678901"
        xml = (
            f'<nfeProc xmlns="{NS}"><NFe><infNFe>'
            f'<dest><CPF>{cpf}</CPF></dest>'
            f'</infNFe></NFe></nfeProc>'
        ).encode()
        self.assertTrue(_destinatario_valido(xml, cpf))
        self.assertFalse(_destinatario_valido(xml, "12345678902"))
        self.assertFalse(_destinatario_valido(xml, "12345678000199"))

    def test_nao_aceita_entidade_externa_ou_gzip_bomb(self):
        xml = b'<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a/>'
        with self.assertRaises(ValueError):
            _xml_seguro(xml)
        zip_bomb = gzip.compress(b"<a>" + b" " * (4 * 1024 * 1024) + b"</a>")
        with self.assertRaises(ValueError):
            _descompactar(base64.b64encode(zip_bomb).decode())


if __name__ == "__main__":
    unittest.main()
