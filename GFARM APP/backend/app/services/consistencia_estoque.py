from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import EstoqueSaldo, Produto


ZERO = Decimal("0")
TOLERANCIA = Decimal("0.001")


def _decimal(valor) -> Decimal:
    if valor is None:
        return ZERO

    return Decimal(str(valor))


def verificar_consistencia_estoque(db: Session) -> dict:
    """
    Verificacao de consistencia SOMENTE LEITURA.

    Fonte oficial:
        estoque_saldos

    Esta rotina:
    - nao cria movimentacoes;
    - nao altera saldos;
    - nao altera Produto.quantidade;
    - nao faz commit;
    - apenas identifica divergencias.
    """

    saldos = db.scalars(
        select(EstoqueSaldo)
    ).all()

    produtos = db.scalars(
        select(Produto)
    ).all()

    totais_por_produto: dict[str, Decimal] = {}
    reservados_por_produto: dict[str, Decimal] = {}

    saldos_negativos = []
    reservas_invalidas = []

    for saldo in saldos:
        quantidade = _decimal(
            saldo.quantidade
        )

        reservada = _decimal(
            saldo.quantidade_reservada
        )

        totais_por_produto[saldo.produto_id] = (
            totais_por_produto.get(
                saldo.produto_id,
                ZERO,
            )
            + quantidade
        )

        reservados_por_produto[saldo.produto_id] = (
            reservados_por_produto.get(
                saldo.produto_id,
                ZERO,
            )
            + reservada
        )

        if quantidade < ZERO:
            saldos_negativos.append(
                {
                    "saldo_id": saldo.id,
                    "produto_id": saldo.produto_id,
                    "deposito_id": saldo.deposito_id,
                    "gaveta_id": saldo.gaveta_id,
                    "lote_id": saldo.lote_id,
                    "tipo_estoque": saldo.tipo_estoque,
                    "quantidade": float(
                        quantidade
                    ),
                }
            )

        if (
            reservada < ZERO
            or reservada > quantidade
        ):
            reservas_invalidas.append(
                {
                    "saldo_id": saldo.id,
                    "produto_id": saldo.produto_id,
                    "deposito_id": saldo.deposito_id,
                    "gaveta_id": saldo.gaveta_id,
                    "lote_id": saldo.lote_id,
                    "quantidade": float(
                        quantidade
                    ),
                    "quantidade_reservada": float(
                        reservada
                    ),
                }
            )

    divergencias = []

    for produto in produtos:
        saldo_erp = totais_por_produto.get(
            produto.id,
            ZERO,
        )

        saldo_compatibilidade = _decimal(
            produto.quantidade
        )

        diferenca = (
            saldo_compatibilidade
            - saldo_erp
        )

        if abs(diferenca) > TOLERANCIA:
            divergencias.append(
                {
                    "produto_id": produto.id,
                    "codigo": produto.codigo,
                    "nome": produto.nome,
                    "saldo_erp": float(
                        saldo_erp
                    ),
                    "produto_quantidade": float(
                        saldo_compatibilidade
                    ),
                    "divergencia": float(
                        diferenca
                    ),
                }
            )

    produtos_com_saldo = {
        produto_id
        for produto_id, quantidade
        in totais_por_produto.items()
        if quantidade != ZERO
    }

    produtos_com_reserva = {
        produto_id
        for produto_id, quantidade
        in reservados_por_produto.items()
        if quantidade != ZERO
    }

    return {
        "verificado_em": datetime.now(
            timezone.utc
        ).isoformat(),

        "modo": "somente_leitura",

        "fonte_oficial": "estoque_saldos",

        "total_posicoes_saldo": len(
            saldos
        ),

        "total_produtos": len(
            produtos
        ),

        "produtos_com_saldo": len(
            produtos_com_saldo
        ),

        "produtos_com_reserva": len(
            produtos_com_reserva
        ),

        "produtos_com_divergencia": len(
            divergencias
        ),

        "saldos_negativos": len(
            saldos_negativos
        ),

        "reservas_invalidas": len(
            reservas_invalidas
        ),

        "divergencias": divergencias[:100],

        "detalhes_saldos_negativos": (
            saldos_negativos[:100]
        ),

        "detalhes_reservas_invalidas": (
            reservas_invalidas[:100]
        ),
    }
