import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.users import (
    AtualizarPermissoesRequest,
    atualizar_permissoes,
)
from app.core.access_control import (
    permissoes_usuario,
    tem_permissao,
)
from app.models import (
    AuditoriaERP,
    Setor,
    User,
    UserPermission,
)


class PermissoesUsuariosTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")

        for model in (
            User,
            UserPermission,
            Setor,
            AuditoriaERP,
        ):
            model.__table__.create(self.engine)

        self.db = Session(self.engine)

        self.admin = User(
            id="admin",
            username="admin",
            password_hash="hash",
            display_name="Administrador",
            role="admin",
            ativo=True,
        )
        self.alvo = User(
            id="alvo",
            username="alvo",
            password_hash="hash",
            display_name="Alvo",
            role="user",
            ativo=True,
        )
        self.db.add_all([self.admin, self.alvo])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_admin_total_tem_acesso_irrestrito(self):
        self.assertTrue(
            tem_permissao(
                self.admin,
                "admin.backups.criar",
            )
        )
        self.assertEqual(
            permissoes_usuario(self.admin),
            {"*"},
        )

    def test_admin_total_pode_promover_subadmin_com_permissoes_especificas(self):
        resposta = atualizar_permissoes(
            "alvo",
            AtualizarPermissoesRequest(
                role="subadmin",
                permissoes=[
                    "page.cadastros",
                    "admin.usuarios.visualizar",
                    "admin.cadastros_mobile.revisar",
                ],
                setores_permitidos=[],
            ),
            self.admin,
            self.db,
        )

        self.assertEqual(
            resposta["role"],
            "subadmin",
        )
        self.assertIn(
            "admin.usuarios.visualizar",
            resposta["permissoes"],
        )
        self.assertIn(
            "admin.cadastros_mobile.revisar",
            resposta["permissoes"],
        )
        self.assertNotIn(
            "admin.backups.criar",
            resposta["permissoes"],
        )

    def test_usuario_padrao_nao_pode_receber_funcao_administrativa(self):
        with self.assertRaises(HTTPException) as erro:
            atualizar_permissoes(
                "alvo",
                AtualizarPermissoesRequest(
                    role="user",
                    permissoes=[
                        "admin.usuarios.visualizar",
                    ],
                    setores_permitidos=[],
                ),
                self.admin,
                self.db,
            )

        self.assertEqual(
            erro.exception.status_code,
            400,
        )

    def test_permissoes_sao_persistidas_no_banco_central(self):
        atualizar_permissoes(
            "alvo",
            AtualizarPermissoesRequest(
                role="subadmin",
                permissoes=[
                    "page.dashboard",
                    "admin.integridade.visualizar",
                ],
                setores_permitidos=[],
            ),
            self.admin,
            self.db,
        )

        registros = (
            self.db.query(UserPermission)
            .filter(UserPermission.user_id == "alvo")
            .all()
        )

        chaves = {
            item.permission_key
            for item in registros
        }

        self.assertEqual(
            chaves,
            {
                "page.dashboard",
                "admin.integridade.visualizar",
            },
        )


if __name__ == "__main__":
    unittest.main()
