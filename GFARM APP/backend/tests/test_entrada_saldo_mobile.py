import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.entrada_saldo_mobile import (
    AprovarEntradaSaldoMobile,
    _exigir_permissao_mobile,
    _validar_local,
    _validar_setor_usuario,
    aprovar,
    editar_pendente,
    EditarEntradaSaldoMobile,
)
from app.db.database import Base
from app.models import (
    Deposito,
    EntradaSaldoMobilePendente,
    Gaveta,
    Produto,
    Setor,
    User,
)


class EntradaSaldoMobileTest(unittest.TestCase):
    def usuario(self, *, permitido=False, admin=False):
        return User(
            id="user-1",
            username="teste",
            password_hash="hash",
            display_name="Teste",
            role="admin" if admin else "user",
            pode_entrada_manual_saldo_mobile=permitido,
            setores_permitidos='["setor-1"]',
            ativo=True,
        )

    def test_usuario_sem_permissao_e_bloqueado(self):
        with self.assertRaises(HTTPException) as erro:
            _exigir_permissao_mobile(self.usuario())

        self.assertEqual(erro.exception.status_code, 403)

    def test_usuario_habilitado_pode_usar(self):
        _exigir_permissao_mobile(
            self.usuario(permitido=True)
        )

    def test_admin_pode_usar(self):
        _exigir_permissao_mobile(
            self.usuario(admin=True)
        )

    def test_usuario_so_pode_usar_setor_liberado(self):
        user = self.usuario(permitido=True)

        _validar_setor_usuario(
            user,
            "setor-1",
        )

        with self.assertRaises(HTTPException):
            _validar_setor_usuario(
                user,
                "setor-2",
            )

    def _sessao_aprovacao(self):
        engine = create_engine(
            "sqlite+pysqlite:///:memory:"
        )
        Base.metadata.create_all(engine)

        Session = sessionmaker(
            bind=engine,
            autoflush=False,
            autocommit=False,
        )
        db = Session()

        admin = User(
            id="admin-1",
            username="admin",
            password_hash="hash",
            display_name="Administrador",
            role="admin",
            pode_entrada_manual_saldo_mobile=True,
            ativo=True,
        )

        setor = Setor(
            id="setor-1",
            nome="Almoxarifado",
            controla_validade=False,
        )

        deposito = Deposito(
            id="dep-1",
            numero="DEP-01",
            nome="Depósito 01",
            setor_id="setor-1",
        )

        produto = Produto(
            id="produto-1",
            codigo="P0001",
            nome="Produto teste",
            setor_id="setor-1",
            deposito_id="dep-1",
            unidade="un",
            quantidade=0,
            estoque_minimo=0,
            custo_unitario=0,
            venda=False,
        )

        pendencia = EntradaSaldoMobilePendente(
            id="pend-1",
            nome_produto="Produto teste",
            quantidade=12,
            unidade="un",
            setor_id="setor-1",
            deposito_id="dep-1",
            status="PENDENTE",
            solicitante_nome="Usuário Mobile",
            foto_url="/uploads/11111111-1111-1111-1111-111111111111.jpg",
            created_by_id="user-1",
        )

        db.add_all([
            admin,
            setor,
            deposito,
            produto,
            pendencia,
        ])
        db.commit()

        return db, admin

    def _dados_aprovacao(self):
        return AprovarEntradaSaldoMobile(
            nome_produto="Produto teste",
            quantidade=12,
            setor_id="setor-1",
            deposito_id="dep-1",
            gaveta_id=None,
            unidade="un",
            data_validade=None,
        )

    def test_aprovacao_entra_no_motor_sem_transacao_aberta(self):
        db, admin = self._sessao_aprovacao()

        def motor(session, **_kwargs):
            self.assertFalse(
                session.in_transaction(),
                "O motor recebeu uma sessão com transação já aberta.",
            )
            return SimpleNamespace(
                id="doc-1",
                numero="EST-000001",
            )

        with (
            patch(
                "app.api.entrada_saldo_mobile.movimentar_estoque",
                side_effect=motor,
            ),
            patch(
                "app.api.entrada_saldo_mobile.registrar_auditoria",
            ),
        ):
            resposta = aprovar(
                "pend-1",
                self._dados_aprovacao(),
                current_user=admin,
                db=db,
            )

        pendencia = db.get(
            EntradaSaldoMobilePendente,
            "pend-1",
        )

        self.assertEqual(
            pendencia.status,
            "APROVADO",
        )
        self.assertEqual(
            pendencia.documento_estoque_id,
            "doc-1",
        )
        self.assertEqual(
            resposta["documento"]["numero"],
            "EST-000001",
        )

        db.close()

    def test_falha_inesperada_preserva_solicitacao_pendente(self):
        db, admin = self._sessao_aprovacao()

        with (
            patch(
                "app.api.entrada_saldo_mobile.movimentar_estoque",
                side_effect=RuntimeError("falha simulada"),
            ),
            patch(
                "app.api.entrada_saldo_mobile.registrar_auditoria",
            ),
        ):
            with self.assertRaises(HTTPException) as erro:
                aprovar(
                    "pend-1",
                    self._dados_aprovacao(),
                    current_user=admin,
                    db=db,
                )

        self.assertEqual(
            erro.exception.status_code,
            500,
        )

        pendencia = db.get(
            EntradaSaldoMobilePendente,
            "pend-1",
        )

        self.assertEqual(
            pendencia.status,
            "PENDENTE",
        )
        self.assertEqual(
            pendencia.nome_produto,
            "Produto teste",
        )
        self.assertEqual(
            pendencia.quantidade,
            12,
        )
        self.assertEqual(
            pendencia.foto_url,
            "/uploads/11111111-1111-1111-1111-111111111111.jpg",
        )

        db.close()

    def test_gaveta_e_obrigatoria_quando_deposito_tem_gavetas(self):
        db = MagicMock()

        setor = Setor(
            id="setor-1",
            nome="Almoxarifado",
        )
        deposito = Deposito(
            id="dep-1",
            numero="DEP-01",
            setor_id="setor-1",
        )
        gaveta = Gaveta(
            id="gav-1",
            codigo="GAVETA 01",
            deposito_id="dep-1",
        )

        def get(model, item_id):
            if model is Setor and item_id == "setor-1":
                return setor
            if model is Deposito and item_id == "dep-1":
                return deposito
            if model is Gaveta and item_id == "gav-1":
                return gaveta
            return None

        db.get.side_effect = get
        db.scalars.return_value.all.return_value = [
            gaveta
        ]

        with self.assertRaises(HTTPException) as erro:
            _validar_local(
                db,
                setor_id="setor-1",
                deposito_id="dep-1",
                gaveta_id=None,
            )

        self.assertEqual(
            erro.exception.status_code,
            400,
        )
        self.assertIn(
            "gaveta",
            erro.exception.detail.lower(),
        )

        _, _, validada, exige = _validar_local(
            db,
            setor_id="setor-1",
            deposito_id="dep-1",
            gaveta_id="gav-1",
        )

        self.assertTrue(exige)
        self.assertEqual(validada.id, "gav-1")


    def test_edicao_pendente_nao_gera_saldo_e_preserva_foto(self):
        db, admin = self._sessao_aprovacao()
        dados = EditarEntradaSaldoMobile(
            nome_produto="Produto teste",
            quantidade=19.5,
            setor_id="setor-1",
            deposito_id="dep-1",
            unidade="un",
        )
        with (
            patch("app.api.entrada_saldo_mobile.movimentar_estoque") as motor,
            patch("app.api.entrada_saldo_mobile.registrar_auditoria") as auditoria,
        ):
            resposta = editar_pendente(
                "pend-1", dados, current_user=admin, db=db,
            )

        pendencia = db.get(EntradaSaldoMobilePendente, "pend-1")
        self.assertEqual(pendencia.quantidade, 19.5)
        self.assertEqual(pendencia.status, "PENDENTE")
        self.assertIsNone(pendencia.documento_estoque_id)
        self.assertEqual(
            pendencia.foto_url,
            "/uploads/11111111-1111-1111-1111-111111111111.jpg",
        )
        self.assertEqual(resposta["quantidade"], 19.5)
        motor.assert_not_called()
        auditoria.assert_called_once()
        self.assertEqual(auditoria.call_args.kwargs["acao"], "editar")
        db.close()

    def test_nao_edita_solicitacao_ja_aprovada(self):
        db, admin = self._sessao_aprovacao()
        pendencia = db.get(EntradaSaldoMobilePendente, "pend-1")
        pendencia.status = "APROVADO"
        pendencia.documento_estoque_id = "doc-ja-existente"
        db.commit()

        with patch("app.api.entrada_saldo_mobile.movimentar_estoque") as motor:
            with self.assertRaises(HTTPException) as erro:
                editar_pendente(
                    "pend-1",
                    EditarEntradaSaldoMobile(**self._dados_aprovacao().model_dump()),
                    current_user=admin,
                    db=db,
                )
        self.assertEqual(erro.exception.status_code, 409)
        self.assertEqual(db.get(EntradaSaldoMobilePendente, "pend-1").documento_estoque_id, "doc-ja-existente")
        motor.assert_not_called()
        db.close()

    def test_edicao_deve_respeitar_relacao_setor_deposito(self):
        db, admin = self._sessao_aprovacao()
        db.add(Setor(id="setor-2", nome="Outro setor"))
        db.commit()
        dados = EditarEntradaSaldoMobile(
            nome_produto="Produto teste",
            quantidade=40,
            setor_id="setor-2",
            deposito_id="dep-1",
            unidade="un",
        )
        with self.assertRaises(HTTPException) as erro:
            editar_pendente("pend-1", dados, current_user=admin, db=db)
        self.assertEqual(erro.exception.status_code, 400)
        db.rollback()
        pendencia = db.get(EntradaSaldoMobilePendente, "pend-1")
        self.assertEqual(pendencia.status, "PENDENTE")
        self.assertEqual(pendencia.quantidade, 12)
        db.close()


if __name__ == "__main__":
    unittest.main()
