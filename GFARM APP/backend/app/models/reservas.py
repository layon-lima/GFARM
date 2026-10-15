from __future__ import annotations

import uuid

from sqlalchemy import (
    DateTime,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import mapped_column

from app.db.database import Base


def novo_id() -> str:
    return str(uuid.uuid4())


class EstoqueReserva(Base):
    __tablename__ = "estoque_reservas"

    id = mapped_column(
        String(100),
        primary_key=True,
        default=novo_id,
    )

    saldo_id = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    produto_id = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    deposito_id = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    gaveta_id = mapped_column(
        String(100),
        nullable=False,
        default="",
        index=True,
    )

    lote_id = mapped_column(
        String(100),
        nullable=False,
        default="",
        index=True,
    )

    #
    # Quantidade originalmente reservada.
    #
    quantidade = mapped_column(
        Numeric(18, 3),
        nullable=False,
    )

    #
    # Quanto já foi fisicamente consumido.
    #
    quantidade_consumida = mapped_column(
        Numeric(18, 3),
        nullable=False,
        default=0,
    )

    #
    # ativa
    # consumida
    # cancelada
    #
    status = mapped_column(
        String(30),
        nullable=False,
        default="ativa",
        index=True,
    )

    origem_modulo = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )

    documento_origem_id = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    referencia = mapped_column(
        String(255),
        nullable=True,
    )

    usuario_id = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    observacao = mapped_column(
        Text,
        nullable=True,
    )

    created_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    consumida_em = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    cancelada_em = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )


class EstoqueReservaEvento(Base):
    """
    Livro de auditoria da reserva.

    Nunca editar nem apagar eventos antigos.

    Exemplos:
        RESERVA      +100
        CONSUMO       -40
        CONSUMO       -20
        CANCELAMENTO  -40 restantes
    """

    __tablename__ = "estoque_reserva_eventos"

    id = mapped_column(
        String(100),
        primary_key=True,
        default=novo_id,
    )

    reserva_id = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    #
    # RESERVA
    # CONSUMO
    # CANCELAMENTO
    #
    tipo = mapped_column(
        String(30),
        nullable=False,
        index=True,
    )

    quantidade = mapped_column(
        Numeric(18, 3),
        nullable=False,
    )

    usuario_id = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    #
    # Preenchido quando o evento de consumo
    # gerar um documento real de estoque.
    #
    documento_estoque_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    motivo = mapped_column(
        Text,
        nullable=True,
    )

    created_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )
