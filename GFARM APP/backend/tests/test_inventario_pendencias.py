import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.inventario_pendencias import Registro, Revisao, registrar, revisar, listar
from app.api.users import exigir_admin
from app.models import InventarioForaEstoque, Produto, Deposito, Gaveta, User
from app.services.motor_estoque import EstoqueErro


class PendenciasTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        for model in (InventarioForaEstoque, Produto, Deposito, Gaveta):
            model.__table__.create(self.engine)
        self.db = Session(self.engine)
        self.admin = User(id='admin', role='admin', username='admin', display_name='Admin')
        self.user = User(id='user', role='user', username='user', paginas_permitidas='["inventario"]')
        self.db.add_all([Produto(id='p', codigo='P', nome='Produto', setor_id='s', unidade='un'),
            Deposito(id='d', setor_id='s'), Gaveta(id='g', codigo='G', deposito_id='d')])
        self.db.commit()
        self.item = registrar(Registro(descricao='Encontrado', quantidade=3, unidade='un', foto_url='/uploads/test.jpg'), self.user, self.db)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def dados(self):
        return Revisao(decisao='aprovado', produto_id='p', deposito_id='d', gaveta_id='g')

    def test_registro_pendente_autoria_e_visibilidade(self):
        self.assertEqual(self.item['status'], 'pendente')
        self.assertEqual(self.item['created_by_id'], 'user')
        other = User(id='other', role='user', paginas_permitidas='["inventario"]')
        self.assertEqual(listar(other, self.db), [])

    def test_usuario_comum_nao_revisa(self):
        with self.assertRaises(HTTPException) as error:
            exigir_admin(self.user)
        self.assertEqual(error.exception.status_code, 403)

    @patch('app.api.inventario_pendencias.movimentar_estoque')
    def test_rejeitar_nao_movimenta(self, motor):
        result = revisar(self.item['id'], Revisao(decisao='rejeitado', motivo='Item impróprio'), self.admin, self.db)
        self.assertEqual(result['status'], 'rejeitado')
        motor.assert_not_called()

    @patch('app.api.inventario_pendencias.movimentar_estoque', return_value=SimpleNamespace(id='doc'))
    def test_aprovar_usa_motor_e_bloqueia_repeticao(self, motor):
        result = revisar(self.item['id'], self.dados(), self.admin, self.db)
        self.assertEqual(result['documento_estoque_id'], 'doc')
        self.assertEqual(motor.call_args.kwargs['itens'][0]['quantidade'], 3)
        with self.assertRaises(HTTPException) as error:
            revisar(self.item['id'], self.dados(), self.admin, self.db)
        self.assertEqual(error.exception.status_code, 409)
        motor.assert_called_once()

    @patch('app.api.inventario_pendencias.movimentar_estoque', side_effect=EstoqueErro('Falha de validação'))
    def test_falha_do_motor_mantem_pendente(self, motor):
        with self.assertRaises(HTTPException):
            revisar(self.item['id'], self.dados(), self.admin, self.db)
        self.assertEqual(self.db.get(InventarioForaEstoque, self.item['id']).status, 'pendente')

    @patch('app.api.inventario_pendencias.movimentar_estoque')
    def test_unidade_incompativel_nao_movimenta(self, motor):
        self.db.get(Produto, 'p').unidade = 'kg'
        self.db.commit()
        with self.assertRaises(HTTPException):
            revisar(self.item['id'], self.dados(), self.admin, self.db)
        motor.assert_not_called()


if __name__ == '__main__':
    unittest.main()
