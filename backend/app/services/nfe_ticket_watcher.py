from __future__ import annotations

import os
import re
import time
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path

from sqlalchemy import select

from app.db.database import SessionLocal
from app.models import Pessoa, Produto, TicketPesagem


# Mantém o caminho histórico no Windows, mas permite migrar para outro PC/VPS.
XML_DIR = Path(
    os.environ.get(
        "ESTQ_XML_TICKET_DIR",
        str(Path.home() / "Documents" / "XML ERP"),
    )
)
PESO_TOLERANCIA_KG = 1.0
_RETRY_SECONDS = 5.0
_tentativas: dict[str, tuple[tuple[int, int], float]] = {}


def _local_name(tag: str) -> str:
    return str(tag).split("}")[-1]


def _elements(parent, name: str):
    if parent is None:
        return []
    return [el for el in parent.iter() if _local_name(el.tag) == name]


def _first(parent, name: str):
    elems = _elements(parent, name)
    return elems[0] if elems else None


def _text(parent, name: str) -> str:
    el = _first(parent, name)
    return (el.text or "").strip() if el is not None else ""


def _float(value: str | None) -> float:
    try:
        return float(str(value or "").replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


def _normalize_text(value: str | None) -> str:
    value = str(value or "").strip().lower()
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _normalize_digits(value: str | None) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _normalize_plate(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def _compatible(a: str | None, b: str | None) -> bool:
    a_n = _normalize_text(a)
    b_n = _normalize_text(b)
    if not a_n or not b_n:
        return False
    return a_n == b_n or a_n in b_n or b_n in a_n


def _extract_ticket_number(inf_cpl: str | None) -> str | None:
    text = str(inf_cpl or "")

    match_pes = re.search(r"PES[\s:\-.\|_º°n]*\d+", text, flags=re.I)
    if match_pes:
        digits = re.sub(
            r"^PES[\s:\-.\|_º°n]*",
            "",
            match_pes.group(0),
            flags=re.I,
        )
        digits = digits.lstrip("0") or "0"
        return f"PES-{digits.zfill(6)}"

    match_kw = re.search(
        r"(?:ticket|pesagem|tk)\s*(?:n[ºo°]?\.?)?\s*[:\-.\|_]*\s*(\d{3,})",
        text,
        flags=re.I,
    )
    if match_kw:
        digits = match_kw.group(1).lstrip("0") or "0"
        return f"PES-{digits.zfill(6)}"

    return None


def _parse_xml(path: Path) -> dict:
    root = ET.parse(path).getroot()

    inf_nfe = _first(root, "infNFe")
    ide = _first(root, "ide")
    dest = _first(root, "dest")
    icms_tot = _first(root, "ICMSTot")
    inf_adic = _first(root, "infAdic")
    veic = _first(root, "veicTransp")

    chave = ""
    if inf_nfe is not None:
        raw_id = str(inf_nfe.attrib.get("Id") or "")
        chave = raw_id[3:] if raw_id.startswith("NFe") else raw_id

    if not chave:
        prot = _first(root, "protNFe")
        chave = _text(prot, "chNFe")

    numero = _text(ide, "nNF")
    cliente = _text(dest, "xNome")
    cliente_documento = _text(dest, "CNPJ") or _text(dest, "CPF")
    valor = _float(_text(icms_tot, "vNF"))
    inf_cpl = _text(inf_adic, "infCpl")
    placa = _text(veic, "placa")

    produtos: list[str] = []
    quantidade_total = 0.0

    for det in _elements(root, "det"):
        prod = _first(det, "prod")
        if prod is None:
            continue

        nome = _text(prod, "xProd")
        qtd = _float(_text(prod, "qCom"))

        if nome and nome not in produtos:
            produtos.append(nome)

        quantidade_total += qtd

    peso_liquido = sum(
        _float(_text(vol, "pesoL"))
        for vol in _elements(root, "vol")
    )

    quantidade_ref = peso_liquido if peso_liquido > 0 else quantidade_total

    return {
        "chave": chave,
        "numero": numero,
        "cliente": cliente,
        "cliente_documento": cliente_documento,
        "produto": " | ".join(produtos),
        "quantidade": quantidade_total,
        "quantidade_ref": quantidade_ref,
        "valor": valor,
        "placa": placa,
        "inf_cpl": inf_cpl,
        "ticket_numero": _extract_ticket_number(inf_cpl),
    }


def _match_ticket(db, nfe: dict):
    tickets = db.scalars(
        select(TicketPesagem).order_by(TicketPesagem.data_abertura.desc())
    ).all()

    if nfe["chave"]:
        duplicate = next(
            (t for t in tickets if (t.nfe_chave or "") == nfe["chave"]),
            None,
        )
        if duplicate is not None:
            return "duplicate", duplicate

    if nfe["ticket_numero"]:
        exact = [t for t in tickets if t.numero == nfe["ticket_numero"]]

        if len(exact) == 1:
            ticket = exact[0]
            if (
                ticket.tipo == "venda"
                and ticket.status == "fechado"
                and not ticket.nfe_importada
            ):
                return "unique", ticket
            return "none", None

        if len(exact) > 1:
            return "ambiguous", None

    candidatos = [
        t for t in tickets
        if (
            t.tipo == "venda"
            and t.status == "fechado"
            and not t.nfe_importada
        )
    ]

    pessoas = {p.id: p for p in db.scalars(select(Pessoa)).all()}
    produtos = {p.id: p for p in db.scalars(select(Produto)).all()}

    documento_nfe = _normalize_digits(nfe["cliente_documento"])
    if documento_nfe:
        por_documento = []
        for ticket in candidatos:
            pessoa = pessoas.get(ticket.cliente_id or "")
            if pessoa and _normalize_digits(pessoa.documento) == documento_nfe:
                por_documento.append(ticket)

        if por_documento:
            candidatos = por_documento

    peso = float(nfe["quantidade_ref"] or 0)
    if peso > 0:
        por_peso = [
            t for t in candidatos
            if (
                float(t.peso_liquido or 0) > 0
                and abs(float(t.peso_liquido or 0) - peso) <= PESO_TOLERANCIA_KG
            )
        ]
        if por_peso:
            candidatos = por_peso

    placa = _normalize_plate(nfe["placa"])
    if placa:
        por_placa = [
            t for t in candidatos
            if _normalize_plate(t.placa) == placa
        ]
        if por_placa:
            candidatos = por_placa

    if nfe["cliente"]:
        por_cliente = []
        for ticket in candidatos:
            pessoa = pessoas.get(ticket.cliente_id or "")
            nome_ticket = ticket.cliente_nome or (pessoa.nome if pessoa else "")
            if _compatible(nome_ticket, nfe["cliente"]):
                por_cliente.append(ticket)

        if por_cliente:
            candidatos = por_cliente

    if nfe["produto"]:
        por_produto = []
        nomes_xml = [
            nome.strip()
            for nome in nfe["produto"].split(" | ")
            if nome.strip()
        ]

        for ticket in candidatos:
            produto = produtos.get(ticket.produto_id or "")
            nome_ticket = produto.nome if produto else ""

            if any(_compatible(nome_ticket, nome_xml) for nome_xml in nomes_xml):
                por_produto.append(ticket)

        if por_produto:
            candidatos = por_produto

    if len(candidatos) == 1:
        return "unique", candidatos[0]

    if not candidatos:
        return "none", None

    return "ambiguous", None


def _process_file(path: Path) -> str:
    try:
        nfe = _parse_xml(path)
    except Exception as exc:
        print(f"[NF-e/TICKET] XML ainda nao pode ser lido: {path.name}: {exc}")
        return "retry"

    db = SessionLocal()

    try:
        status, ticket = _match_ticket(db, nfe)

        if status == "duplicate":
            path.unlink(missing_ok=True)
            print(f"[NF-e/TICKET] XML repetido removido: {path.name}")
            return "deleted"

        if status != "unique" or ticket is None:
            print(f"[NF-e/TICKET] Aguardando identificacao unica de ticket: {path.name}")
            return status

        ticket.nfe_importada = True
        ticket.nfe_numero = nfe["numero"] or None
        ticket.nfe_chave = nfe["chave"] or None
        ticket.nfe_cliente = nfe["cliente"] or None
        ticket.nfe_produto = nfe["produto"] or None
        ticket.nfe_quantidade = float(nfe["quantidade"] or 0)
        ticket.nfe_valor = float(nfe["valor"] or 0)

        db.commit()

        numero_ticket = ticket.numero
        numero_nfe = nfe["numero"] or "sem numero"

        path.unlink(missing_ok=True)

        print(
            f"[NF-e/TICKET] {numero_ticket} marcado com NF-e {numero_nfe}; XML removido."
        )
        return "matched"

    except Exception as exc:
        db.rollback()
        print(f"[NF-e/TICKET] Erro ao processar {path.name}: {exc}")
        return "retry"

    finally:
        db.close()


def processar_pasta_nfe_tickets():
    XML_DIR.mkdir(parents=True, exist_ok=True)

    try:
        files = [
            p for p in XML_DIR.iterdir()
            if p.is_file() and p.suffix.lower() == ".xml"
        ]
    except OSError as exc:
        print(f"[NF-e/TICKET] Erro ao acessar pasta: {exc}")
        return

    now = time.monotonic()

    for path in sorted(files, key=lambda p: p.stat().st_mtime):
        try:
            stat = path.stat()
        except OSError:
            continue

        fingerprint = (stat.st_size, stat.st_mtime_ns)
        previous = _tentativas.get(str(path))

        if (
            previous
            and previous[0] == fingerprint
            and (now - previous[1]) < _RETRY_SECONDS
        ):
            continue

        _tentativas[str(path)] = (fingerprint, now)
        result = _process_file(path)

        if result in {"matched", "deleted"}:
            _tentativas.pop(str(path), None)
