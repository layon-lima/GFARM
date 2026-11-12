"""Um XML da NF-e deve preencher todas as pendencias compativeis,
sem alterar quantidade parcial, aprovar ou chamar o motor de estoque.
"""
import json
import unittest
from decimal import Decimal
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.api.integracao_recebimentos import RecuperarCustoXml, recuperar_custo_xml
from app.models import User
from tests.test_custo_nfe import CHAVE, gerar_xml


class ImportarXmlEmLoteTest(unittest.TestCase):
    def setUp(self):
        self.admin = User(
            id="admin-recebimento-xml",
            username="adm",
            display_name="Administrador",
            role="admin",
        )
        self.payload_a = {
            "chave_acesso": CHAVE,
            "numero_nota": "177390",
            "produto": "ZAFERA WG",
            "codigo_produto": "",
            "quantidade": "100",
            "unidade": "KG",
            "fornecedor": "",
        }
        self.payload_b = {
            "chave_acesso": CHAVE,
            "numero_nota": "177390",
            "produto": "VIANCE",
            "codigo_produto": "",
            "quantidade": "250",
            "unidade": "L",
            "fornecedor": "",
        }
        self.db = MagicMock()
        self.db.execute.return_value.mappings.return_value.all.return_value = [
            {"origem_id": "pedido-produto-a", "dados": self.payload_a},
            {"origem_id": "pedido-produto-b", "dados": self.payload_b},
            {"origem_id": "pedido-incorreto", "dados": {
                **self.payload_b, "produto": "NÃO EXISTE NO XML",
            }},
        ]

    @patch("app.api.integracao_recebimentos._row")
    def test_importacao_unica_atualiza_duas_pendencias_com_protecao(self, mock_row):
        mock_row.return_value = {
            "origem_id": "pedido-produto-a",
            "status": "PENDENTE",
            "dados": self.payload_a,
        }
        result = recuperar_custo_xml(
            "pedido-produto-a",
            RecuperarCustoXml(xml=gerar_xml()),
            user=self.admin,
            db=self.db,
        )
        self.assertEqual(result["itens_atualizados"], 2)
        self.assertEqual(result["origens_atualizadas"], [
            "pedido-produto-a", "pedido-produto-b",
        ])
        self.assertEqual(len(result["nao_identificados"]), 1)
        updates = [
            call for call in self.db.execute.call_args_list
            if "UPDATE integracao_recebimentos_pendentes" in str(call.args[0])
        ]
        self.assertEqual(len(updates), 2)
        atualizados = {
            call.args[1]["origem"]: json.loads(call.args[1]["dados"])
            for call in updates
        }
        self.assertEqual(atualizados["pedido-produto-a"]["quantidade"], "100")
        self.assertEqual(atualizados["pedido-produto-b"]["quantidade"], "250")
        self.assertEqual(atualizados["pedido-produto-a"]["quantidade_xml"], "8000")
        self.assertEqual(atualizados["pedido-produto-b"]["quantidade_xml"], "250")
        self.assertEqual(Decimal(atualizados["pedido-produto-a"]["valor_total"]), Decimal("620"))
        self.assertEqual(Decimal(atualizados["pedido-produto-b"]["valor_total"]), Decimal("11375"))
        self.db.commit.assert_called_once()
        # A rota de importacao NAO deve chamar movimentar_estoque.
        # Apenas UPDATE de JSON de pendencias, sem criar documentos de estoque.
        self.assertTrue(all("status='PENDENTE'" in str(c.args[0]) for c in updates))

    @patch("app.api.integracao_recebimentos._row")
    def test_item_clicado_sem_correspondencia_nao_impede_outros_itens(self, mock_row):
        # O botao do FSist pertence a uma linha da nota, mas o XML pode
        # ter somente os dois outros produtos: importar os validos em lote.
        nao_identificado = {
            **self.payload_a, "produto": "NAO CONSTA NA NOTA",
        }
        self.db.execute.return_value.mappings.return_value.all.return_value = [
            {"origem_id": "pedido-incorreto", "dados": nao_identificado},
            {"origem_id": "pedido-produto-a", "dados": self.payload_a},
            {"origem_id": "pedido-produto-b", "dados": self.payload_b},
        ]
        mock_row.return_value = {
            "origem_id": "pedido-incorreto",
            "status": "PENDENTE",
            "dados": nao_identificado,
        }
        result = recuperar_custo_xml(
            "pedido-incorreto",
            RecuperarCustoXml(xml=gerar_xml()),
            user=self.admin,
            db=self.db,
        )
        self.assertEqual(result["itens_atualizados"], 2)
        self.assertEqual(
            result["origens_atualizadas"],
            ["pedido-produto-a", "pedido-produto-b"],
        )
        self.assertEqual(len(result["nao_identificados"]), 1)
        self.db.commit.assert_called_once()

    @patch("app.api.integracao_recebimentos._row")
    def test_xml_de_outra_chave_nao_modifica_qualquer_item(self, mock_row):
        mock_row.return_value = {
            "origem_id": "pedido-produto-a",
            "status": "PENDENTE",
            "dados": self.payload_a,
        }
        with self.assertRaises(HTTPException) as err:
            recuperar_custo_xml(
                "pedido-produto-a",
                RecuperarCustoXml(xml=gerar_xml(chave="3" * 44)),
                user=self.admin,
                db=self.db,
            )
        self.assertEqual(err.exception.status_code, 422)
        self.db.commit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
