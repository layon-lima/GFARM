"""Custo medio fiscal/provisorio sem reavaliar estoque indevidamente."""
import unittest
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import Produto, EstoqueSaldo, EstoqueDocumento, EstoqueDocumentoItem
from app.services.motor_estoque import (
    _adicionar_saldo,
    _recalcular_produto,
    _valorizar_saldos_sem_custo_inicial,
)


class CustoMedioNotaTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        for model in (Produto, EstoqueSaldo, EstoqueDocumento, EstoqueDocumentoItem):
            model.__table__.create(self.engine)
        self.db = Session(self.engine)
        self.produto = Produto(
            id="produto-1", codigo="P1", nome="Teste", setor_id="s1",
            unidade="L", quantidade=0, custo_unitario=0,
        )
        self.db.add(self.produto)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def adicionar(self, quantidade, custo):
        _adicionar_saldo(
            self.db,
            produto_id=self.produto.id,
            deposito_id="d1",
            gaveta_id="",
            lote_id="",
            quantidade=Decimal(str(quantidade)),
            custo_unitario=Decimal(str(custo)),
        )
        _recalcular_produto(self.db, self.produto.id)
        self.db.flush()

    def test_entrada_sem_preco_adota_media_sem_alterar_ate_nova_nf(self):
        self.adicionar(100, 10)
        self.assertAlmostEqual(self.produto.custo_unitario, 10)
        # Sem valor fiscal: 50 unidades entram ao custo medio vigente.
        self.adicionar(50, self.produto.custo_unitario)
        self.assertAlmostEqual(self.produto.custo_unitario, 10)
        # A NF seguinte tem preco fiscal novo.
        self.adicionar(50, 14)
        self.assertAlmostEqual(self.produto.custo_unitario, 11)
        saldo = self.db.query(EstoqueSaldo).one()
        self.assertEqual(saldo.quantidade, Decimal("200.000"))
        self.assertEqual(saldo.valor_total, Decimal("2200.00"))

    def test_primeira_nf_com_preco_valoriza_quantidade_pendente_sem_diluir_media(self):
        self.adicionar(100, 0)
        documento = EstoqueDocumento(
            id="doc-1", numero="EST-PENDENTE-1", tipo_movimento="ENTRADA_COMPRA",
            status="contabilizado", origem_modulo="controles_recebimentos",
            usuario_id="admin",
        )
        item = EstoqueDocumentoItem(
            id="item-1", documento_id="doc-1", item_numero=1,
            produto_id=self.produto.id, quantidade=Decimal("100"),
            unidade="L", fator_conversao=Decimal("1"), custo_unitario=Decimal("0"),
            valor_total=Decimal("0"),
            observacao="CUSTO_PENDENTE_NF_SEM_PRECO | NF sem preço fiscal",
        )
        self.db.add_all([documento, item])
        self.db.flush()
        self.assertTrue(_valorizar_saldos_sem_custo_inicial(
            self.db, produto=self.produto, custo_fiscal=Decimal("12")
        ))
        self.adicionar(50, 12)
        self.assertAlmostEqual(self.produto.custo_unitario, 12)
        self.assertEqual(self.db.query(EstoqueSaldo).one().valor_total, Decimal("1800.00"))
        self.adicionar(50, 20)
        self.assertAlmostEqual(self.produto.custo_unitario, 14)
        self.assertEqual(self.db.query(EstoqueSaldo).one().valor_total, Decimal("2800.00"))

    def test_nao_reavalia_estoque_zero_sem_pendencia_documentada(self):
        self.adicionar(100, 0)
        self.assertFalse(_valorizar_saldos_sem_custo_inicial(
            self.db, produto=self.produto, custo_fiscal=Decimal("15")
        ))
        self.assertEqual(self.db.query(EstoqueSaldo).one().valor_total, Decimal("0.00"))

    def test_custo_provisorio_nao_reavalia_saldo_antigo(self):
        self.adicionar(100, 10)
        self.assertFalse(_valorizar_saldos_sem_custo_inicial(
            self.db, produto=self.produto, custo_fiscal=Decimal("14")
        ))
        self.assertAlmostEqual(self.produto.custo_unitario, 10)


if __name__ == "__main__":
    unittest.main()
