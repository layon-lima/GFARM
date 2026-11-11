"""Leitura defensiva de valores de produto em XML NF-e para pendências do GFARM.

Não baixa notas da internet nem presume custo: somente XML fornecido pelo
revisor, com chave/número confirmados e item identificado sem ambiguidade.
"""
from __future__ import annotations

import base64
import binascii
from decimal import Decimal, InvalidOperation
import re
import unicodedata
from xml.etree import ElementTree as ET


MAX_XML_BYTES = 3 * 1024 * 1024

UNIDADES = {
    "KG": ("peso", Decimal("1")),
    "QUILO": ("peso", Decimal("1")),
    "QUILOGRAMA": ("peso", Decimal("1")),
    "G": ("peso", Decimal("0.001")),
    "GR": ("peso", Decimal("0.001")),
    "T": ("peso", Decimal("1000")),
    "TON": ("peso", Decimal("1000")),
    "TONELADA": ("peso", Decimal("1000")),
    "L": ("volume", Decimal("1")),
    "LT": ("volume", Decimal("1")),
    "LITRO": ("volume", Decimal("1")),
    "ML": ("volume", Decimal("0.001")),
    "UN": ("un", Decimal("1")),
    "UND": ("un", Decimal("1")),
    "UNID": ("un", Decimal("1")),
    "UNIDADE": ("un", Decimal("1")),
}


class DadosFiscaisIncompativeis(ValueError):
    pass


def _normalizar(valor):
    raw = unicodedata.normalize("NFKD", str(valor or "").strip())
    raw = "".join(c for c in raw if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", raw.upper()).split())


def _text(parent, tag):
    if parent is None:
        return ""
    for child in parent:
        if child.tag.rsplit("}", 1)[-1] == tag:
            return (child.text or "").strip()
    return ""


def _element(parent, tag):
    if parent is None:
        return None
    for child in parent:
        if child.tag.rsplit("}", 1)[-1] == tag:
            return child
    return None


def _decimal(value, campo):
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise DadosFiscaisIncompativeis(f"XML sem {campo} numérico válido.") from None
    if not d.is_finite() or d <= 0:
        raise DadosFiscaisIncompativeis(f"XML com {campo} inválido.")
    return d


def _quantidade_convertida(quantidade, unidade_xml, unidade_recebimento):
    x, y = _normalizar(unidade_xml), _normalizar(unidade_recebimento)
    if x == y:
        return quantidade
    origem, destino = UNIDADES.get(x), UNIDADES.get(y)
    if not origem or not destino or origem[0] != destino[0]:
        raise DadosFiscaisIncompativeis(
            f"Não é possível converter {unidade_xml} para {unidade_recebimento} "
            "com segurança. Confira a unidade/custo da nota."
        )
    return quantidade * origem[1] / destino[1]


def extrair_custo_xml(xml_base64: str, dados: dict) -> dict:
    """Preço na unidade do recebimento, validado contra a mesma NF-e."""
    if not isinstance(xml_base64, str) or len(xml_base64) > MAX_XML_BYTES * 4 // 3 + 100:
        raise DadosFiscaisIncompativeis("XML ausente ou maior que 3 MB.")
    try:
        raw = base64.b64decode(xml_base64, validate=True)
    except (binascii.Error, ValueError):
        raise DadosFiscaisIncompativeis("Arquivo XML inválido.") from None
    if len(raw) > MAX_XML_BYTES or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise DadosFiscaisIncompativeis("XML inválido ou com conteúdo proibido.")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        raise DadosFiscaisIncompativeis("Não foi possível interpretar o XML da NF-e.") from None

    nfe = next((node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "infNFe"), None)
    if nfe is None:
        raise DadosFiscaisIncompativeis("O arquivo não contém uma NF-e.")
    ide = _element(nfe, "ide")
    numero = _text(ide, "nNF")
    chave = str(nfe.attrib.get("Id", ""))
    chave = chave[3:] if chave.startswith("NFe") else ""
    if not chave:
        prot = next((node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "protNFe"), None)
        chave = _text(_element(prot, "infProt"), "chNFe")
    chave_esperada = str(dados.get("chave_acesso") or "").strip()
    if not re.fullmatch(r"\d{44}", chave) or not re.fullmatch(r"\d{44}", chave_esperada):
        raise DadosFiscaisIncompativeis("A nota deve ter chave de acesso válida de 44 dígitos.")
    if chave != chave_esperada:
        raise DadosFiscaisIncompativeis("O XML pertence a outra NF-e (chave diferente).")
    if _normalizar(numero).lstrip("0") != _normalizar(dados.get("numero_nota")).lstrip("0"):
        raise DadosFiscaisIncompativeis("O número da NF-e não corresponde ao recebimento.")

    all_items = []
    for det in nfe:
        if det.tag.rsplit("}", 1)[-1] != "det":
            continue
        prod = _element(det, "prod")
        if prod is None:
            continue
        preco = _text(prod, "vUnCom")
        quantidade = _text(prod, "qCom")
        total = _text(prod, "vProd")
        if not preco and not total:
            continue
        all_items.append({
            "codigo": _text(prod, "cProd"),
            "nome": _text(prod, "xProd"),
            "quantidade": _decimal(quantidade, "qCom"),
            "unidade": _text(prod, "uCom"),
            "total": _decimal(total, "vProd") if total else
                     _decimal(preco, "vUnCom") * _decimal(quantidade, "qCom"),
            "cfop": _text(prod, "CFOP"),
            "ncm": _text(prod, "NCM"),
        })
    if not all_items:
        raise DadosFiscaisIncompativeis("O XML não contém valores de produtos.")

    codigo = _normalizar(dados.get("codigo_produto"))
    nome = _normalizar(dados.get("produto"))
    candidates = []
    if codigo:
        candidates = [item for item in all_items if _normalizar(item["codigo"]) == codigo]
    if not candidates and nome:
        candidates = [
            item for item in all_items
            if (_normalizar(item["nome"]) == nome
                or _normalizar(item["nome"]).startswith(nome + " ")
                or nome.startswith(_normalizar(item["nome"]) + " "))
        ]
    if not candidates:
        raise DadosFiscaisIncompativeis(
            "Produto não identificado de forma segura neste XML. "
            "Confira o código e a descrição da nota."
        )
    # Mesmo código/nome repetido em várias linhas é um único produto;
    # jamais somar descrições ou códigos diferentes.
    codigos = {_normalizar(i["codigo"]) for i in candidates}
    if len(codigos) > 1:
        raise DadosFiscaisIncompativeis(
            "O XML tem mais de um produto com descrição parecida. Confira o código."
        )
    quantidade_xml = sum(
        (_quantidade_convertida(i["quantidade"], i["unidade"], dados.get("unidade"))
         for i in candidates), Decimal("0")
    )
    valor_xml = sum((i["total"] for i in candidates), Decimal("0"))
    if quantidade_xml <= 0 or valor_xml <= 0:
        raise DadosFiscaisIncompativeis("Quantidade ou valor da NF-e inválidos.")
    quantidade_recebida = _decimal(dados.get("quantidade"), "quantidade recebida")
    unitario = valor_xml / quantidade_xml
    total_recebido = unitario * quantidade_recebida

    return {
        "valor_unitario": str(unitario),
        "valor_total": str(total_recebido),
        "custo_origem": "xml_conferido",
        "codigo_produto": candidates[0]["codigo"] or dados.get("codigo_produto") or "",
        "cfop": candidates[0]["cfop"] or dados.get("cfop") or "",
        "ncm": candidates[0]["ncm"] or dados.get("ncm") or "",
    }


def custo_unitario_na_base(dados: dict, fator: Decimal) -> Decimal:
    """Preço fiscal convertido na unidade-base, nunca no custo anterior do estoque."""
    if fator <= 0 or not fator.is_finite():
        raise DadosFiscaisIncompativeis("Fator de conversão inválido.")
    quantidade_original = _decimal(dados.get("quantidade"), "quantidade da nota")
    total = dados.get("valor_total")
    unitario = dados.get("valor_unitario")
    if total not in (None, ""):
        try:
            valor = Decimal(str(total))
        except (InvalidOperation, ValueError):
            raise DadosFiscaisIncompativeis("Valor total da NF-e inválido.") from None
        if valor < 0 or not valor.is_finite():
            raise DadosFiscaisIncompativeis("Valor total da NF-e inválido.")
        return valor / quantidade_original / fator
    if unitario not in (None, ""):
        try:
            valor = Decimal(str(unitario))
        except (InvalidOperation, ValueError):
            raise DadosFiscaisIncompativeis("Valor unitário da NF-e inválido.") from None
        if valor < 0 or not valor.is_finite():
            raise DadosFiscaisIncompativeis("Valor unitário da NF-e inválido.")
        return valor / fator
    raise DadosFiscaisIncompativeis(
        "A NF-e foi enviada sem valores fiscais. "
        "Use 'Recuperar custo pelo XML' nesta pendência antes de aprovar."
    )
