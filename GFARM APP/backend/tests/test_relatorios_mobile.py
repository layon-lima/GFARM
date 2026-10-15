from types import SimpleNamespace
import unittest

from app.api.relatorios import _resumo_financeiro_pedido


class RelatoriosMobileTest(unittest.TestCase):
    def test_resumo_sem_limite_usa_carga_e_pagamentos_reais(self):
        pedido = SimpleNamespace(
            sem_limite=True,
            peso_saca_kg=60.0,
            valor_saca=61.0,
            valor_total=0.0,
            status="aberto",
        )
        tickets = [
            SimpleNamespace(status="fechado", peso_liquido=1024800.0),
        ]
        pagamentos = [
            SimpleNamespace(valor=970000.0),
        ]

        resumo = _resumo_financeiro_pedido(
            pedido,
            tickets,
            pagamentos,
        )

        self.assertAlmostEqual(resumo["carregado_kg"], 1024800.0)
        self.assertAlmostEqual(resumo["valor_pedido"], 1041880.0)
        self.assertAlmostEqual(resumo["valor_pago"], 970000.0)
        self.assertAlmostEqual(resumo["saldo_receber"], 71880.0)
        self.assertEqual(resumo["status_financeiro"], "Parcial")

    def test_resumo_limitado_pago(self):
        pedido = SimpleNamespace(
            sem_limite=False,
            peso_saca_kg=60.0,
            valor_saca=59.0,
            valor_total=1180000.0,
            status="concluido",
        )
        tickets = [
            SimpleNamespace(status="fechado", peso_liquido=1200000.0),
        ]
        pagamentos = [
            SimpleNamespace(valor=1180000.0),
        ]

        resumo = _resumo_financeiro_pedido(
            pedido,
            tickets,
            pagamentos,
        )

        self.assertAlmostEqual(resumo["valor_pedido"], 1180000.0)
        self.assertAlmostEqual(resumo["valor_pago"], 1180000.0)
        self.assertAlmostEqual(resumo["saldo_receber"], 0.0)
        self.assertEqual(resumo["status_financeiro"], "Pago")


if __name__ == "__main__":
    unittest.main()
