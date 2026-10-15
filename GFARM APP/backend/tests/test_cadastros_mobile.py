import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.api.cadastros_mobile import (
    AprovarSolicitacao,
    CriarSolicitacao,
    RejeitarSolicitacao,
    aprovar,
    criar,
    rejeitar,
)
from app.api.users import exigir_admin
from app.models import (
    AuditoriaERP,
    CadastroMobilePendente,
    Deposito,
    Gaveta,
    Produto,
    Setor,
    User,
)


class CadastrosMobileTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        for model in (
            CadastroMobilePendente,
            AuditoriaERP,
            Produto,
            Deposito,
            Gaveta,
            Setor,
        ):
            model.__table__.create(self.engine)

        self.db = Session(self.engine)
        self.admin = User(
            id="admin",
            role="admin",
            username="admin",
            display_name="Admin",
        )
        self.comum = User(id="user", role="user", username="user")
        self.db.add(Setor(id="setor", nome="Peças"))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def solicitar_produto(self, nome="Filtro móvel"):
        return criar(
            CriarSolicitacao(
                tipo="PRODUTO",
                dados={
                    "nome": nome,
                    "setor_id": "setor",
                    "unidade": "un",
                    "quantidade": 999,
                },
                imagem_url="/uploads/00000000-0000-0000-0000-000000000001.jpg",
            ),
            self.admin,
            self.db,
        )

    def test_usuario_comum_nao_acessa(self):
        with self.assertRaises(HTTPException) as error:
            exigir_admin(self.comum)
        self.assertEqual(error.exception.status_code, 403)

    def test_solicitacao_nao_cria_produto_antes_da_aprovacao(self):
        item = self.solicitar_produto()
        self.assertEqual(item["status"], "PENDENTE")
        self.assertEqual(
            self.db.scalar(select(func.count()).select_from(Produto)),
            0,
        )

    def test_aprovacao_cria_produto_sem_alterar_quantidade(self):
        item = self.solicitar_produto()
        resultado = aprovar(
            item["id"],
            AprovarSolicitacao(),
            self.admin,
            self.db,
        )
        produto = self.db.get(Produto, resultado["registro"]["id"])
        self.assertEqual(produto.quantidade, 0)
        self.assertEqual(
            produto.foto_url,
            "/uploads/00000000-0000-0000-0000-000000000001.jpg",
        )
        self.assertEqual(resultado["solicitacao"]["status"], "APROVADO")

    def test_rejeicao_nao_cria_registro_e_remove_referencia_da_foto(self):
        item = self.solicitar_produto()
        resultado = rejeitar(
            item["id"],
            RejeitarSolicitacao(motivo="Cadastro incompleto"),
            self.admin,
            self.db,
        )
        self.assertEqual(resultado["status"], "REJEITADO")
        self.assertIsNone(resultado["imagem_url"])
        self.assertNotIn("foto_url", resultado["dados"])
        self.assertEqual(
            self.db.scalar(select(func.count()).select_from(Produto)),
            0,
        )

    def test_duplicidade_oficial_bloqueia_nova_solicitacao(self):
        self.db.add(
            Produto(
                id="existente",
                codigo="P0001",
                nome="Filtro móvel",
                setor_id="setor",
            )
        )
        self.db.commit()

        with self.assertRaises(HTTPException) as error:
            self.solicitar_produto()

        self.assertEqual(error.exception.status_code, 409)

    def test_pendencia_duplicada_e_bloqueada(self):
        self.solicitar_produto()

        with self.assertRaises(HTTPException) as error:
            self.solicitar_produto()

        self.assertEqual(error.exception.status_code, 409)

    def test_aprovacao_gera_codigo_sequencial(self):
        self.db.add(
            Produto(
                id="existente",
                codigo="P0041",
                nome="Filtro antigo",
                setor_id="setor",
            )
        )
        self.db.commit()

        item = self.solicitar_produto("Filtro novo")
        resultado = aprovar(
            item["id"],
            AprovarSolicitacao(),
            self.admin,
            self.db,
        )
        self.assertEqual(resultado["registro"]["codigo"], "P0042")


if __name__ == "__main__":
    unittest.main()
