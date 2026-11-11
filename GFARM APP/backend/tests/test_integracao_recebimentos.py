"""Regressões da consulta de recebimentos integrados no GFARM.

A consulta antiga ':status IS NULL OR status = :status' falhava no
PostgreSQL/psycopg: a primeira ocorrência ficava sem tipo inferível.
Estes testes protegem o contrato do endpoint sem precisar de dados reais.
"""
import unittest
from unittest.mock import MagicMock

from fastapi import HTTPException

from app.api.integracao_recebimentos import listar
from app.models import User


class ListarRecebimentosIntegradosTest(unittest.TestCase):
    def setUp(self):
        self.admin = User(
            id="admin-integracao-teste",
            username="admin",
            display_name="Administrador",
            role="admin",
        )

    def test_filtro_status_usa_um_unico_parametro_tipado(self):
        db = MagicMock()
        db.execute.return_value.mappings.return_value.all.return_value = []

        result = listar(status="PENDENTE", user=self.admin, db=db)

        self.assertEqual(result, [])
        query, params = db.execute.call_args.args
        self.assertIn("WHERE status = :status", str(query))
        self.assertNotIn(":status IS NULL", str(query))
        self.assertEqual(params, {"status": "PENDENTE"})

    def test_sem_status_lista_sem_parametro_nulo(self):
        db = MagicMock()
        db.execute.return_value.mappings.return_value.all.return_value = []

        result = listar(status=None, user=self.admin, db=db)

        self.assertEqual(result, [])
        query, params = db.execute.call_args.args
        self.assertNotIn("WHERE status", str(query))
        self.assertNotIn(":status", str(query))
        self.assertEqual(params, {})

    def test_usuario_comum_nao_ve_pendencias(self):
        comum = User(
            id="usuario-comum-integracao",
            username="usuario",
            display_name="Usuário comum",
            role="user",
        )
        db = MagicMock()

        with self.assertRaises(HTTPException) as caught:
            listar(status="PENDENTE", user=comum, db=db)

        self.assertEqual(caught.exception.status_code, 403)
        db.execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
