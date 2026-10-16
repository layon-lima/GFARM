import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.entities import (
    _cadastro_rapido_pesagem_permitido,
    _validar_duplicidade_cadastro_rapido,
)
from app.models import Pessoa, Veiculo


class CadastroRapidoPesagemTest(unittest.TestCase):
    def test_usuario_da_balanca_pode_criar_apenas_perfil_minimo(self):
        with patch("app.api.entities.tem_pagina", side_effect=lambda _user, pagina: pagina == "pesagem"):
            self.assertTrue(_cadastro_rapido_pesagem_permitido(
                object(), "Pessoa",
                {"nome": "João", "is_cliente": False, "is_motorista": True},
                criacao=True,
            ))
            self.assertTrue(_cadastro_rapido_pesagem_permitido(
                object(), "Veiculo", {"placa": "ABC1D23"},
                criacao=True,
            ))

    def test_usuario_da_balanca_nao_pode_fazer_edicao_geral(self):
        with patch("app.api.entities.tem_pagina", side_effect=lambda _user, pagina: pagina == "pesagem"):
            with self.assertRaises(HTTPException) as erro:
                _cadastro_rapido_pesagem_permitido(
                    object(), "Pessoa", {"nome": "Trocar nome"}, criacao=False,
                )
            self.assertEqual(erro.exception.status_code, 403)
            with self.assertRaises(HTTPException):
                _cadastro_rapido_pesagem_permitido(
                    object(), "Veiculo", {"placa": "ABC1D23"}, criacao=False,
                )
            with self.assertRaises(HTTPException):
                _cadastro_rapido_pesagem_permitido(
                    object(), "Pessoa", {"nome": "Exemplo", "is_cliente": True}, criacao=True,
                )

    def test_habilita_um_perfil_sem_poder_apagar_outros(self):
        with patch("app.api.entities.tem_pagina", side_effect=lambda _user, pagina: pagina == "pesagem"):
            self.assertTrue(_cadastro_rapido_pesagem_permitido(
                object(), "Pessoa", {"is_fornecedor": True}, criacao=False,
            ))
            with self.assertRaises(HTTPException):
                _cadastro_rapido_pesagem_permitido(
                    object(), "Pessoa", {"is_motorista": False}, criacao=False,
                )

    def test_duplicidade_usa_pessoas_e_veiculos_oficiais(self):
        engine = create_engine("sqlite://")
        Pessoa.__table__.create(engine)
        Veiculo.__table__.create(engine)
        try:
            with Session(engine) as db:
                db.add(Pessoa(id="p1", nome="João da Silva", documento="123.456.789-00"))
                db.add(Veiculo(id="v1", placa="ABC-1D23"))
                db.commit()
                with self.assertRaises(HTTPException) as erro:
                    _validar_duplicidade_cadastro_rapido(
                        db, "Pessoa", {"nome": "Outro", "documento": "12345678900"},
                    )
                self.assertEqual(erro.exception.status_code, 409)
                with self.assertRaises(HTTPException):
                    _validar_duplicidade_cadastro_rapido(
                        db, "Veiculo", {"placa": "abc1d23"},
                    )
                with self.assertRaises(HTTPException) as vinculo:
                    _validar_duplicidade_cadastro_rapido(
                        db, "Veiculo", {"placa": "ZZZ1A23", "motorista_id": "p1"},
                    )
                self.assertEqual(vinculo.exception.status_code, 422)
                # Homônimo com documento distinto não é o mesmo registro.
                _validar_duplicidade_cadastro_rapido(
                    db, "Pessoa", {"nome": "JOAO DA SILVA", "documento": "98765432100"},
                )
        finally:
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
