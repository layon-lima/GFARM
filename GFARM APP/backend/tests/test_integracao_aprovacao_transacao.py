"""Aprovação do Controles não pode abrir uma segunda transação no motor.

Regressão para HTTP 500: ao confirmar a pendência, Session.commit() expira
User. A leitura de user.id depois do commit faz autobegin e impede
movimentar_estoque de usar `with db.begin()`.
"""
from decimal import Decimal
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import String, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, mapped_column

from app.api.integracao_recebimentos import Aprovar, aprovar
from app.services.motor_estoque import EstoqueErro


class BaseTeste(DeclarativeBase):
    pass


class UsuarioTeste(BaseTeste):
    __tablename__ = "usuario_aprovacao_transacao_teste"
    id = mapped_column(String, primary_key=True)


class SessaoAprovacao:
    """Reproduz as transações reais enquanto simula os UPDATEs PostgreSQL."""
    def __init__(self, session):
        self.session = session
        self.estados = []

    def get(self, model, identifier):
        return SimpleNamespace(
            id=identifier, nome="Welden", unidade="L",
            unidade_alt=None, fator_conversao=0,
        )

    def execute(self, statement, params=None):
        sql = str(statement)
        if "UPDATE integracao_recebimentos_pendentes" not in sql:
            raise AssertionError("SQL inesperado no teste: " + sql[:100])
        self.estados.append("APROVADO" if "SET status='APROVADO'" in sql
                           else "PENDENTE" if "SET status='PENDENTE'" in sql
                           else "PROCESSANDO")
        return SimpleNamespace(first=lambda: (1,))

    def commit(self):
        return self.session.commit()

    def rollback(self):
        return self.session.rollback()

    def in_transaction(self):
        return self.session.in_transaction()


class AprovarSemTransacaoImplícitaTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        BaseTeste.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.session.add(UsuarioTeste(id="operador-admin"))
        self.session.commit()
        self.usuario = self.session.get(UsuarioTeste, "operador-admin")
        self.db = SessaoAprovacao(self.session)
        self.row = {
            "status": "PENDENTE", "dados": {
                "quantidade": "8000", "unidade": "L",
                "valor_total": "48000", "valor_unitario": "6",
                "numero_nota": "177324", "serie": "1", "chave_acesso": "1"*44,
                "fornecedor": "Fornecedor", "numero_pedido": "P001",
                "cfop": "5102", "ncm": "3808", "lote": "",
                "validade": "",
            },
        }
        self.dados = Aprovar(
            produto_id="produto-1", deposito_id="deposito-1", unidade="L",
            quantidade=Decimal("8000"),
        )

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_antes_do_motor_nao_ha_transacao_aberta_pela_leitura_do_usuario(self):
        chamadas = []

        def motor(db, **kwargs):
            # Se user.id for lido após o COMMIT, esta verificação falha,
            # da mesma forma que o db.begin() do motor real falharia.
            self.assertFalse(db.in_transaction(), "Autobegin antes do motor de estoque")
            self.assertEqual(kwargs["usuario_id"], "operador-admin")
            self.assertEqual(kwargs["tipo_movimento"], "ENTRADA_COMPRA")
            self.assertEqual(kwargs["itens"][0]["custo_unitario"], "6")
            chamadas.append(kwargs)
            with db.session.begin():
                pass
            return SimpleNamespace(id="doc-1")

        with (patch("app.api.integracao_recebimentos._exigir_revisor"),
              patch("app.api.integracao_recebimentos._row", return_value=self.row),
              patch("app.api.integracao_recebimentos.movimentar_estoque", side_effect=motor)):
            resultado = aprovar("controles:receipt:21", self.dados, user=self.usuario, db=self.db)

        self.assertEqual(resultado, {"status": "APROVADO", "documento_estoque_id": "doc-1"})
        self.assertEqual(len(chamadas), 1)
        self.assertEqual(self.db.estados, ["PROCESSANDO", "APROVADO"])

    def test_nf_sem_preco_aprova_usando_media_atuante_no_motor(self):
        self.row["dados"]["valor_total"] = None
        self.row["dados"]["valor_unitario"] = None
        chamados = []

        def motor(db, **kwargs):
            self.assertFalse(db.in_transaction())
            item = kwargs["itens"][0]
            self.assertTrue(item["usar_custo_medio_atual"])
            self.assertEqual(item["origem_custo_recebimento"], "medio_provisorio")
            self.assertNotIn("custo_unitario", item)
            chamados.append(kwargs)
            with db.session.begin():
                pass
            documento = SimpleNamespace(id="doc-sem-preco")
            documento._custo_unitario_entrada = "12.500000"
            return documento

        with (patch("app.api.integracao_recebimentos._exigir_revisor"),
              patch("app.api.integracao_recebimentos._row", return_value=self.row),
              patch("app.api.integracao_recebimentos.movimentar_estoque", side_effect=motor)):
            resultado = aprovar("controles:sem-preco", self.dados, user=self.usuario, db=self.db)
        self.assertEqual(resultado["status"], "APROVADO")
        self.assertEqual(len(chamados), 1)
        self.assertEqual(self.db.estados, ["PROCESSANDO", "APROVADO"])

    def test_nf_sem_valor_e_sem_media_nao_e_bloqueada(self):
        self.row["dados"]["valor_total"] = None
        self.row["dados"]["valor_unitario"] = None

        def motor(db, **kwargs):
            self.assertNotIn("custo_unitario", kwargs["itens"][0])
            with db.session.begin():
                pass
            documento = SimpleNamespace(id="doc-pendente")
            documento._custo_unitario_entrada = "0.000000"
            return documento

        with (patch("app.api.integracao_recebimentos._exigir_revisor"),
              patch("app.api.integracao_recebimentos._row", return_value=self.row),
              patch("app.api.integracao_recebimentos.movimentar_estoque", side_effect=motor)):
            resultado = aprovar("controles:sem-primeiro-preco", self.dados, user=self.usuario, db=self.db)
        self.assertEqual(resultado["status"], "APROVADO")

    def test_nf_com_valor_fiscal_continua_recalculando_pela_entrada(self):
        chamado = []

        def motor(db, **kwargs):
            item = kwargs["itens"][0]
            self.assertEqual(item["custo_unitario"], "6")
            self.assertTrue(item["valorizar_custo_pendente_inicial"])
            chamado.append(item)
            with db.session.begin():
                pass
            return SimpleNamespace(id="doc-preco")

        with (patch("app.api.integracao_recebimentos._exigir_revisor"),
              patch("app.api.integracao_recebimentos._row", return_value=self.row),
              patch("app.api.integracao_recebimentos.movimentar_estoque", side_effect=motor)):
            resultado = aprovar("controles:com-preco", self.dados, user=self.usuario, db=self.db)
        self.assertEqual(resultado["status"], "APROVADO")
        self.assertEqual(len(chamado), 1)

    def test_erro_de_negocio_nao_produz_http_500_nem_marca_aprovado(self):
        with (patch("app.api.integracao_recebimentos._exigir_revisor"),
              patch("app.api.integracao_recebimentos._row", return_value=self.row),
              patch("app.api.integracao_recebimentos.movimentar_estoque",
                    side_effect=EstoqueErro("Depósito ou lote inválido."))):
            with self.assertRaises(HTTPException) as raised:
                aprovar("controles:receipt:22", self.dados, user=self.usuario, db=self.db)
        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("Depósito", raised.exception.detail)
        self.assertEqual(self.db.estados, ["PROCESSANDO", "PENDENTE"])

    def test_aprovado_nao_gera_segunda_movimentacao(self):
        self.row = {"status": "APROVADO", "documento_estoque_id": "doc-existente"}
        with (patch("app.api.integracao_recebimentos._exigir_revisor"),
              patch("app.api.integracao_recebimentos._row", return_value=self.row),
              patch("app.api.integracao_recebimentos.movimentar_estoque") as motor):
            resultado = aprovar("controles:receipt:23", self.dados, user=self.usuario, db=self.db)
        self.assertEqual(resultado["documento_estoque_id"], "doc-existente")
        motor.assert_not_called()


if __name__ == "__main__":
    unittest.main()
