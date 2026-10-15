import unittest
from decimal import Decimal
from unittest.mock import MagicMock

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.entities import atualizar
from app.models import (
    AuditoriaERP,
    EstoqueSaldo,
    Produto,
    User,
)
from app.services.motor_estoque import (
    EstoqueErro,
    reavaliar_custo_produto,
)


class CustoProdutoSaldoTest(unittest.TestCase):
    def criar_banco(self):
        engine = create_engine(
            "sqlite://"
        )

        for model in (
            Produto,
            EstoqueSaldo,
            AuditoriaERP,
        ):
            model.__table__.create(
                engine
            )

        return engine, Session(engine)

    def test_motor_reavalia_produto_e_todos_os_saldos(self):
        engine, db = self.criar_banco()

        try:
            produto = Produto(
                id="produto-1",
                codigo="P0001",
                nome="Produto teste",
                setor_id="setor-1",
                quantidade=12.5,
                unidade="un",
                custo_unitario=5,
            )
            saldo_a = EstoqueSaldo(
                id="saldo-a",
                produto_id="produto-1",
                deposito_id="dep-1",
                gaveta_id="",
                lote_id="",
                tipo_estoque="livre",
                quantidade=Decimal("10.000"),
                quantidade_reservada=Decimal("0"),
                custo_medio=Decimal("5.000000"),
                valor_total=Decimal("50.00"),
            )
            saldo_b = EstoqueSaldo(
                id="saldo-b",
                produto_id="produto-1",
                deposito_id="dep-2",
                gaveta_id="",
                lote_id="",
                tipo_estoque="livre",
                quantidade=Decimal("2.500"),
                quantidade_reservada=Decimal("0"),
                custo_medio=Decimal("5.000000"),
                valor_total=Decimal("12.50"),
            )

            db.add_all(
                [
                    produto,
                    saldo_a,
                    saldo_b,
                ]
            )
            db.commit()

            produto_atualizado, alterados = (
                reavaliar_custo_produto(
                    db,
                    produto_id="produto-1",
                    novo_custo=Decimal("8.75"),
                )
            )

            self.assertEqual(
                alterados,
                2,
            )
            self.assertEqual(
                produto_atualizado.custo_unitario,
                8.75,
            )
            self.assertEqual(
                saldo_a.custo_medio,
                Decimal("8.750000"),
            )
            self.assertEqual(
                saldo_a.valor_total,
                Decimal("87.50"),
            )
            self.assertEqual(
                saldo_b.custo_medio,
                Decimal("8.750000"),
            )
            self.assertEqual(
                saldo_b.valor_total,
                Decimal("21.88"),
            )
        finally:
            db.close()
            engine.dispose()

    def test_motor_zera_valor_contabil_de_saldo_zerado(self):
        engine, db = self.criar_banco()

        try:
            produto = Produto(
                id="produto-1",
                codigo="P0001",
                nome="Produto teste",
                setor_id="setor-1",
                quantidade=0,
                unidade="un",
                custo_unitario=5,
            )
            saldo = EstoqueSaldo(
                id="saldo-zero",
                produto_id="produto-1",
                deposito_id="dep-1",
                gaveta_id="",
                lote_id="",
                tipo_estoque="livre",
                quantidade=Decimal("0"),
                quantidade_reservada=Decimal("0"),
                custo_medio=Decimal("5.000000"),
                valor_total=Decimal("5.00"),
            )

            db.add_all(
                [
                    produto,
                    saldo,
                ]
            )
            db.commit()

            reavaliar_custo_produto(
                db,
                produto_id="produto-1",
                novo_custo=Decimal("12.34"),
            )

            self.assertEqual(
                produto.custo_unitario,
                12.34,
            )
            self.assertEqual(
                saldo.custo_medio,
                Decimal("0"),
            )
            self.assertEqual(
                saldo.valor_total,
                Decimal("0"),
            )
        finally:
            db.close()
            engine.dispose()

    def test_motor_bloqueia_custo_negativo(self):
        with self.assertRaises(EstoqueErro):
            reavaliar_custo_produto(
                MagicMock(),
                produto_id="produto-1",
                novo_custo=-1,
            )

    def test_endpoint_de_edicao_passa_obrigatoriamente_pelo_motor(self):
        engine, db = self.criar_banco()

        try:
            produto = Produto(
                id="produto-1",
                codigo="P0001",
                nome="Produto teste",
                setor_id="setor-1",
                quantidade=Decimal("12.5"),
                unidade="un",
                custo_unitario=5,
            )
            saldo = EstoqueSaldo(
                id="saldo-a",
                produto_id="produto-1",
                deposito_id="dep-1",
                gaveta_id="",
                lote_id="",
                tipo_estoque="livre",
                quantidade=Decimal("10.000"),
                quantidade_reservada=Decimal("0"),
                custo_medio=Decimal("5.000000"),
                valor_total=Decimal("50.00"),
            )

            db.add_all(
                [
                    produto,
                    saldo,
                ]
            )
            db.commit()

            admin = User(
                id="admin",
                role="admin",
                username="admin",
                display_name="Admin",
            )

            resposta = atualizar(
                "Produto",
                "produto-1",
                {
                    "custo_unitario":
                        7.656,
                },
                admin,
                db,
            )

            self.assertEqual(
                resposta[
                    "custo_unitario"
                ],
                7.656,
            )

            saldo_db = db.get(
                EstoqueSaldo,
                "saldo-a",
            )

            self.assertEqual(
                saldo_db.custo_medio,
                Decimal("7.656000"),
            )
            self.assertEqual(
                saldo_db.valor_total,
                Decimal("76.56"),
            )
        finally:
            db.close()
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
