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

    def test_nf_e_faz_conversao_exata_sem_unidade_alt_cadastrada(self):
        produto = SimpleNamespace(
            nome="CALCARIO AGRICOLA DOLOMITICO",
            unidade="kg", unidade_alt=None, fator_conversao=0,
        )
        for unidade in ("TON", "TN", "Tn", "T", "TO", "toneladas"):
            with self.subTest(unidade=unidade):
                convertido = converter_quantidade_estoque(
                    produto, Decimal("47.820"), unidade,
                    permitir_conversao_padrao=True,
                )
                self.assertEqual(convertido["fator_conversao"], Decimal("1000"))
                self.assertEqual(convertido["quantidade_base"], Decimal("47820.000"))

    def test_nf_e_converte_kg_em_ton_sem_alt_e_litros_em_ml(self):
        toneladas = SimpleNamespace(nome="Cal", unidade="ton",
                                     unidade_alt=None, fator_conversao=0)
        conversao = converter_quantidade_estoque(
            toneladas, 1000, "kg", permitir_conversao_padrao=True,
        )
        self.assertEqual(conversao["quantidade_base"], Decimal("1"))
        self.assertEqual(conversao["fator_conversao"], Decimal("0.001"))
        mililitros = SimpleNamespace(nome="Liquido", unidade="ml",
                                     unidade_alt=None, fator_conversao=0)
        conversao = converter_quantidade_estoque(
            mililitros, 2, "L", permitir_conversao_padrao=True,
        )
        self.assertEqual(conversao["quantidade_base"], Decimal("2000"))

    def test_nf_e_nao_inventa_equivalencia_de_caixas_ou_doses(self):
        produto = SimpleNamespace(nome="Produto", unidade="kg",
                                  unidade_alt=None, fator_conversao=0)
        for unidade in ("CX", "SACO", "DOS", "L"):
            with self.subTest(unidade=unidade):
                with self.assertRaises(ValueError):
                    converter_quantidade_estoque(
                        produto, 48, unidade,
                        permitir_conversao_padrao=True,
                    )

    def test_tonelada_nao_vira_kg_sem_fator_cadastrado(self):
        produto = SimpleNamespace(nome="Fertilizante", unidade="kg",
                                  unidade_alt=None, fator_conversao=None)
        with self.assertRaisesRegex(ValueError, "não configurada"):
            converter_quantidade_estoque(produto, "48", "TN")


if __name__ == "__main__":
    unittest.main()
