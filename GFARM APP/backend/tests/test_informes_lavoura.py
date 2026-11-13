"""Regressões do informe de saída sem criar OS ou contabilidade paralela."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api.informes_lavoura import (
    CriarInforme, DadosInforme, RecusarInforme,
    _itens_para_motor, aprovar, custos_administrador, editar,
    minhas, recusar, solicitar,
)
from app.db.database import Base
from app.models import (
    Deposito, EstoqueSaldo, InformeSaidaLavoura,
    Lavoura, Produto, Setor, User,
)


class InformeSaidaLavouraTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine, autoflush=False)()
        self.user = User(
            id="solicitante", username="operador", password_hash="hash",
            display_name="Operador", role="user", ativo=True,
        )
        self.adm = User(
            id="administrador", username="admin", password_hash="hash",
            display_name="ADM", role="admin", ativo=True,
        )
        self.lavoura = Lavoura(id="lav-1", nome="Lavoura Teste", numero="LAV-001", hectares=100)
        self.setor = Setor(id="setor-def", nome="DEFENSIVOS")
        self.deposito = Deposito(id="dep-1", numero="DEP 01", setor_id="setor-def")
        self.produto = Produto(
            id="prod-1", nome="Defensivo A", codigo="D-001",
            setor_id="setor-def", unidade="L", quantidade=0,
        )
        self.saldo = EstoqueSaldo(
            id="saldo-1", produto_id="prod-1", deposito_id="dep-1",
            gaveta_id="", lote_id="", tipo_estoque="livre",
            quantidade=20, quantidade_reservada=0,
            custo_medio=50, valor_total=1000,
        )
        self.db.add_all([
            self.user, self.adm, self.lavoura,
            self.setor, self.deposito, self.produto, self.saldo,
        ])
        self.db.commit()
        self.permission = patch(
            "app.api.informes_lavoura.tem_permissao", return_value=True
        )
        self.sectors = patch(
            "app.api.informes_lavoura.setores_mobile_ids", return_value={"setor-def"}
        )
        self.audit = patch("app.api.informes_lavoura.registrar_auditoria")
        self.permission.start()
        self.sectors.start()
        self.audit.start()
        self.addCleanup(self.permission.stop)
        self.addCleanup(self.sectors.stop)
        self.addCleanup(self.audit.stop)
        self.addCleanup(self.db.close)

    def dados(self, quantidade="5", deposito=None):
        return DadosInforme(
            lavoura_id="lav-1",
            itens=[{
                "produto_id": "prod-1",
                "quantidade": quantidade,
                "deposito_id": deposito,
            }],
            observacao="Levar para aplicação",
        )

    def criar(self):
        return solicitar(
            CriarInforme(chave=uuid4(), **self.dados().model_dump()),
            user=self.user, db=self.db,
        )

    def test_solicitar_so_cria_pendencia_sem_mover_estoque(self):
        with patch("app.api.informes_lavoura.movimentar_estoque") as motor:
            result = self.criar()
        self.assertEqual(result["status"], "PENDENTE")
        self.assertEqual(result["lavoura_nome"], "Lavoura Teste")
        self.assertEqual(result["itens"][0]["quantidade"], "5")
        self.assertIsNone(result["documento_estoque_id"])
        self.assertEqual(self.db.get(EstoqueSaldo, "saldo-1").quantidade, 20)
        motor.assert_not_called()

    def test_chave_reenviada_nao_cria_nova_solicitacao(self):
        chave = uuid4()
        dados = CriarInforme(chave=chave, **self.dados().model_dump())
        primeiro = solicitar(dados, user=self.user, db=self.db)
        segundo = solicitar(dados, user=self.user, db=self.db)
        self.assertEqual(primeiro["id"], segundo["id"])
        self.assertEqual(len(self.db.scalars(select(InformeSaidaLavoura)).all()), 1)

    def test_editar_nao_mexe_em_saldo(self):
        item_id = self.criar()["id"]
        with patch("app.api.informes_lavoura.movimentar_estoque") as motor:
            result = editar(item_id, self.dados("7"), user=self.adm, db=self.db)
        self.assertEqual(result["status"], "PENDENTE")
        self.assertEqual(result["itens"][0]["quantidade"], "7")
        self.assertEqual(self.db.get(EstoqueSaldo, "saldo-1").quantidade, 20)
        motor.assert_not_called()

    def test_recusar_nao_mexe_em_saldo_e_bloqueia_edicao(self):
        item_id = self.criar()["id"]
        recusar(item_id, RecusarInforme(motivo="Saída cancelada"), user=self.adm, db=self.db)
        self.assertEqual(self.db.get(InformeSaidaLavoura, item_id).status, "RECUSADO")
        with self.assertRaises(HTTPException) as ctx:
            editar(item_id, self.dados(), user=self.adm, db=self.db)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(self.db.get(EstoqueSaldo, "saldo-1").quantidade, 20)

    def test_saldo_insuficiente_bloqueia_aprovacao(self):
        item_id = self.criar()["id"]
        editar(item_id, self.dados("50"), user=self.adm, db=self.db)
        with self.assertRaises(HTTPException) as ctx:
            aprovar(item_id, user=self.adm, db=self.db)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(self.db.get(InformeSaidaLavoura, item_id).status, "PENDENTE")

    def test_multiplos_locais_exigem_origem(self):
        self.db.add(Deposito(id="dep-2", numero="DEP 02", setor_id="setor-def"))
        self.db.add(EstoqueSaldo(
            id="saldo-2", produto_id="prod-1", deposito_id="dep-2",
            gaveta_id="", lote_id="", tipo_estoque="livre",
            quantidade=7, quantidade_reservada=0, custo_medio=55, valor_total=385,
        ))
        self.db.commit()
        item = InformeSaidaLavoura(
            id=str(uuid4()), lavoura_id="lav-1", lavoura_nome="Lavoura Teste",
            itens=[{"produto_id": "prod-1", "quantidade": "5"}], status="PENDENTE",
        )
        self.db.add(item)
        self.db.commit()
        with self.assertRaises(HTTPException) as ctx:
            _itens_para_motor(self.db, item)
        self.assertEqual(ctx.exception.status_code, 409)

    def test_aprovacao_chama_motor_sem_transacao_aberta(self):
        item_id = self.criar()["id"]
        def motor(session, **kwargs):
            self.assertFalse(session.in_transaction())
            self.assertEqual(kwargs["tipo_movimento"], "SAIDA_CONSUMO")
            self.assertEqual(kwargs["origem_modulo"], "informe_lavoura")
            self.assertEqual(kwargs["documento_origem_id"], item_id)
            self.assertEqual(kwargs["itens"][0]["deposito_origem_id"], "dep-1")
            return SimpleNamespace(id="doc-gerado")

        with patch("app.api.informes_lavoura.movimentar_estoque", side_effect=motor):
            result = aprovar(item_id, user=self.adm, db=self.db)
        self.assertEqual(result["status"], "APROVADO")
        self.assertEqual(result["documento_estoque_id"], "doc-gerado")
        with self.assertRaises(HTTPException) as ctx:
            aprovar(item_id, user=self.adm, db=self.db)
        self.assertEqual(ctx.exception.status_code, 409)

    def test_custos_bloqueados_para_usuario_comum(self):
        with self.assertRaises(HTTPException) as ctx:
            custos_administrador(user=self.user, db=self.db)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_resumo_da_solicitacao_nao_expoe_custos(self):
        self.criar()
        result = minhas(user=self.user, db=self.db)
        self.assertEqual(len(result), 1)
        self.assertNotIn("custo_total", result[0])
        self.assertNotIn("custo_unitario", result[0])
        self.assertNotIn("valor_total", result[0])


if __name__ == "__main__":
    unittest.main()
