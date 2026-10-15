from __future__ import annotations

import uuid

from sqlalchemy import (
    DateTime,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import mapped_column

from app.db.database import Base


def novo_id() -> str:
    return str(uuid.uuid4())


class EstoqueDocumento(Base):
    __tablename__ = "estoque_documentos"

    id = mapped_column(
        String(100),
        primary_key=True,
        default=novo_id,
    )

    numero = mapped_column(
        String(50),
        nullable=False,
        unique=True,
        index=True,
    )

    # Ex.:
    # ENTRADA_COMPRA
    # SAIDA_CONSUMO
    # TRANSFERENCIA
    # AJUSTE_POSITIVO
    # AJUSTE_NEGATIVO
    # INVENTARIO
    # ABASTECIMENTO
    # APLICACAO
    # PESAGEM
    # ESTORNO
    tipo_movimento = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )

    # rascunho | contabilizado | estornado
    status = mapped_column(
        String(30),
        nullable=False,
        default="rascunho",
        index=True,
    )

    # De onde nasceu o documento.
    # Ex.: manual, nfe, abastecimento, inventario...
    origem_modulo = mapped_column(
        String(50),
        nullable=False,
        default="manual",
        index=True,
    )

    # ID do documento de negócio que originou este movimento.
    # Ex.: abastecimento_id, inventario_id, ticket_id etc.
    documento_origem_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    # Ex.: número da NF, pedido, referência externa etc.
    referencia_externa = mapped_column(
        String(255),
        nullable=True,
        index=True,
    )

    data_documento = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )

    contabilizado_em = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    estornado_em = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    usuario_id = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    contabilizado_por_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    estornado_por_usuario_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    # Quando este documento é um estorno,
    # aponta para o documento original.
    estorno_de_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    # No documento original, aponta para
    # o documento que realizou o estorno.
    estornado_por_documento_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    motivo_estorno = mapped_column(
        Text,
        nullable=True,
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

    updated_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class EstoqueDocumentoItem(Base):
    __tablename__ = "estoque_documento_itens"

    __table_args__ = (
        UniqueConstraint(
            "documento_id",
            "item_numero",
            name="uq_estoque_documento_item",
        ),
    )

    id = mapped_column(
        String(100),
        primary_key=True,
        default=novo_id,
    )

    documento_id = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    item_numero = mapped_column(
        Integer,
        nullable=False,
    )

    produto_id = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    # Quantidade efetivamente contabilizada no estoque,
    # sempre na unidade-base do produto.
    quantidade = mapped_column(
        Numeric(18, 3),
        nullable=False,
    )

    # Unidade-base usada pelo estoque.
    # Ex.: KG, L, UN.
    unidade = mapped_column(
        String(30),
        nullable=False,
        default="un",
    )

    # Quantidade originalmente informada no documento.
    # Ex.: 2 CX.
    quantidade_informada = mapped_column(
        Numeric(18, 3),
        nullable=True,
    )

    # Unidade originalmente informada.
    # Ex.: CX.
    unidade_informada = mapped_column(
        String(30),
        nullable=True,
    )

    # Relação entre unidade informada e unidade-base.
    # Ex.: 1 CX = 50 KG -> fator 50.
    fator_conversao = mapped_column(
        Numeric(18, 6),
        nullable=False,
        default=1,
    )

    # SAÍDA / TRANSFERÊNCIA
    deposito_origem_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    gaveta_origem_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    lote_origem_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    # ENTRADA / TRANSFERÊNCIA
    deposito_destino_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    gaveta_destino_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    lote_destino_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    custo_unitario = mapped_column(
        Numeric(18, 6),
        nullable=False,
        default=0,
    )

    valor_total = mapped_column(
        Numeric(18, 2),
        nullable=False,
        default=0,
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


class EstoqueSaldo(Base):
    __tablename__ = "estoque_saldos"

    __table_args__ = (
        UniqueConstraint(
            "produto_id",
            "deposito_id",
            "gaveta_id",
            "lote_id",
            "tipo_estoque",
            name="uq_estoque_saldo_posicao",
        ),
    )

    id = mapped_column(
        String(100),
        primary_key=True,
        default=novo_id,
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

    # String vazia significa "sem gaveta".
    # Isso evita duplicação de saldo causada por NULL.
    gaveta_id = mapped_column(
        String(100),
        nullable=False,
        default="",
        index=True,
    )

    # String vazia significa "sem lote".
    lote_id = mapped_column(
        String(100),
        nullable=False,
        default="",
        index=True,
    )

    # livre | bloqueado | qualidade
    tipo_estoque = mapped_column(
        String(30),
        nullable=False,
        default="livre",
        index=True,
    )

    quantidade = mapped_column(
        Numeric(18, 3),
        nullable=False,
        default=0,
    )

    quantidade_reservada = mapped_column(
        Numeric(18, 3),
        nullable=False,
        default=0,
    )

    custo_medio = mapped_column(
        Numeric(18, 6),
        nullable=False,
        default=0,
    )

    valor_total = mapped_column(
        Numeric(18, 2),
        nullable=False,
        default=0,
    )

    updated_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
