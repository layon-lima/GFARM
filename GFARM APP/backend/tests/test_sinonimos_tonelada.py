import unittest
from decimal import Decimal
from types import SimpleNamespace

from app.services.unidades_estoque import converter_quantidade_estoque


class SinonimosToneladaTest(unittest.TestCase):
    def test_tn_t_ton_to_sao_uma_tonelada_no_motor(self):
        produto = SimpleNamespace(nome="Fertilizante", unidade="ton",
                                  unidade_alt=None, fator_conversao=None)
        for alias in ("TN", "Tn", "T", "t", "ton", "TON", "TO", "Toneladas"):
            with self.subTest(alias=alias):
                registro = converter_quantidade_estoque(produto, "48", alias)
                self.assertEqual(registro["quantidade_base"], Decimal("48"))
                self.assertEqual(registro["fator_conversao"], Decimal("1"))

    def test_tn_com_alternativa_t_para_kg_respeita_fator_cadastrado(self):
        produto = SimpleNamespace(nome="Fertilizante", unidade="kg",
                                  unidade_alt="T", fator_conversao=1000)
        registro = converter_quantidade_estoque(produto, "48", "Tn")
        self.assertEqual(registro["quantidade_base"], Decimal("48000"))
        self.assertEqual(registro["fator_conversao"], Decimal("1000"))

    def test_tonelada_nao_vira_kg_sem_fator_cadastrado(self):
        produto = SimpleNamespace(nome="Fertilizante", unidade="kg",
                                  unidade_alt=None, fator_conversao=None)
        with self.assertRaisesRegex(ValueError, "não configurada"):
            converter_quantidade_estoque(produto, "48", "TN")


if __name__ == "__main__":
    unittest.main()
