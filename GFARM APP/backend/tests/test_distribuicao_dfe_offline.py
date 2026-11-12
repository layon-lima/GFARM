"""Validacoes isoladas: nunca consultam SEFAZ, nunca usam certificados reais."""
import base64
import gzip
import os
import unittest
from unittest.mock import patch

from app.services.distribuicao_dfe import (
    _chave_nfe,
    _descompactar,
    _destinatario_valido,
    _envelope,
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

    def test_nao_aceita_entidade_externa_ou_gzip_bomb(self):
        xml = b'<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a/>'
        with self.assertRaises(ValueError):
            _xml_seguro(xml)
        zip_bomb = gzip.compress(b"<a>" + b" " * (4 * 1024 * 1024) + b"</a>")
        with self.assertRaises(ValueError):
            _descompactar(base64.b64encode(zip_bomb).decode())


if __name__ == "__main__":
    unittest.main()
