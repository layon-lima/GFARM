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
    # Sinônimos fiscais para tonelada: 1 TN = 1 T = 1 TON = 1000 KG.
    "T": ("peso", Decimal("1000")),
    "TN": ("peso", Decimal("1000")),
    "TON": ("peso", Decimal("1000")),
    "TO": ("peso", Decimal("1000")),
    "TONS": ("peso", Decimal("1000")),
    "TONELADA": ("peso", Decimal("1000")),
    "TONELADAS": ("peso", Decimal("1000")),
    "L": ("volume", Decimal("1")),
    "LT": ("volume", Decimal("1")),
    "LITRO": ("volume", Decimal("1")),
    "ML": ("volume", Decimal("0.001")),
    "UN": ("un", Decimal("1")),
    "UND": ("un", Decimal("1")),
    "UNID": ("un", Decimal("1")),
    "UNIDADE": ("un", Decimal("1")),
    # Doses não são automaticamente convertidas em unidades (UN).
    # Apenas grafias equivalentes da própria unidade DOS podem ser somadas.
    "DOS": ("dose", Decimal("1")),
    "DOSE": ("dose", Decimal("1")),
    "DOSES": ("dose", Decimal("1")),
}


class DadosFiscaisIncompativeis(ValueError):
    pass


def _normalizar(valor):
    raw = unicodedata.normalize("NFKD", str(valor or "").strip())
    raw = "".join(c for c in raw if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", raw.upper()).split())


def _nome_com_sufixo_curto(nome_pendente: str, nome_xml: str) -> bool:
    """Tolera abreviação final de 1-2 letras, mas nunca dígitos distintos.

    Ex.: MBIO BRAD x MBIO BRADY. Apenas ajuda quando não houve
    correspondência exata; a rotina principal ainda exige código único.
    """
    if len(nome_pendente) < 6 or len(nome_xml) < 6:
        return False
    if not nome_pendente[:1] == nome_xml[:1]:
        return False
    curto, longo = sorted((nome_pendente, nome_xml), key=len)
    sobra = longo[len(curto):]
    return bool(longo.startswith(curto) and 1 <= len(sobra) <= 2 and sobra.isalpha())


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


def _quantidade_do_item(item, unidade_recebimento, quantidade_referencia=None):
    """Compara quantidade comercial e tributável, evitando conversões presumidas.

    A NF-e pode informar embalagem (uCom/qCom) e unidade tributável
    (uTrib/qTrib). Usar a unidade compatível com a entrada do Controles.
    """
    possibilidades = []
    for origem in item.get("variantes_quantidade") or [
        {"quantidade": item["quantidade"], "unidade": item["unidade"], "origem": "comercial"}
    ]:
        try:
            convertido = _quantidade_convertida(
                origem["quantidade"], origem["unidade"], unidade_recebimento
            )
        except DadosFiscaisIncompativeis:
            continue
        possibilidades.append((convertido, origem))
    if not possibilidades:
        todas = ", ".join(
            str(v["unidade"]) for v in item.get("variantes_quantidade", [])
        ) or str(item["unidade"])
        raise DadosFiscaisIncompativeis(
            f"Não é possível converter {todas} para {unidade_recebimento} "
            "com segurança. Confira a unidade/custo da nota."
        )
    if quantidade_referencia is not None:
        for convertido, origem in possibilidades:
            if convertido == quantidade_referencia:
                return convertido, origem
    return possibilidades[0]


def extrair_custo_xml(xml_base64: str, dados: dict, *,
                     permitir_correspondencia_quantidade=False,
                     permitir_item_unico=False) -> dict:
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

    emit = _element(nfe, "emit")
    fornecedor_xml = _text(emit, "xNome")
    documento_xml = _text(emit, "CNPJ") or _text(emit, "CPF")
    serie_xml = _text(ide, "serie")
    emissao_xml = (_text(ide, "dhEmi") or _text(ide, "dEmi"))[:10]

    all_items = []
    for det in nfe:
        if det.tag.rsplit("}", 1)[-1] != "det":
            continue
        prod = _element(det, "prod")
        if prod is None:
            continue
        preco = _text(prod, "vUnCom")
        quantidade = _text(prod, "qCom")
        unidade = _text(prod, "uCom")
        qtde_tributavel = _text(prod, "qTrib")
        unidade_tributavel = _text(prod, "uTrib")
        total = _text(prod, "vProd")
        if not preco and not total:
            continue
        variantes = [{"quantidade": _decimal(quantidade, "qCom"),
                     "unidade": unidade, "origem": "comercial"}]
        if qtde_tributavel and unidade_tributavel:
            variantes.append({
                "quantidade": _decimal(qtde_tributavel, "qTrib"),
                "unidade": unidade_tributavel, "origem": "tributavel",
            })
        all_items.append({
            "codigo": _text(prod, "cProd"),
            "nome": _text(prod, "xProd"),
            "quantidade": variantes[0]["quantidade"],
            "unidade": unidade,
            "variantes_quantidade": variantes,
            "total": _decimal(total, "vProd") if total else
                     _decimal(preco, "vUnCom") * _decimal(quantidade, "qCom"),
            "cfop": _text(prod, "CFOP"),
            "ncm": _text(prod, "NCM"),
            "numero_item": str(det.attrib.get("nItem", "")),
            "rastreio": [
                {
                    "lote": _text(rastro, "nLote"),
                    "validade": _text(rastro, "dVal"),
                }
                for rastro in prod
                if rastro.tag.rsplit("}", 1)[-1] == "rastro"
            ],
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
    if not candidates and nome:
        candidates = [
            item for item in all_items
            if _nome_com_sufixo_curto(nome, _normalizar(item["nome"]))
        ]
    identificacao_fiscal = "codigo_ou_nome"
    if not candidates and permitir_correspondencia_quantidade:
        # Plano B: descrição comercial diferente da NF-e. Só vincula caso
        # quantidade E unidade identifiquem exatamente um item fiscal.
        # O chamador precisa comprovar que nenhuma outra pendência da mesma
        # NF-e concorre com a mesma quantidade/unidade.
        try:
            qtde_recebida = _decimal(dados.get("quantidade"), "quantidade recebida")
        except DadosFiscaisIncompativeis:
            qtde_recebida = None
        unicos = []
        for candidato in all_items:
            try:
                convertido, _ = _quantidade_do_item(
                    candidato, dados.get("unidade"), qtde_recebida
                )
            except DadosFiscaisIncompativeis:
                continue
            if qtde_recebida is not None and convertido == qtde_recebida:
                unicos.append(candidato)
        if len(unicos) == 1:
            candidates = unicos
            identificacao_fiscal = "quantidade_e_unidade_unicas"
    if not candidates and permitir_item_unico and len(all_items) == 1:
        # Só uma pendência da chave e só um produto fiscal: aceitar
        # o XML mesmo que nome, código ou quantidade sejam diferentes.
        # A seleção do produto no estoque será exigida na conferência.
        candidates = all_items
        identificacao_fiscal = "item_unico_da_nota"
    if not candidates:
        exemplo = "; ".join(
            f'{i["nome"]} ({i["quantidade"]} {i["unidade"]})'
            for i in all_items[:5]
        )
        raise DadosFiscaisIncompativeis(
            "Produto não identificado com segurança pelo nome/código ou "
            "quantidade e unidade. No XML constam: " + (exemplo or "sem itens")
        )
    # Mesmo código/nome repetido em várias linhas é um único produto;
    # jamais somar descrições ou códigos diferentes.
    codigos = {_normalizar(i["codigo"]) for i in candidates}
    if len(codigos) > 1:
        raise DadosFiscaisIncompativeis(
            "O XML tem mais de um produto com descrição parecida. Confira o código."
        )
    quantidade_recebida = _decimal(dados.get("quantidade"), "quantidade recebida")
    quantidades_convertidas = [
        _quantidade_do_item(i, dados.get("unidade"), quantidade_recebida)
        for i in candidates
    ]
    quantidade_xml = sum((qtde for qtde, _ in quantidades_convertidas), Decimal("0"))
    valor_xml = sum((i["total"] for i in candidates), Decimal("0"))
    if quantidade_xml <= 0 or valor_xml <= 0:
        raise DadosFiscaisIncompativeis("Quantidade ou valor da NF-e inválidos.")
    unitario = valor_xml / quantidade_xml
    total_recebido = unitario * quantidade_recebida

    # Preserva quantidade e nome das pendências (pode ser recebimento parcial).
    # Registra informações fiscais verificadas para conferência e sugere
    # validade/lote apenas quando todos os rastreios concordam.
    rastros = [r for item in candidates for r in item["rastreio"]]
    validades = {r["validade"] for r in rastros if r["validade"]}
    lotes = {r["lote"] for r in rastros if r["lote"]}
    nomes = {_normalizar(i["nome"]) for i in candidates}
    retorno = {
        "valor_unitario": str(unitario),
        "valor_total": str(total_recebido),
        "custo_origem": "xml_conferido",
        "codigo_produto": candidates[0]["codigo"] or dados.get("codigo_produto") or "",
        "cfop": candidates[0]["cfop"] or dados.get("cfop") or "",
        "ncm": candidates[0]["ncm"] or dados.get("ncm") or "",
        "quantidade_xml": str(quantidade_xml),
        "unidade_xml": dados.get("unidade") or candidates[0]["unidade"],
        "unidade_fiscal_origem": quantidades_convertidas[0][1]["unidade"],
        "origem_quantidade_fiscal": quantidades_convertidas[0][1]["origem"],
        "produto_xml": candidates[0]["nome"] if len(nomes) == 1 else "",
        "identificacao_fiscal": identificacao_fiscal,
        # O XML prevalece na descrição fiscal; nunca reclassificar o
        # produto do estoque de maneira silenciosa.
        "divergencia_produto_xml": bool(
            identificacao_fiscal in ("quantidade_e_unidade_unicas", "item_unico_da_nota")
            and nome != _normalizar(candidates[0]["nome"])
        ),
        "itens_xml": [i["numero_item"] for i in candidates],
        "custo_origem": "xml_conferido",
    }
    if fornecedor_xml:
        retorno["fornecedor"] = fornecedor_xml
    if documento_xml:
        retorno["documento_fornecedor"] = documento_xml
    if serie_xml:
        retorno["serie"] = serie_xml
    if emissao_xml:
        retorno["data_emissao"] = emissao_xml
    if not dados.get("validade") and len(validades) == 1 and len(rastros) >= 1:
        retorno["validade"] = next(iter(validades))
    if not dados.get("lote") and len(lotes) == 1 and len(rastros) >= 1:
        retorno["lote"] = next(iter(lotes))
    return retorno


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
