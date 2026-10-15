import unittest

from fastapi import HTTPException

from app.api.entities import _validar_maquina_sem_deposito


class MaquinaSemDepositoTest(unittest.TestCase):
    def test_rejeita_vinculo_de_deposito(self):
        dados = {
            "nome": "Trator",
            "deposito_id": "deposito-1",
        }

        with self.assertRaises(HTTPException) as erro:
            _validar_maquina_sem_deposito(dados)

        self.assertEqual(erro.exception.status_code, 400)
        self.assertEqual(
            erro.exception.detail,
            "Máquinas não possuem vínculo com depósito.",
        )

    def test_remove_campo_vazio_do_payload(self):
        dados = {
            "nome": "Trator",
            "deposito_id": "",
        }

        _validar_maquina_sem_deposito(dados)

        self.assertNotIn("deposito_id", dados)

    def test_payload_sem_deposito_permanece_valido(self):
        dados = {
            "nome": "Trator",
            "permite_abastecimento": True,
        }

        _validar_maquina_sem_deposito(dados)

        self.assertEqual(dados["nome"], "Trator")


if __name__ == "__main__":
    unittest.main()
