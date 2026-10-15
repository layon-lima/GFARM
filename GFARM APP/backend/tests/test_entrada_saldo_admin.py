import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.api.estoque import (
    EntradaManualSaldoRequest,
    MovimentoItemRequest,
    MovimentoRequest,
    _exigir_movimentacao_permitida,
    registrar_entrada_manual_pc,
)
from app.models import User, UserPermission
from app.services.regras_movimento import (
    MOVIMENTOS_ENTRADA,
    MOVIMENTOS_VALIDOS,
    DirecaoMovimento,
    obter_regra_movimento,
)


class EntradaSaldoAdminTest(unittest.TestCase):
    def setUp(self):
        self.admin = User(
            id="admin",
            role="admin",
            username="admin",
            display_name="Admin",
        )
        self.comum = User(
            id="user",
            role="user",
            username="user",
            display_name="Usuario",
        )

    def movimento(self, **overrides):
        dados = {
            "tipo_movimento": "ENTRADA_SALDO_ADMIN",
            "origem_modulo": "movimentacoes",
            "observacao": "Carga inicial conferida pelo administrador.",
            "itens": [
                MovimentoItemRequest(
                    produto_id="produto-1",
                    quantidade=10,
                    unidade="un",
                    deposito_destino_id="deposito-1",
                    gaveta_destino_id="gaveta-1",
                )
            ],
        }
        dados.update(overrides)
        return MovimentoRequest(**dados)

    def test_tipo_pertence_ao_motor_oficial_como_entrada(self):
        regra = obter_regra_movimento("ENTRADA_SALDO_ADMIN")
        self.assertEqual(regra.direcao, DirecaoMovimento.ENTRADA)
        self.assertIn("ENTRADA_SALDO_ADMIN", MOVIMENTOS_VALIDOS)
        self.assertIn("ENTRADA_SALDO_ADMIN", MOVIMENTOS_ENTRADA)

    def test_usuario_comum_e_bloqueado_no_backend(self):
        with self.assertRaises(HTTPException) as erro:
            _exigir_movimentacao_permitida(
                self.movimento(),
                self.comum,
                None,
            )
        self.assertEqual(erro.exception.status_code, 403)

    def test_admin_pode_usar_fluxo_de_movimentos(self):
        _exigir_movimentacao_permitida(
            self.movimento(),
            self.admin,
            None,
        )

    def test_subadmin_com_permissao_pode_usar_modulo_dedicado(self):
        subadmin = User(
            id="subadmin",
            role="subadmin",
            username="subadmin",
            display_name="Sub Admin",
        )
        subadmin.permission_records = [
            UserPermission(
                user_id="subadmin",
                permission_key="admin.estoque.entrada_manual",
                scope_value="",
            )
        ]

        dados = EntradaManualSaldoRequest(
            nome_produto="Produto teste",
            quantidade=10,
            setor_id="setor-1",
            deposito_id="deposito-1",
            unidade="un",
        )

        with patch(
            "app.api.estoque.processar_entrada_manual_saldo",
            return_value={
                "produto_id": "produto-1",
                "produto_criado": False,
                "documento_id": "doc-1",
                "documento_numero": "EST-000001",
            },
        ) as processar:
            resposta = registrar_entrada_manual_pc(
                dados,
                current_user=subadmin,
                db=MagicMock(),
            )

        self.assertEqual(
            resposta["documento"]["id"],
            "doc-1",
        )
        self.assertEqual(
            resposta["produto_id"],
            "produto-1",
        )
        self.assertEqual(
            processar.call_args.kwargs["origem_modulo"],
            "movimentacoes",
        )

    def test_usuario_sem_permissao_nao_acessa_modulo_dedicado(self):
        dados = EntradaManualSaldoRequest(
            nome_produto="Produto teste",
            quantidade=10,
            setor_id="setor-1",
            deposito_id="deposito-1",
            unidade="un",
        )

        with self.assertRaises(HTTPException) as erro:
            registrar_entrada_manual_pc(
                dados,
                current_user=self.comum,
                db=MagicMock(),
            )

        self.assertEqual(
            erro.exception.status_code,
            403,
        )

    def test_documento_fiscal_e_bloqueado(self):
        with self.assertRaises(HTTPException) as erro:
            _exigir_movimentacao_permitida(
                self.movimento(
                    referencia_externa="NF-123"
                ),
                self.admin,
                None,
            )
        self.assertEqual(erro.exception.status_code, 400)

    def test_justificativa_e_obrigatoria(self):
        with self.assertRaises(HTTPException) as erro:
            _exigir_movimentacao_permitida(
                self.movimento(observacao=""),
                self.admin,
                None,
            )
        self.assertEqual(erro.exception.status_code, 400)

    def test_origem_de_estoque_e_bloqueada(self):
        movimento = self.movimento()
        movimento.itens[0].deposito_origem_id = "deposito-antigo"

        with self.assertRaises(HTTPException) as erro:
            _exigir_movimentacao_permitida(
                movimento,
                self.admin,
                None,
            )
        self.assertEqual(erro.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
