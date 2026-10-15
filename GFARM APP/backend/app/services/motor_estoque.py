from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from app.services.unidades_estoque import (
    converter_quantidade_estoque,
)
from app.models import (
    Deposito,
    EstoqueDocumento,
    EstoqueDocumentoItem,
    EstoqueSaldo,
    Gaveta,
    Lote,
    Produto,
    Setor,
)



from app.services.regras_movimento import (
    MOVIMENTOS_ENTRADA,
    MOVIMENTOS_SAIDA,
    MOVIMENTOS_TRANSFERENCIA,
    MOVIMENTOS_VALIDOS,
    obter_regra_movimento,
)
QTD = Decimal("0.001")
CUSTO = Decimal("0.000001")
DINHEIRO = Decimal("0.01")


class EstoqueErro(Exception):
    pass


def _decimal(valor: Any) -> Decimal:
    if valor is None or valor == "":
        return Decimal("0")

    return Decimal(str(valor))


def _qtd(valor: Any) -> Decimal:
    return _decimal(valor).quantize(
        QTD,
        rounding=ROUND_HALF_UP,
    )


def _custo(valor: Any) -> Decimal:
    return _decimal(valor).quantize(
        CUSTO,
        rounding=ROUND_HALF_UP,
    )


def _dinheiro(valor: Any) -> Decimal:
    return _decimal(valor).quantize(
        DINHEIRO,
        rounding=ROUND_HALF_UP,
    )


def _normalizar_id(valor: Any) -> str:
    if valor is None:
        return ""

    return str(valor).strip()


def _agora():
    return datetime.now(timezone.utc)


def _bloquear_chave(
    db: Session,
    chave: str,
):
    """
    Lock transacional do PostgreSQL.

    Impede duas requisiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes concorrentes de alterarem
    a mesma posiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o de estoque ao mesmo tempo.
    """
    db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(
                    chave,
                    0,
                )
            )
        )
    )


def _proximo_numero_documento(
    db: Session,
) -> str:
    """
    GeraÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o sequencial segura:

    EST-000001
    EST-000002
    EST-000003
    """

    _bloquear_chave(
        db,
        "sequencia:estoque_documentos",
    )

    maior = db.scalar(
        select(
            func.max(
                cast(
                    func.substring(
                        EstoqueDocumento.numero,
                        5,
                    ),
                    Integer,
                )
            )
        )
    )

    proximo = int(maior or 0) + 1

    return f"EST-{proximo:06d}"


def _obter_produto(
    db: Session,
    produto_id: str,
) -> tuple[Produto, Setor | None]:
    produto = db.get(
        Produto,
        produto_id,
    )

    if produto is None:
        raise EstoqueErro(
            "Produto nÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o encontrado."
        )

    setor = None

    if produto.setor_id:
        setor = db.get(
            Setor,
            produto.setor_id,
        )

    return produto, setor


def _validar_local(
    db: Session,
    deposito_id: str,
    gaveta_id: str = "",
):
    deposito_id = _normalizar_id(
        deposito_id
    )

    gaveta_id = _normalizar_id(
        gaveta_id
    )

    if not deposito_id:
        raise EstoqueErro(
            "DepÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³sito obrigatÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³rio."
        )

    deposito = db.get(
        Deposito,
        deposito_id,
    )

    if deposito is None:
        raise EstoqueErro(
            "DepÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³sito nÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o encontrado."
        )

    if gaveta_id:
        gaveta = db.get(
            Gaveta,
            gaveta_id,
        )

        if gaveta is None:
            raise EstoqueErro(
                "Gaveta nÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o encontrada."
            )

        if (
            gaveta.deposito_id
            and gaveta.deposito_id
            != deposito_id
        ):
            raise EstoqueErro(
                "A gaveta nÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o pertence ao depÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³sito informado."
            )


def _validar_lote(
    db: Session,
    produto_id: str,
    lote_id: str,
):
    lote_id = _normalizar_id(
        lote_id
    )

    if not lote_id:
        return None

    lote = db.get(
        Lote,
        lote_id,
    )

    if lote is None:
        raise EstoqueErro(
            "Lote nÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o encontrado."
        )

    if lote.produto_id != produto_id:
        raise EstoqueErro(
            "O lote nÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o pertence ao produto informado."
        )

    return lote


def _obter_ou_criar_lote_entrada(
    db: Session,
    *,
    produto: Produto,
    deposito_id: str,
    gaveta_id: str,
    data_validade,
) -> Lote:
    if not data_validade:
        raise EstoqueErro(
            "Produto com controle de validade exige data de validade."
        )

    try:
        if isinstance(
            data_validade,
            datetime,
        ):
            validade = data_validade.date()

        elif hasattr(
            data_validade,
            "year",
        ):
            validade = data_validade

        else:
            validade = datetime.fromisoformat(
                str(data_validade)
            ).date()

    except Exception:
        raise EstoqueErro(
            "Data de validade invÃƒÂ¡lida."
        )

    gaveta_id = _normalizar_id(
        gaveta_id
    )

    #
    # Evita dois usuÃƒÂ¡rios criando o mesmo
    # lote ao mesmo tempo.
    #
    _bloquear_chave(
        db,
        f"lote:{produto.id}:{deposito_id}:{gaveta_id}:{validade}",
    )

    lote = db.scalar(
        select(Lote)
        .where(
            Lote.produto_id
            == produto.id,
            Lote.data_validade
            == validade,
            Lote.deposito_id
            == deposito_id,
            Lote.gaveta_id
            == gaveta_id,
        )
        .with_for_update()
    )

    if lote is not None:
        return lote

    #
    # GeraÃƒÂ§ÃƒÂ£o do cÃƒÂ³digo interno do lote.
    #
    _bloquear_chave(
        db,
        f"sequencia:lote:{produto.id}",
    )

    lotes_produto = db.scalars(
        select(Lote)
        .where(
            Lote.produto_id
            == produto.id
        )
        .with_for_update()
    ).all()

    maior = 0

    for existente in lotes_produto:
        codigo = str(
            existente.codigo_lote
            or ""
        )

        if "-L" not in codigo.upper():
            continue

        try:
            numero = int(
                codigo.upper()
                .rsplit("-L", 1)[1]
            )

            maior = max(
                maior,
                numero,
            )

        except Exception:
            pass

    codigo_produto = (
        str(
            produto.codigo
            or "P0000"
        ).strip()
        or "P0000"
    )

    lote = Lote(
        produto_id=produto.id,
        codigo_referencia=(
            produto.codigo_referencia
            or ""
        ),
        setor_id=produto.setor_id,
        deposito_id=deposito_id,
        maquina_id=(
            produto.maquina_id
            or ""
        ),
        gaveta_id=gaveta_id,
        codigo_lote=(
            f"{codigo_produto}-L"
            f"{maior + 1:02d}"
        ),
        data_validade=validade,
        quantidade=0,
        unidade=(
            produto.unidade
            or "un"
        ),
    )

    db.add(lote)
    db.flush()

    return lote

def _chave_posicao(
    produto_id: str,
    deposito_id: str,
    gaveta_id: str,
    lote_id: str,
    tipo_estoque: str,
):
    return (
        f"saldo:"
        f"{produto_id}:"
        f"{deposito_id}:"
        f"{gaveta_id}:"
        f"{lote_id}:"
        f"{tipo_estoque}"
    )


def _obter_saldo(
    db: Session,
    *,
    produto_id: str,
    deposito_id: str,
    gaveta_id: str = "",
    lote_id: str = "",
    tipo_estoque: str = "livre",
    criar: bool = False,
) -> EstoqueSaldo | None:
    gaveta_id = _normalizar_id(
        gaveta_id
    )

    lote_id = _normalizar_id(
        lote_id
    )

    chave = _chave_posicao(
        produto_id,
        deposito_id,
        gaveta_id,
        lote_id,
        tipo_estoque,
    )

    _bloquear_chave(
        db,
        chave,
    )

    saldo = db.scalar(
        select(EstoqueSaldo)
        .where(
            EstoqueSaldo.produto_id
            == produto_id,
            EstoqueSaldo.deposito_id
            == deposito_id,
            EstoqueSaldo.gaveta_id
            == gaveta_id,
            EstoqueSaldo.lote_id
            == lote_id,
            EstoqueSaldo.tipo_estoque
            == tipo_estoque,
        )
        .with_for_update()
    )

    if saldo is None and criar:
        saldo = EstoqueSaldo(
            produto_id=produto_id,
            deposito_id=deposito_id,
            gaveta_id=gaveta_id,
            lote_id=lote_id,
            tipo_estoque=tipo_estoque,
            quantidade=Decimal("0"),
            quantidade_reservada=Decimal("0"),
            custo_medio=Decimal("0"),
            valor_total=Decimal("0"),
        )

        db.add(saldo)
        db.flush()

    return saldo


def _adicionar_saldo(
    db: Session,
    *,
    produto_id: str,
    deposito_id: str,
    gaveta_id: str,
    lote_id: str,
    quantidade: Decimal,
    custo_unitario: Decimal,
):
    saldo = _obter_saldo(
        db,
        produto_id=produto_id,
        deposito_id=deposito_id,
        gaveta_id=gaveta_id,
        lote_id=lote_id,
        criar=True,
    )

    qtd_anterior = _qtd(
        saldo.quantidade
    )

    valor_anterior = _dinheiro(
        saldo.valor_total
    )

    valor_entrada = _dinheiro(
        quantidade
        * custo_unitario
    )

    nova_qtd = _qtd(
        qtd_anterior
        + quantidade
    )

    novo_valor = _dinheiro(
        valor_anterior
        + valor_entrada
    )

    if nova_qtd > 0:
        novo_custo = _custo(
            novo_valor
            / nova_qtd
        )
    else:
        novo_custo = Decimal("0")

    saldo.quantidade = nova_qtd
    saldo.valor_total = novo_valor
    saldo.custo_medio = novo_custo

    return saldo


def _subtrair_saldo(
    db: Session,
    *,
    produto_id: str,
    deposito_id: str,
    gaveta_id: str,
    lote_id: str,
    quantidade: Decimal,
) -> Decimal:
    saldo = _obter_saldo(
        db,
        produto_id=produto_id,
        deposito_id=deposito_id,
        gaveta_id=gaveta_id,
        lote_id=lote_id,
        criar=False,
    )

    if saldo is None:
        raise EstoqueErro(
            "NÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o existe saldo nessa posiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o de estoque."
        )

    atual = _qtd(
        saldo.quantidade
    )

    reservado = _qtd(
        saldo.quantidade_reservada
    )

    disponivel = _qtd(
        atual
        - reservado
    )

    if quantidade > disponivel:
        raise EstoqueErro(
            "Saldo insuficiente. "
            f"DisponÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­vel: {disponivel}. "
            f"Solicitado: {quantidade}."
        )

    custo_saida = _custo(
        saldo.custo_medio
    )

    novo_saldo = _qtd(
        atual
        - quantidade
    )

    valor_atual = _dinheiro(
        saldo.valor_total
    )

    valor_saida = _dinheiro(
        quantidade
        * custo_saida
    )

    novo_valor = _dinheiro(
        valor_atual
        - valor_saida
    )

    if novo_saldo <= 0:
        saldo.quantidade = Decimal("0")
        saldo.valor_total = Decimal("0")
        saldo.custo_medio = Decimal("0")
    else:
        saldo.quantidade = novo_saldo

        if novo_valor < 0:
            novo_valor = Decimal("0")

        saldo.valor_total = novo_valor

    return custo_saida


def _alocar_saida_fefo(
    db: Session,
    *,
    produto: Produto,
    controla_validade: bool,
    deposito_id: str,
    gaveta_id: str,
    lote_solicitado_id: str,
    quantidade: Decimal,
):
    gaveta_id = _normalizar_id(
        gaveta_id
    )

    lote_solicitado_id = _normalizar_id(
        lote_solicitado_id
    )

    if not controla_validade:
        custo = _subtrair_saldo(
            db,
            produto_id=produto.id,
            deposito_id=deposito_id,
            gaveta_id=gaveta_id,
            lote_id="",
            quantidade=quantidade,
        )

        return [
            {
                "quantidade": quantidade,
                "lote_id": "",
                "custo_unitario": custo,
            }
        ]

    if lote_solicitado_id:
        _validar_lote(
            db,
            produto.id,
            lote_solicitado_id,
        )

        custo = _subtrair_saldo(
            db,
            produto_id=produto.id,
            deposito_id=deposito_id,
            gaveta_id=gaveta_id,
            lote_id=lote_solicitado_id,
            quantidade=quantidade,
        )

        return [
            {
                "quantidade": quantidade,
                "lote_id": lote_solicitado_id,
                "custo_unitario": custo,
            }
        ]

    # Um ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºnico processo FEFO por produto/local por vez.
    _bloquear_chave(
        db,
        (
            f"fefo:"
            f"{produto.id}:"
            f"{deposito_id}:"
            f"{gaveta_id}"
        ),
    )

    candidatos = db.execute(
        select(
            EstoqueSaldo,
            Lote,
        )
        .join(
            Lote,
            Lote.id
            == EstoqueSaldo.lote_id,
        )
        .where(
            EstoqueSaldo.produto_id
            == produto.id,
            EstoqueSaldo.deposito_id
            == deposito_id,
            EstoqueSaldo.gaveta_id
            == gaveta_id,
            EstoqueSaldo.tipo_estoque
            == "livre",
            EstoqueSaldo.quantidade
            > EstoqueSaldo.quantidade_reservada,
        )
        .order_by(
            Lote.data_validade.asc(),
            EstoqueSaldo.updated_at.asc(),
        )
    ).all()

    restante = quantidade
    alocacoes = []

    for saldo_candidato, lote in candidatos:
        if restante <= 0:
            break

        saldo = _obter_saldo(
            db,
            produto_id=produto.id,
            deposito_id=deposito_id,
            gaveta_id=gaveta_id,
            lote_id=lote.id,
            criar=False,
        )

        if saldo is None:
            continue

        disponivel = _qtd(
            _qtd(saldo.quantidade)
            - _qtd(
                saldo.quantidade_reservada
            )
        )

        if disponivel <= 0:
            continue

        consumir = min(
            disponivel,
            restante,
        )

        custo = _subtrair_saldo(
            db,
            produto_id=produto.id,
            deposito_id=deposito_id,
            gaveta_id=gaveta_id,
            lote_id=lote.id,
            quantidade=consumir,
        )

        alocacoes.append(
            {
                "quantidade": consumir,
                "lote_id": lote.id,
                "custo_unitario": custo,
            }
        )

        restante = _qtd(
            restante
            - consumir
        )

    if restante > 0:
        raise EstoqueErro(
            "Saldo insuficiente nos lotes disponÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­veis. "
            f"Faltam {restante}."
        )

    return alocacoes


def _registrar_item(
    db: Session,
    *,
    documento: EstoqueDocumento,
    item_numero: int,
    produto_id: str,
    quantidade: Decimal,
    unidade: str,
    quantidade_informada: Decimal | None = None,
    unidade_informada: str | None = None,
    fator_conversao: Decimal = Decimal("1"),
    deposito_origem_id: str = "",
    gaveta_origem_id: str = "",
    lote_origem_id: str = "",
    deposito_destino_id: str = "",
    gaveta_destino_id: str = "",
    lote_destino_id: str = "",
    custo_unitario: Decimal = Decimal("0"),
    observacao: str | None = None,
):
    item = EstoqueDocumentoItem(
        documento_id=documento.id,
        item_numero=item_numero,
        produto_id=produto_id,
        quantidade=quantidade,
        unidade=unidade,
        quantidade_informada=(
            quantidade_informada
            if quantidade_informada is not None
            else quantidade
        ),
        unidade_informada=(
            unidade_informada
            or unidade
        ),
        fator_conversao=_custo(
            fator_conversao
        ),
        deposito_origem_id=(
            deposito_origem_id
            or None
        ),
        gaveta_origem_id=(
            gaveta_origem_id
            or None
        ),
        lote_origem_id=(
            lote_origem_id
            or None
        ),
        deposito_destino_id=(
            deposito_destino_id
            or None
        ),
        gaveta_destino_id=(
            gaveta_destino_id
            or None
        ),
        lote_destino_id=(
            lote_destino_id
            or None
        ),
        custo_unitario=_custo(
            custo_unitario
        ),
        valor_total=_dinheiro(
            quantidade
            * custo_unitario
        ),
        observacao=observacao,
    )

    db.add(item)

    return item


def reavaliar_custo_produto(
    db: Session,
    *,
    produto_id: str,
    novo_custo: Any,
) -> tuple[Produto, int]:
    """
    Reavalia o estoque atual de um produto usando um novo custo unitário.

    Esta é a operação oficial do motor para mudança manual de custo.
    Produto.custo_unitario passa a ser apenas a projeção/resumo do mesmo
    valor mantido nos saldos atuais.
    """
    custo = _custo(
        novo_custo
    )

    if custo < 0:
        raise EstoqueErro(
            "Custo unitário não pode ser negativo."
        )

    produto = db.scalar(
        select(
            Produto
        )
        .where(
            Produto.id
            == produto_id
        )
        .with_for_update()
    )

    if produto is None:
        raise EstoqueErro(
            "Produto não encontrado."
        )

    saldos = db.scalars(
        select(
            EstoqueSaldo
        )
        .where(
            EstoqueSaldo.produto_id
            == produto_id
        )
        .with_for_update()
    ).all()

    quantidade_total = Decimal("0")
    valor_total = Decimal("0")

    for saldo in saldos:
        quantidade = _qtd(
            saldo.quantidade
        )

        quantidade_total += quantidade

        if quantidade > 0:
            saldo.custo_medio = custo
            saldo.valor_total = _dinheiro(
                quantidade
                * custo
            )
            valor_total += _dinheiro(
                saldo.valor_total
            )
        else:
            saldo.custo_medio = Decimal("0")
            saldo.valor_total = Decimal("0")

    produto.quantidade = float(
        _qtd(
            quantidade_total
        )
    )
    produto.custo_unitario = float(
        custo
    )

    db.flush()

    return produto, len(
        saldos
    )


def _recalcular_produto(
    db: Session,
    produto_id: str,
):
    produto = db.get(
        Produto,
        produto_id,
    )

    if produto is None:
        return

    saldos = db.scalars(
        select(EstoqueSaldo)
        .where(
            EstoqueSaldo.produto_id
            == produto_id
        )
    ).all()

    quantidade_total = sum(
        (
            _qtd(s.quantidade)
            for s in saldos
        ),
        Decimal("0"),
    )

    valor_total = sum(
        (
            _dinheiro(s.valor_total)
            for s in saldos
        ),
        Decimal("0"),
    )

    produto.quantidade = float(
        _qtd(quantidade_total)
    )

    if quantidade_total > 0:
        produto.custo_unitario = float(
            _custo(
                valor_total
                / quantidade_total
            )
        )
    # Sem saldo físico, preserva o último custo conhecido.
    # O custo só muda por nova entrada ou reavaliação explícita.


def _recalcular_lote(
    db: Session,
    lote_id: str,
):
    if not lote_id:
        return

    lote = db.get(
        Lote,
        lote_id,
    )

    if lote is None:
        return

    saldos = db.scalars(
        select(EstoqueSaldo)
        .where(
            EstoqueSaldo.lote_id
            == lote_id
        )
    ).all()

    total = sum(
        (
            _qtd(s.quantidade)
            for s in saldos
        ),
        Decimal("0"),
    )

    # Campo legado mantido apenas como resumo
    # para compatibilidade com as telas atuais.
    lote.quantidade = float(
        _qtd(total)
    )



def _obter_documento_idempotente(
    db: Session,
    *,
    tipo_movimento: str,
    origem_modulo: str,
    documento_origem_id: str | None,
    referencia_externa: str | None,
) -> EstoqueDocumento | None:
    """
    Garante idempot?ncia para documentos originados por outros m?dulos.

    A mesma origem/tipo s? pode possuir um documento ativo.
    Documentos estornados n?o bloqueiam um novo lan?amento.
    Para NF-e, a refer?ncia externa tamb?m ? protegida.
    """

    if documento_origem_id:
        _bloquear_chave(
            db,
            (
                "idempotencia:estoque:"
                f"{origem_modulo}:"
                f"{tipo_movimento}:"
                f"{documento_origem_id}"
            ),
        )

        existente = db.scalar(
            select(
                EstoqueDocumento
            )
            .where(
                EstoqueDocumento.origem_modulo
                == origem_modulo,
                EstoqueDocumento.documento_origem_id
                == documento_origem_id,
                EstoqueDocumento.tipo_movimento
                == tipo_movimento,
                EstoqueDocumento.status
                != "estornado",
            )
            .order_by(
                EstoqueDocumento.data_documento.desc()
            )
        )

        if existente is not None:
            return existente

    if (
        referencia_externa
        and origem_modulo
        in {"nfe", "nfe_manual"}
    ):
        _bloquear_chave(
            db,
            (
                "idempotencia:nfe:"
                f"{tipo_movimento}:"
                f"{referencia_externa}"
            ),
        )

        existente = db.scalar(
            select(
                EstoqueDocumento
            )
            .where(
                EstoqueDocumento.origem_modulo
                .in_(("nfe", "nfe_manual")),
                EstoqueDocumento.referencia_externa
                == referencia_externa,
                EstoqueDocumento.tipo_movimento
                == tipo_movimento,
                EstoqueDocumento.status
                != "estornado",
            )
            .order_by(
                EstoqueDocumento.data_documento.desc()
            )
        )

        if existente is not None:
            return existente

    return None


def movimentar_estoque(
    db: Session,
    *,
    tipo_movimento: str,
    usuario_id: str,
    itens: list[dict[str, Any]],
    origem_modulo: str = "manual",
    documento_origem_id: str | None = None,
    referencia_externa: str | None = None,
    observacao: str | None = None,
) -> EstoqueDocumento:
    tipo_movimento = (
        tipo_movimento
        .strip()
        .upper()
    )

    origem_modulo = (
        str(origem_modulo or "manual")
        .strip()
        .lower()
        or "manual"
    )

    documento_origem_id = (
        _normalizar_id(
            documento_origem_id
        )
        or None
    )

    referencia_externa = (
        str(
            referencia_externa or ""
        ).strip()
        or None
    )

    if tipo_movimento not in MOVIMENTOS_VALIDOS:
        raise EstoqueErro(
            "Tipo de movimento invÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡lido."
        )

    if not itens:
        raise EstoqueErro(
            "O documento precisa possuir pelo menos um item."
        )

    produtos_tocados: set[str] = set()
    lotes_tocados: set[str] = set()

    try:
        with db.begin():
            existente = (
                _obter_documento_idempotente(
                    db,
                    tipo_movimento=tipo_movimento,
                    origem_modulo=origem_modulo,
                    documento_origem_id=(
                        documento_origem_id
                    ),
                    referencia_externa=(
                        referencia_externa
                    ),
                )
            )

            if existente is not None:
                return existente

            documento = EstoqueDocumento(
                numero=_proximo_numero_documento(
                    db
                ),
                tipo_movimento=tipo_movimento,
                status="rascunho",
                origem_modulo=origem_modulo,
                documento_origem_id=(
                    documento_origem_id
                ),
                referencia_externa=(
                    referencia_externa
                ),
                data_documento=_agora(),
                usuario_id=usuario_id,
                observacao=observacao,
            )

            db.add(documento)
            db.flush()

            numero_item = 0

            for dados in itens:
                produto_id = _normalizar_id(
                    dados.get(
                        "produto_id"
                    )
                )

                if not produto_id:
                    raise EstoqueErro(
                        "Produto obrigatÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³rio."
                    )

                quantidade_informada = _qtd(
                    dados.get(
                        "quantidade"
                    )
                )

                if quantidade_informada <= 0:
                    raise EstoqueErro(
                        "A quantidade deve ser maior que zero."
                    )

                produto, setor = _obter_produto(
                    db,
                    produto_id,
                )

                controla_validade = bool(
                    setor
                    and setor.controla_validade
                )

                fator_override = dados.get(
                    "fator_conversao"
                )

                if (
                    fator_override is not None
                    and fator_override != ""
                ):
                    fator_conversao = _custo(
                        fator_override
                    )

                    if fator_conversao <= 0:
                        raise EstoqueErro(
                            "Fator de convers?o deve ser maior que zero."
                        )

                    quantidade = _qtd(
                        quantidade_informada
                        * fator_conversao
                    )

                    unidade = (
                        str(
                            produto.unidade
                            or dados.get("unidade")
                            or "un"
                        )
                        .strip()
                    )

                    unidade_informada = (
                        str(
                            dados.get("unidade")
                            or unidade
                        )
                        .strip()
                    )
                else:
                    try:
                        conversao = converter_quantidade_estoque(
                            produto,
                            quantidade_informada,
                            dados.get("unidade"),
                        )
                    except ValueError as erro:
                        raise EstoqueErro(
                            str(erro)
                        )

                    quantidade = _qtd(
                        conversao[
                            "quantidade_base"
                        ]
                    )

                    unidade = conversao[
                        "unidade_base"
                    ]

                    unidade_informada = conversao[
                        "unidade_informada"
                    ]

                    fator_conversao = _custo(
                        conversao[
                            "fator_conversao"
                        ]
                    )

                produtos_tocados.add(
                    produto.id
                )

                if (
                    tipo_movimento
                    in MOVIMENTOS_ENTRADA
                ):
                    deposito_destino = _normalizar_id(
                        dados.get(
                            "deposito_destino_id"
                        )
                    )

                    gaveta_destino = _normalizar_id(
                        dados.get(
                            "gaveta_destino_id"
                        )
                    )

                    lote_destino = _normalizar_id(
                        dados.get(
                            "lote_destino_id"
                        )
                    )

                    _validar_local(
                        db,
                        deposito_destino,
                        gaveta_destino,
                    )

                    if controla_validade:
                        if not lote_destino:
                            lote_criado = (
                                _obter_ou_criar_lote_entrada(
                                    db,
                                    produto=produto,
                                    deposito_id=deposito_destino,
                                    gaveta_id=gaveta_destino,
                                    data_validade=dados.get(
                                        "data_validade"
                                    ),
                                )
                            )

                            lote_destino = (
                                lote_criado.id
                            )

                        else:
                            _validar_lote(
                                db,
                                produto.id,
                                lote_destino,
                            )

                        lotes_tocados.add(
                            lote_destino
                        )

                    else:
                        lote_destino = ""

                    custo_unitario = _custo(
                        dados.get(
                            "custo_unitario",
                            produto.custo_unitario
                            or 0,
                        )
                    )

                    _adicionar_saldo(
                        db,
                        produto_id=produto.id,
                        deposito_id=deposito_destino,
                        gaveta_id=gaveta_destino,
                        lote_id=lote_destino,
                        quantidade=quantidade,
                        custo_unitario=custo_unitario,
                    )

                    numero_item += 1

                    _registrar_item(
                        db,
                        documento=documento,
                        item_numero=numero_item,
                        produto_id=produto.id,
                        quantidade=quantidade,
                        unidade=unidade,
                        quantidade_informada=quantidade_informada,
                        unidade_informada=unidade_informada,
                        fator_conversao=fator_conversao,
                        deposito_destino_id=deposito_destino,
                        gaveta_destino_id=gaveta_destino,
                        lote_destino_id=lote_destino,
                        custo_unitario=custo_unitario,
                        observacao=dados.get(
                            "observacao"
                        ),
                    )

                elif (
                    tipo_movimento
                    in MOVIMENTOS_SAIDA
                ):
                    deposito_origem = _normalizar_id(
                        dados.get(
                            "deposito_origem_id"
                        )
                    )

                    gaveta_origem = _normalizar_id(
                        dados.get(
                            "gaveta_origem_id"
                        )
                    )

                    lote_origem = _normalizar_id(
                        dados.get(
                            "lote_origem_id"
                        )
                    )

                    _validar_local(
                        db,
                        deposito_origem,
                        gaveta_origem,
                    )

                    alocacoes = _alocar_saida_fefo(
                        db,
                        produto=produto,
                        controla_validade=controla_validade,
                        deposito_id=deposito_origem,
                        gaveta_id=gaveta_origem,
                        lote_solicitado_id=lote_origem,
                        quantidade=quantidade,
                    )

                    for alocacao in alocacoes:
                        lote_usado = (
                            alocacao[
                                "lote_id"
                            ]
                        )

                        if lote_usado:
                            lotes_tocados.add(
                                lote_usado
                            )

                        numero_item += 1

                        _registrar_item(
                            db,
                            documento=documento,
                            item_numero=numero_item,
                            produto_id=produto.id,
                            quantidade=alocacao[
                                "quantidade"
                            ],
                            unidade=unidade,
                        quantidade_informada=quantidade_informada,
                        unidade_informada=unidade_informada,
                        fator_conversao=fator_conversao,
                            deposito_origem_id=deposito_origem,
                            gaveta_origem_id=gaveta_origem,
                            lote_origem_id=lote_usado,
                            custo_unitario=alocacao[
                                "custo_unitario"
                            ],
                            observacao=dados.get(
                                "observacao"
                            ),
                        )

                elif (
                    tipo_movimento
                    in MOVIMENTOS_TRANSFERENCIA
                ):
                    deposito_origem = _normalizar_id(
                        dados.get(
                            "deposito_origem_id"
                        )
                    )

                    gaveta_origem = _normalizar_id(
                        dados.get(
                            "gaveta_origem_id"
                        )
                    )

                    lote_origem = _normalizar_id(
                        dados.get(
                            "lote_origem_id"
                        )
                    )

                    deposito_destino = _normalizar_id(
                        dados.get(
                            "deposito_destino_id"
                        )
                    )

                    gaveta_destino = _normalizar_id(
                        dados.get(
                            "gaveta_destino_id"
                        )
                    )

                    _validar_local(
                        db,
                        deposito_origem,
                        gaveta_origem,
                    )

                    _validar_local(
                        db,
                        deposito_destino,
                        gaveta_destino,
                    )

                    if (
                        deposito_origem
                        == deposito_destino
                        and gaveta_origem
                        == gaveta_destino
                    ):
                        raise EstoqueErro(
                            "Origem e destino da transferÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªncia sÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o iguais."
                        )

                    alocacoes = _alocar_saida_fefo(
                        db,
                        produto=produto,
                        controla_validade=controla_validade,
                        deposito_id=deposito_origem,
                        gaveta_id=gaveta_origem,
                        lote_solicitado_id=lote_origem,
                        quantidade=quantidade,
                    )

                    for alocacao in alocacoes:
                        lote_usado = (
                            alocacao[
                                "lote_id"
                            ]
                        )

                        if lote_usado:
                            lotes_tocados.add(
                                lote_usado
                            )

                        _adicionar_saldo(
                            db,
                            produto_id=produto.id,
                            deposito_id=deposito_destino,
                            gaveta_id=gaveta_destino,
                            lote_id=lote_usado,
                            quantidade=alocacao[
                                "quantidade"
                            ],
                            custo_unitario=alocacao[
                                "custo_unitario"
                            ],
                        )

                        numero_item += 1

                        _registrar_item(
                            db,
                            documento=documento,
                            item_numero=numero_item,
                            produto_id=produto.id,
                            quantidade=alocacao[
                                "quantidade"
                            ],
                            unidade=unidade,
                        quantidade_informada=quantidade_informada,
                        unidade_informada=unidade_informada,
                        fator_conversao=fator_conversao,
                            deposito_origem_id=deposito_origem,
                            gaveta_origem_id=gaveta_origem,
                            lote_origem_id=lote_usado,
                            deposito_destino_id=deposito_destino,
                            gaveta_destino_id=gaveta_destino,
                            lote_destino_id=lote_usado,
                            custo_unitario=alocacao[
                                "custo_unitario"
                            ],
                            observacao=dados.get(
                                "observacao"
                            ),
                        )

            for produto_id in produtos_tocados:
                _recalcular_produto(
                    db,
                    produto_id,
                )

            for lote_id in lotes_tocados:
                _recalcular_lote(
                    db,
                    lote_id,
                )

            documento.status = (
                "contabilizado"
            )

            documento.contabilizado_em = (
                _agora()
            )

            documento.contabilizado_por_id = (
                usuario_id
            )

            db.flush()

        db.refresh(documento)

        return documento

    except Exception:
        db.rollback()
        raise



def _restaurar_reservas_consumidas_no_estorno(
    db: Session,
    *,
    documento_original_id: str,
    documento_estorno_id: str,
    usuario_id: str,
    motivo: str | None = None,
) -> int:
    """
    Restaura reservas consumidas pelo documento que está sendo estornado.

    Tudo acontece dentro da mesma transação do estorno:
    - devolve a quantidade consumida à reserva;
    - recompõe quantidade_reservada no saldo;
    - reativa a reserva;
    - registra evento imutável ESTORNO_CONSUMO.
    """

    from sqlalchemy import select as _select

    from app.models import (
        EstoqueReserva,
        EstoqueReservaEvento,
        EstoqueSaldo,
    )

    eventos = db.scalars(
        _select(
            EstoqueReservaEvento
        )
        .where(
            EstoqueReservaEvento.tipo
            == "CONSUMO",
            EstoqueReservaEvento.documento_estoque_id
            == documento_original_id,
        )
        .with_for_update()
    ).all()

    restauradas = 0

    for evento in eventos:
        quantidade = _qtd(
            evento.quantidade
        )

        if quantidade <= 0:
            continue

        reserva = db.scalar(
            _select(
                EstoqueReserva
            )
            .where(
                EstoqueReserva.id
                == evento.reserva_id
            )
            .with_for_update()
        )

        if reserva is None:
            raise EstoqueErro(
                "Não foi possível estornar o consumo: "
                f"reserva {evento.reserva_id} não encontrada."
            )

        #
        # Se a reserva foi cancelada depois do consumo,
        # o estorno precisa ser bloqueado.
        #
        # Isso evita transformar uma reserva cancelada
        # novamente em reserva ativa silenciosamente.
        #
        if reserva.status == "cancelada":
            raise EstoqueErro(
                "Não é possível estornar este consumo porque "
                f"a reserva {reserva.id} foi cancelada."
            )

        consumida_atual = _qtd(
            reserva.quantidade_consumida
        )

        if quantidade > consumida_atual:
            raise EstoqueErro(
                "Inconsistência na reserva durante o estorno. "
                f"Reserva: {reserva.id}. "
                f"Consumido registrado: {consumida_atual}. "
                f"Quantidade a restaurar: {quantidade}."
            )

        saldo = db.scalar(
            _select(
                EstoqueSaldo
            )
            .where(
                EstoqueSaldo.id
                == reserva.saldo_id
            )
            .with_for_update()
        )

        if saldo is None:
            raise EstoqueErro(
                "Não foi possível restaurar a reserva porque "
                f"a posição de estoque {reserva.saldo_id} "
                "não foi encontrada."
            )

        fisico = _qtd(
            saldo.quantidade
        )

        reservado_atual = _qtd(
            saldo.quantidade_reservada
        )

        novo_reservado = _qtd(
            reservado_atual
            + quantidade
        )

        if novo_reservado > fisico:
            raise EstoqueErro(
                "Inconsistência ao restaurar reserva no estorno. "
                f"Estoque físico: {fisico}. "
                f"Reservado após restauração: {novo_reservado}."
            )

        nova_consumida = _qtd(
            consumida_atual
            - quantidade
        )

        saldo.quantidade_reservada = (
            novo_reservado
        )

        reserva.quantidade_consumida = (
            nova_consumida
        )

        #
        # Depois que o consumo é desfeito,
        # a reserva volta a possuir quantidade pendente.
        #
        reserva.status = "ativa"
        reserva.consumida_em = None

        evento_estorno = EstoqueReservaEvento(
            reserva_id=reserva.id,
            tipo="ESTORNO_CONSUMO",
            quantidade=quantidade,
            usuario_id=usuario_id,
            documento_estoque_id=(
                documento_estorno_id
            ),
            motivo=(
                motivo
                or (
                    "Estorno do consumo do documento "
                    f"{documento_original_id}"
                )
            ),
        )

        db.add(
            evento_estorno
        )

        restauradas += 1

    return restauradas

def estornar_documento(
    db: Session,
    *,
    documento_id: str,
    usuario_id: str,
    motivo: str,
) -> EstoqueDocumento:
    motivo = (motivo or "").strip()

    if len(motivo) < 3:
        raise EstoqueErro(
            "Informe o motivo do estorno."
        )

    try:
        with db.begin():
            original = db.scalar(
                select(EstoqueDocumento)
                .where(
                    EstoqueDocumento.id
                    == documento_id
                )
                .with_for_update()
            )

            if original is None:
                raise EstoqueErro(
                    "Documento de estoque nÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o encontrado."
                )

            if original.status == "estornado":
                raise EstoqueErro(
                    "Este documento jÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ foi estornado."
                )

            if original.status != "contabilizado":
                raise EstoqueErro(
                    "Somente documentos contabilizados podem ser estornados."
                )

            if (
                original.tipo_movimento == "ESTORNO"
                or original.estorno_de_id
            ):
                raise EstoqueErro(
                    "NÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â© permitido estornar um documento de estorno."
                )

            itens_originais = db.scalars(
                select(EstoqueDocumentoItem)
                .where(
                    EstoqueDocumentoItem.documento_id
                    == original.id
                )
                .order_by(
                    EstoqueDocumentoItem.item_numero
                )
            ).all()

            if not itens_originais:
                raise EstoqueErro(
                    "O documento nÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o possui itens para estornar."
                )

            estorno = EstoqueDocumento(
                numero=_proximo_numero_documento(
                    db
                ),
                tipo_movimento="ESTORNO",
                status="rascunho",
                origem_modulo="estorno",
                documento_origem_id=original.id,
                referencia_externa=original.numero,
                data_documento=_agora(),
                usuario_id=usuario_id,
                estorno_de_id=original.id,
                motivo_estorno=motivo,
                observacao=(
                    f"Estorno do documento "
                    f"{original.numero}"
                ),
            )

            db.add(estorno)
            db.flush()

            produtos_tocados: set[str] = set()
            lotes_tocados: set[str] = set()

            numero_item = 0

            for item in itens_originais:
                quantidade = _qtd(
                    item.quantidade
                )

                produto, _ = _obter_produto(
                    db,
                    item.produto_id,
                )

                produtos_tocados.add(
                    produto.id
                )

                #
                # ESTORNO DE ENTRADA
                #
                # A mercadoria havia entrado.
                # Agora precisa sair exatamente
                # da posiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o onde foi armazenada.
                #
                if (
                    original.tipo_movimento
                    in MOVIMENTOS_ENTRADA
                ):
                    deposito = _normalizar_id(
                        item.deposito_destino_id
                    )

                    gaveta = _normalizar_id(
                        item.gaveta_destino_id
                    )

                    lote = _normalizar_id(
                        item.lote_destino_id
                    )

                    custo_saida = _subtrair_saldo(
                        db,
                        produto_id=produto.id,
                        deposito_id=deposito,
                        gaveta_id=gaveta,
                        lote_id=lote,
                        quantidade=quantidade,
                    )

                    if lote:
                        lotes_tocados.add(
                            lote
                        )

                    numero_item += 1

                    _registrar_item(
                        db,
                        documento=estorno,
                        item_numero=numero_item,
                        produto_id=produto.id,
                        quantidade=quantidade,
                        unidade=item.unidade,
                        deposito_origem_id=deposito,
                        gaveta_origem_id=gaveta,
                        lote_origem_id=lote,
                        custo_unitario=custo_saida,
                        observacao=(
                            f"Estorno do item "
                            f"{item.item_numero} "
                            f"de {original.numero}"
                        ),
                    )

                #
                # ESTORNO DE SAÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂDA
                #
                # A mercadoria havia saÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­do.
                # Agora volta para a posiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o
                # original.
                #
                elif (
                    original.tipo_movimento
                    in MOVIMENTOS_SAIDA
                ):
                    deposito = _normalizar_id(
                        item.deposito_origem_id
                    )

                    gaveta = _normalizar_id(
                        item.gaveta_origem_id
                    )

                    lote = _normalizar_id(
                        item.lote_origem_id
                    )

                    custo_original = _custo(
                        item.custo_unitario
                    )

                    _adicionar_saldo(
                        db,
                        produto_id=produto.id,
                        deposito_id=deposito,
                        gaveta_id=gaveta,
                        lote_id=lote,
                        quantidade=quantidade,
                        custo_unitario=custo_original,
                    )

                    if lote:
                        lotes_tocados.add(
                            lote
                        )

                    numero_item += 1

                    _registrar_item(
                        db,
                        documento=estorno,
                        item_numero=numero_item,
                        produto_id=produto.id,
                        quantidade=quantidade,
                        unidade=item.unidade,
                        deposito_destino_id=deposito,
                        gaveta_destino_id=gaveta,
                        lote_destino_id=lote,
                        custo_unitario=custo_original,
                        observacao=(
                            f"Estorno do item "
                            f"{item.item_numero} "
                            f"de {original.numero}"
                        ),
                    )

                #
                # ESTORNO DE TRANSFERÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â NCIA
                #
                # Retira do destino e devolve
                # para a origem.
                #
                elif (
                    original.tipo_movimento
                    in MOVIMENTOS_TRANSFERENCIA
                ):
                    deposito_saida = _normalizar_id(
                        item.deposito_destino_id
                    )

                    gaveta_saida = _normalizar_id(
                        item.gaveta_destino_id
                    )

                    lote_saida = _normalizar_id(
                        item.lote_destino_id
                    )

                    deposito_retorno = _normalizar_id(
                        item.deposito_origem_id
                    )

                    gaveta_retorno = _normalizar_id(
                        item.gaveta_origem_id
                    )

                    lote_retorno = _normalizar_id(
                        item.lote_origem_id
                    )

                    custo_retorno = _subtrair_saldo(
                        db,
                        produto_id=produto.id,
                        deposito_id=deposito_saida,
                        gaveta_id=gaveta_saida,
                        lote_id=lote_saida,
                        quantidade=quantidade,
                    )

                    _adicionar_saldo(
                        db,
                        produto_id=produto.id,
                        deposito_id=deposito_retorno,
                        gaveta_id=gaveta_retorno,
                        lote_id=lote_retorno,
                        quantidade=quantidade,
                        custo_unitario=custo_retorno,
                    )

                    if lote_saida:
                        lotes_tocados.add(
                            lote_saida
                        )

                    if lote_retorno:
                        lotes_tocados.add(
                            lote_retorno
                        )

                    numero_item += 1

                    _registrar_item(
                        db,
                        documento=estorno,
                        item_numero=numero_item,
                        produto_id=produto.id,
                        quantidade=quantidade,
                        unidade=item.unidade,
                        deposito_origem_id=deposito_saida,
                        gaveta_origem_id=gaveta_saida,
                        lote_origem_id=lote_saida,
                        deposito_destino_id=deposito_retorno,
                        gaveta_destino_id=gaveta_retorno,
                        lote_destino_id=lote_retorno,
                        custo_unitario=custo_retorno,
                        observacao=(
                            f"Estorno do item "
                            f"{item.item_numero} "
                            f"de {original.numero}"
                        ),
                    )

                else:
                    raise EstoqueErro(
                        "O tipo do documento original "
                        "nÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o suporta estorno."
                    )

            #
            # Se o documento original nasceu do consumo
            # de uma reserva, o mesmo estorno precisa
            # restaurar também a reserva.
            #
            _restaurar_reservas_consumidas_no_estorno(
                db,
                documento_original_id=original.id,
                documento_estorno_id=estorno.id,
                usuario_id=usuario_id,
                motivo=motivo,
            )
            for produto_id in produtos_tocados:
                _recalcular_produto(
                    db,
                    produto_id,
                )

            for lote_id in lotes_tocados:
                _recalcular_lote(
                    db,
                    lote_id,
                )

            agora = _agora()

            estorno.status = "contabilizado"
            estorno.contabilizado_em = agora
            estorno.contabilizado_por_id = (
                usuario_id
            )

            original.status = "estornado"
            original.estornado_em = agora
            original.estornado_por_usuario_id = (
                usuario_id
            )
            original.estornado_por_documento_id = (
                estorno.id
            )

            db.flush()

        db.refresh(estorno)

        return estorno

    except Exception:
        db.rollback()
        raise