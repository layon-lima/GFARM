import base64
import unittest
from decimal import Decimal

from app.services.custo_nfe import (
    DadosFiscaisIncompativeis,
    custo_unitario_na_base,
    extrair_custo_xml,
)


CHAVE = "2" * 44


def gerar_xml(*, chave=CHAVE, numero="177390", produtos=None):
    produtos = produtos or [
        ("A001", "ZAFERA WG", "8000", "KG", "6.20", "49600.00"),
        ("A002", "VIANCE", "250", "L", "45.50", "11375.00"),
    ]
    linhas = []
    for i, (codigo, nome, quantidade, unidade, unitario, total) in enumerate(produtos, 1):
        linhas.append(
            f'<det nItem="{i}"><prod><cProd>{codigo}</cProd>'
            f'<xProd>{nome}</xProd><qCom>{quantidade}</qCom>'
            f'<uCom>{unidade}</uCom><vUnCom>{unitario}</vUnCom>'
            f'<vProd>{total}</vProd><CFOP>5102</CFOP>'
            f'<NCM>38089999</NCM></prod></det>'
        )
    xml = (
        f'<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">'
        f'<NFe><infNFe Id="NFe{chave}">'
        f'<ide><nNF>{numero}</nNF><serie>1</serie></ide>'
        f'{"".join(linhas)}</infNFe></NFe></nfeProc>'
    )
    return base64.b64encode(xml.encode()).decode("ascii")


def recebimento(**extra):
    return {
        "numero_nota": "177390",
        "chave_acesso": CHAVE,
        "produto": "Zafera",
        "codigo_produto": "",
        "quantidade": "8000",
        "unidade": "kg",
        **extra,
    }


class CustoNfeTest(unittest.TestCase):
    def test_custo_total_da_nf_e_tem_prioridade_e_converte_unidade(self):
        custo = custo_unitario_na_base(
            {"quantidade": "8000", "valor_total": "49600.00",
             "valor_unitario": "99.00"}, Decimal("1000")
        )
        self.assertEqual(custo, Decimal("0.0062"))

    def test_fallback_unitario_fiscal_se_total_ausente(self):
        custo = custo_unitario_na_base(
            {"quantidade": "8000", "valor_unitario": "6.20"}, Decimal("1")
        )
        self.assertEqual(custo, Decimal("6.20"))

    def test_nao_presume_custo_zero_sem_xml(self):
        with self.assertRaisesRegex(DadosFiscaisIncompativeis, "XML"):
            custo_unitario_na_base({"quantidade": "100"}, Decimal("1"))

    def test_xml_recupera_preco_e_nao_mistura_produtos(self):
        result = extrair_custo_xml(gerar_xml(), recebimento())
        self.assertEqual(Decimal(result["valor_unitario"]), Decimal("6.20"))
        self.assertEqual(Decimal(result["valor_total"]), Decimal("49600"))
        self.assertEqual(result["codigo_produto"], "A001")
        self.assertEqual(result["custo_origem"], "xml_conferido")
        viance = extrair_custo_xml(
            gerar_xml(), recebimento(produto="Viance", quantidade="250", unidade="L")
        )
        self.assertEqual(Decimal(viance["valor_unitario"]), Decimal("45.5"))
        self.assertEqual(Decimal(viance["valor_total"]), Decimal("11375"))

    def test_xml_respeita_quantidade_parcial(self):
        result = extrair_custo_xml(gerar_xml(), recebimento(quantidade="100"))
        self.assertEqual(Decimal(result["valor_total"]), Decimal("620"))
        self.assertEqual(Decimal(result["valor_unitario"]), Decimal("6.2"))

    def test_xml_converte_unidade_nota_em_unidade_do_recebimento(self):
        xml = gerar_xml(produtos=[
            ("A01", "WELDEN", "8", "T", "6200", "49600")
        ])
        result = extrair_custo_xml(xml, recebimento(
            produto="WELDEN", quantidade="8000", unidade="kg",
        ))
        self.assertEqual(Decimal(result["valor_unitario"]), Decimal("6.2"))

    def test_xml_agrupa_linhas_repetidas_com_preco_medio(self):
        xml = gerar_xml(produtos=[
            ("A01", "WELDEN", "10", "L", "20", "200"),
            ("A01", "WELDEN", "30", "L", "30", "900"),
        ])
        result = extrair_custo_xml(xml, recebimento(
            produto="WELDEN", quantidade="40", unidade="L"
        ))
        self.assertEqual(Decimal(result["valor_unitario"]), Decimal("27.5"))
        self.assertEqual(Decimal(result["valor_total"]), Decimal("1100"))

    def test_xml_rejeita_nota_ou_produto_diferente(self):
        with self.assertRaisesRegex(DadosFiscaisIncompativeis, "chave diferente"):
            extrair_custo_xml(gerar_xml(chave="3"*44), recebimento())
        with self.assertRaisesRegex(DadosFiscaisIncompativeis, "número"):
            extrair_custo_xml(gerar_xml(numero="9999"), recebimento())
        with self.assertRaisesRegex(DadosFiscaisIncompativeis, "Produto não identificado"):
            extrair_custo_xml(gerar_xml(), recebimento(produto="SEM CORRESPONDENCIA"))

    def test_xml_rejeita_unidade_sem_equivalencia(self):
        xml = gerar_xml(produtos=[("A01","ZAFFERA","10","CX","200","2000")])
        with self.assertRaisesRegex(DadosFiscaisIncompativeis, "converter CX"):
            extrair_custo_xml(xml, recebimento(produto="ZAFFERA", unidade="kg"))

    def test_xml_reconhece_abreviacao_final_de_mbio_brady_sem_misturar_produtos(self):
        xml = gerar_xml(produtos=[
            ("MB001", "MBIO BRAD", "9280", "DOS", "12.50", "116000"),
        ])
        recebido = recebimento(
            produto="MBIO Brady", quantidade="9280", unidade="DOS",
        )
        fiscal = extrair_custo_xml(xml, recebido)
        self.assertEqual(fiscal["produto_xml"], "MBIO BRAD")
        self.assertEqual(Decimal(fiscal["valor_unitario"]), Decimal("12.5"))
        self.assertEqual(Decimal(fiscal["valor_total"]), Decimal("116000"))

    def test_xml_aceita_dos_e_dose_mas_nao_presume_dose_igual_unidade(self):
        xml = gerar_xml(produtos=[
            ("MB001", "MBIO BRADY", "9280", "DOSE", "12.50", "116000"),
        ])
        fiscal = extrair_custo_xml(
            xml, recebimento(produto="MBIO BRADY", quantidade="9280", unidade="DOS"),
        )
        self.assertEqual(Decimal(fiscal["valor_unitario"]), Decimal("12.5"))
        with self.assertRaisesRegex(DadosFiscaisIncompativeis, "converter DOSE para UN"):
            extrair_custo_xml(
                xml, recebimento(produto="MBIO BRADY", quantidade="9280", unidade="UN"),
            )

    def test_nome_fiscal_diferente_encontra_produto_por_quantidade_unidade_unicas(self):
        # Situação realista: Controles usa nome comercial; XML usa nome científico.
        xml = gerar_xml(produtos=[
            ("IN001", "BRADYRHIZOBIUM JAPONICUM INOCULANTE", "9280", "DOSE", "5.25", "48720"),
            ("IN002", "FERTILIZANTE FOLIAR", "850", "L", "8", "6800"),
        ])
        dados = recebimento(
            produto="MBIO Brady", quantidade="9280.000", unidade="DOS",
        )
        with self.assertRaisesRegex(DadosFiscaisIncompativeis, "Produto não identificado"):
            extrair_custo_xml(xml, dados)
        fiscal = extrair_custo_xml(xml, dados, permitir_correspondencia_quantidade=True)
        self.assertEqual(fiscal["produto_xml"], "BRADYRHIZOBIUM JAPONICUM INOCULANTE")
        self.assertEqual(fiscal["identificacao_fiscal"], "quantidade_e_unidade_unicas")
        self.assertEqual(Decimal(fiscal["valor_unitario"]), Decimal("5.25"))
        self.assertEqual(Decimal(fiscal["valor_total"]), Decimal("48720"))
        self.assertEqual(fiscal["quantidade_xml"], "9280")

    def test_quantidade_duplicada_no_xml_nao_associa_produto_sem_nome(self):
        xml = gerar_xml(produtos=[
            ("IN001", "BRADYRHIZOBIUM JAPONICUM", "9280", "DOS", "5", "46400"),
            ("IN002", "BACTERIA INOCULANTE", "9280", "DOS", "7", "64960"),
        ])
        with self.assertRaisesRegex(DadosFiscaisIncompativeis, "Produto não identificado"):
            extrair_custo_xml(xml, recebimento(
                produto="MBIO Brady", quantidade="9280", unidade="DOS",
            ), permitir_correspondencia_quantidade=True)

    def test_xml_aplica_validade_quando_rastreio_existe_e_nao_inventa_quando_ausente(self):
        xml = base64.b64decode(gerar_xml(produtos=[
            ("IN001", "BRADYRHIZOBIUM JAPONICUM", "9280", "DOS", "5", "46400"),
        ])).decode("utf-8")
        dados = recebimento(produto="MBIO Brady", quantidade="9280", unidade="DOS")
        sem_validade = extrair_custo_xml(
            base64.b64encode(xml.encode()).decode(),
            dados, permitir_correspondencia_quantidade=True,
        )
        self.assertNotIn("validade", sem_validade)
        com_validade_xml = xml.replace(
            "</prod>", "<rastro><nLote>LOTE-X</nLote>"
            "<dVal>2027-12-31</dVal></rastro></prod>",
        )
        com_validade = extrair_custo_xml(
            base64.b64encode(com_validade_xml.encode()).decode(),
            dados, permitir_correspondencia_quantidade=True,
        )
        self.assertEqual(com_validade["validade"], "2027-12-31")
        self.assertEqual(com_validade["lote"], "LOTE-X")

    def test_xml_rejeita_documento_com_dtd(self):
        xml = b'<!DOCTYPE x [<!ENTITY secret "INSEGURO">]><x/>'
        with self.assertRaisesRegex(DadosFiscaisIncompativeis, "proibido"):
            extrair_custo_xml(base64.b64encode(xml).decode(), recebimento())

    def test_xml_traz_metadados_do_emitente_item_e_rastreio(self):
        xml = base64.b64decode(gerar_xml()).decode("utf-8")
        xml = xml.replace(
            "<serie>1</serie>",
            "<serie>1</serie><dhEmi>2026-10-22T11:45:00-03:00</dhEmi>",
        )
        xml = xml.replace(
            "</ide>",
            "</ide><emit><CNPJ>12345678000199</CNPJ>"
            "<xNome>AGREX AGROINDUSTRIAL LTDA</xNome></emit>",
        )
        xml = xml.replace(
            "<NCM>38089999</NCM></prod></det>",
            "<NCM>38089999</NCM><rastro><nLote>LOTE-22</nLote>"
            "<dVal>2027-12-31</dVal></rastro></prod></det>",
            1,
        )
        fiscal = extrair_custo_xml(
            base64.b64encode(xml.encode()).decode(),
            recebimento(produto="ZAFERA WG"),
        )
        self.assertEqual(fiscal["fornecedor"], "AGREX AGROINDUSTRIAL LTDA")
        self.assertEqual(fiscal["documento_fornecedor"], "12345678000199")
        self.assertEqual(fiscal["serie"], "1")
        self.assertEqual(fiscal["data_emissao"], "2026-10-22")
        self.assertEqual(fiscal["codigo_produto"], "A001")
        self.assertEqual(fiscal["cfop"], "5102")
        self.assertEqual(fiscal["ncm"], "38089999")
        self.assertEqual(fiscal["quantidade_xml"], "8000")
        self.assertEqual(fiscal["itens_xml"], ["1"])
        self.assertEqual(fiscal["validade"], "2027-12-31")
        self.assertEqual(fiscal["lote"], "LOTE-22")

    def test_xml_nao_sobrescreve_quantidade_parcial_e_validade_ja_informada(self):
        xml = base64.b64decode(gerar_xml()).decode("utf-8")
        xml = xml.replace(
            "<NCM>38089999</NCM></prod></det>",
            "<NCM>38089999</NCM><rastro><nLote>ABC</nLote>"
            "<dVal>2027-12-31</dVal></rastro></prod></det>",
            1,
        )
        fiscal = extrair_custo_xml(
            base64.b64encode(xml.encode()).decode(),
            recebimento(produto="ZAFERA WG", quantidade="100", validade="2028-01-01"),
        )
        self.assertEqual(fiscal["quantidade_xml"], "8000")
        self.assertNotIn("quantidade", fiscal)
        self.assertNotIn("validade", fiscal)
        self.assertEqual(Decimal(fiscal["valor_total"]), Decimal("620"))



if __name__ == "__main__":
    unittest.main()
