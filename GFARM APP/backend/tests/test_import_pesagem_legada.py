from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261003_importar_pesagem_legada.py"
)


def carregar_migracao():
    spec = importlib.util.spec_from_file_location(
        "importar_pesagem_legada_20261003",
        MIGRATION,
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ImportacaoPesagemLegadaTest(unittest.TestCase):
    def test_fonte_legada_validada(self):
        migration = carregar_migracao()
        migration._validar_fonte()

    def test_aliases_de_produtos_historicos(self):
        migration = carregar_migracao()

        self.assertIn(
            "MILHO",
            migration._aliases_produto("MILHO A GRANEL"),
        )
        self.assertIn(
            "MILHETO",
            migration._aliases_produto("MILHETO A GRANEL"),
        )
        self.assertIn(
            "CALCARIO AGRICOLA",
            migration._aliases_produto("CALCARIO"),
        )

    def test_quantidades_e_correcao_de_placa(self):
        migration = carregar_migracao()

        tickets = [
            migration._parse_ticket(line)
            for line in migration.TICKETS
        ]
        pagamentos = [
            migration._parse_pagamento(line)
            for line in migration.PAGAMENTOS
        ]

        self.assertEqual(len(tickets), 50)
        self.assertEqual(len(pagamentos), 19)

        ticket_27 = next(
            item
            for item in tickets
            if item["numero"] == "PES-000027"
        )
        self.assertEqual(ticket_27["placa"], "RSM5B03")


if __name__ == "__main__":
    unittest.main()
