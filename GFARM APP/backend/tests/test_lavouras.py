import unittest
from unittest.mock import MagicMock

from fastapi import HTTPException

from app.api.entities import (
    _proximo_numero_lavoura,
    _validar_duplicidade_lavoura,
)


class LavourasCadastroTest(unittest.TestCase):
    def test_proximo_numero_ignora_vazios_e_preserva_sequencia(self):
        db = MagicMock()
        db.scalars.return_value.all.return_value = [
            None,
            "",
            "LAV-000003",
            "12",
            "LOTE ANTIGO",
        ]

        self.assertEqual(
            _proximo_numero_lavoura(db),
            "LAV-000013",
        )

    def test_duplicidade_de_nome_retorna_conflito_claro(self):
        db = MagicMock()
        db.scalar.return_value = object()

        with self.assertRaises(HTTPException) as erro:
            _validar_duplicidade_lavoura(
                db,
                {"nome": "Lote 01"},
            )

        self.assertEqual(
            erro.exception.status_code,
            409,
        )
        self.assertIn(
            "Já existe uma lavoura",
            erro.exception.detail,
        )

    def test_nome_novo_permanece_valido(self):
        db = MagicMock()
        db.scalar.return_value = None

        _validar_duplicidade_lavoura(
            db,
            {"nome": "Lote 02"},
        )


if __name__ == "__main__":
    unittest.main()
