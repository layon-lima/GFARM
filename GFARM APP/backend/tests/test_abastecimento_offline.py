from types import SimpleNamespace
import unittest

from fastapi import HTTPException

from app.api.entities import (
    _abastecimento_mesmo_conteudo,
    _validar_criacao_abastecimento,
)
from app.models import User, UserPermission


class AbastecimentoOfflineTest(unittest.TestCase):
    def test_retry_com_mesmos_dados_e_id_e_idempotente(self):
        existente = SimpleNamespace(
            maquina_id="maq-1",
            produto_id="prod-1",
            quantidade=125.5,
            unidade="l",
            operador="OPERADOR",
            observacao="",
            foto_url="/uploads/foto.jpg",
        )

        dados = {
            "maquina_id": "maq-1",
            "produto_id": "prod-1",
            "quantidade": 125.5,
            "unidade": "l",
            "operador": "OPERADOR",
            "observacao": "",
            "foto_url": "/uploads/foto.jpg",
        }

        self.assertTrue(
            _abastecimento_mesmo_conteudo(
                existente,
                dados,
            )
        )

    def test_abastecimento_sem_foto_exige_permissao(self):
        user = User(
            id="user-1",
            username="user",
            password_hash="hash",
            role="user",
            ativo=True,
        )

        with self.assertRaises(HTTPException) as erro:
            _validar_criacao_abastecimento(
                {
                    "status": "pendente",
                    "foto_url": "",
                },
                user,
            )

        self.assertEqual(
            erro.exception.status_code,
            403,
        )

    def test_permissao_libera_abastecimento_sem_foto(self):
        user = User(
            id="user-1",
            username="user",
            password_hash="hash",
            role="user",
            ativo=True,
        )
        user.permission_records = [
            UserPermission(
                user_id="user-1",
                permission_key="operacao.abastecimento.sem_foto",
                scope_value="",
            )
        ]

        _validar_criacao_abastecimento(
            {
                "status": "pendente",
                "foto_url": "",
            },
            user,
        )

    def test_abastecimento_com_foto_nao_exige_permissao_extra(self):
        user = User(
            id="user-1",
            username="user",
            password_hash="hash",
            role="user",
            ativo=True,
        )

        _validar_criacao_abastecimento(
            {
                "status": "pendente",
                "foto_url": "/uploads/painel.jpg",
            },
            user,
        )

    def test_retry_com_dados_diferentes_nao_e_aceito(self):
        existente = SimpleNamespace(
            maquina_id="maq-1",
            produto_id="prod-1",
            quantidade=100.0,
            unidade="l",
            operador="OPERADOR",
            observacao="",
            foto_url="",
        )

        dados = {
            "maquina_id": "maq-1",
            "produto_id": "prod-1",
            "quantidade": 110.0,
            "unidade": "l",
            "operador": "OPERADOR",
            "observacao": "",
            "foto_url": "",
        }

        self.assertFalse(
            _abastecimento_mesmo_conteudo(
                existente,
                dados,
            )
        )


if __name__ == "__main__":
    unittest.main()
