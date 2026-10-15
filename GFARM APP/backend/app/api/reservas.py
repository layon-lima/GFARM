from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.core.access_control import (
    acesso_estoque_apenas_mobile,
    exigir_leitura_estoque,
    pagina_da_origem,
    produtos_em_setores_mobile,
    setores_mobile_ids,
    tem_pagina,
)
from app.db.database import get_db
from app.models import (
    EstoqueReserva,
    EstoqueReservaEvento,
    Produto,
    User,
)
from app.services.reservas_estoque import (
    ReservaErro,
    cancelar_reserva,
    consumir_reserva,
    reservar_estoque,
    saldo_reserva,
)


router = APIRouter(
    prefix="/api/estoque/reservas",
    tags=["Reservas de Estoque"],
)


class CriarReservaRequest(BaseModel):
    produto_id: str
    deposito_id: str

    quantidade: Decimal = Field(gt=0)
    unidade: str | None = None

    gaveta_id: str | None = None
    lote_id: str | None = None

    origem_modulo: str
    documento_origem_id: str

    referencia: str | None = None
    observacao: str | None = None


class CancelarReservaRequest(BaseModel):
    motivo: str = Field(
        min_length=3,
        max_length=500,
    )


class ConsumirReservaRequest(BaseModel):
    quantidade: Decimal = Field(gt=0)

    tipo_movimento: str = (
        "SAIDA_CONSUMO"
    )

    observacao: str | None = None


def _numero(valor):
    if valor is None:
        return 0

    return float(valor)


def _serializar_reserva(
    reserva: EstoqueReserva,
):
    resumo = saldo_reserva(
        reserva
    )

    return {
        "id": reserva.id,

        "saldo_id": reserva.saldo_id,

        "produto_id": reserva.produto_id,
        "deposito_id": reserva.deposito_id,

        "gaveta_id": (
            reserva.gaveta_id
            or None
        ),

        "lote_id": (
            reserva.lote_id
            or None
        ),

        "quantidade": _numero(
            reserva.quantidade
        ),

        "quantidade_consumida": _numero(
            reserva.quantidade_consumida
        ),

        "quantidade_restante": (
            resumo[
                "quantidade_restante"
            ]
        ),

        "status": reserva.status,

        "origem_modulo": (
            reserva.origem_modulo
        ),

        "documento_origem_id": (
            reserva.documento_origem_id
        ),

        "referencia": reserva.referencia,

        "usuario_id": reserva.usuario_id,

        "observacao": reserva.observacao,

        "created_at": reserva.created_at,

        "consumida_em": (
            reserva.consumida_em
        ),

        "cancelada_em": (
            reserva.cancelada_em
        ),
    }


def _exigir_acesso_reserva(
    current_user: User,
    origem_modulo: str | None,
    produto_ids: list[str],
    db: Session,
):
    if tem_pagina(
        current_user,
        "movimentacoes",
    ):
        return

    pagina = pagina_da_origem(
        origem_modulo
    )

    if tem_pagina(
        current_user,
        pagina,
    ):
        return

    if produtos_em_setores_mobile(
        current_user,
        produto_ids,
        db,
    ):
        return

    raise HTTPException(
        status_code=403,
        detail=(
            "Usuário sem permissão para "
            "operar esta reserva de estoque."
        ),
    )


def _exigir_acesso_reserva_existente(
    reserva: EstoqueReserva,
    current_user: User,
    db: Session,
):
    _exigir_acesso_reserva(
        current_user,
        reserva.origem_modulo,
        [reserva.produto_id],
        db,
    )


@router.post("")
def criar_reserva(
    dados: CriarReservaRequest,
    current_user: User = Depends(
        get_current_user
    ),
    db: Session = Depends(get_db),
):
    _exigir_acesso_reserva(
        current_user,
        dados.origem_modulo,
        [dados.produto_id],
        db,
    )

    usuario_id = current_user.id

    #
    # A autenticação já fez leitura usando
    # esta sessão. Encerramos essa transação
    # antes do serviço abrir a transação
    # de estoque.
    #
    db.rollback()

    try:
        reservas = reservar_estoque(
            db,

            produto_id=(
                dados.produto_id
            ),

            deposito_id=(
                dados.deposito_id
            ),

            gaveta_id=(
                dados.gaveta_id
                or ""
            ),

            lote_id=(
                dados.lote_id
                or ""
            ),

            quantidade=(
                dados.quantidade
            ),

            unidade=(
                dados.unidade
            ),

            usuario_id=usuario_id,

            origem_modulo=(
                dados.origem_modulo
            ),

            documento_origem_id=(
                dados.documento_origem_id
            ),

            referencia=(
                dados.referencia
            ),

            observacao=(
                dados.observacao
            ),
        )

        return {
            "success": True,

            "message": (
                "Estoque reservado com sucesso."
            ),

            #
            # Pode retornar mais de uma reserva
            # quando o FEFO dividir a quantidade
            # entre vários lotes.
            #
            "reservas": [
                _serializar_reserva(
                    reserva
                )
                for reserva
                in reservas
            ],
        }

    except ReservaErro as erro:
        raise HTTPException(
            status_code=400,
            detail=str(erro),
        )


@router.post(
    "/{reserva_id}/cancelar"
)
def cancelar(
    reserva_id: str,
    dados: CancelarReservaRequest,
    current_user: User = Depends(
        get_current_user
    ),
    db: Session = Depends(get_db),
):
    reserva_atual = db.get(
        EstoqueReserva,
        reserva_id,
    )

    if reserva_atual is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Reserva não encontrada."
            ),
        )

    _exigir_acesso_reserva_existente(
        reserva_atual,
        current_user,
        db,
    )

    usuario_id = current_user.id

    db.rollback()

    try:
        reserva = cancelar_reserva(
            db,
            reserva_id=reserva_id,
            usuario_id=usuario_id,
            motivo=dados.motivo,
        )

        return {
            "success": True,

            "message": (
                "Reserva cancelada e "
                "saldo liberado."
            ),

            "reserva": (
                _serializar_reserva(
                    reserva
                )
            ),
        }

    except ReservaErro as erro:
        raise HTTPException(
            status_code=400,
            detail=str(erro),
        )


@router.post(
    "/{reserva_id}/consumir"
)
def consumir(
    reserva_id: str,
    dados: ConsumirReservaRequest,
    current_user: User = Depends(
        get_current_user
    ),
    db: Session = Depends(get_db),
):
    reserva_atual = db.get(
        EstoqueReserva,
        reserva_id,
    )

    if reserva_atual is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Reserva não encontrada."
            ),
        )

    _exigir_acesso_reserva_existente(
        reserva_atual,
        current_user,
        db,
    )

    usuario_id = current_user.id

    db.rollback()

    try:
        reserva, documento = (
            consumir_reserva(
                db,

                reserva_id=reserva_id,

                quantidade=(
                    dados.quantidade
                ),

                usuario_id=usuario_id,

                tipo_movimento=(
                    dados.tipo_movimento
                ),

                observacao=(
                    dados.observacao
                ),
            )
        )

        return {
            "success": True,

            "message": (
                f"Reserva consumida através "
                f"do documento "
                f"{documento.numero}."
            ),

            "reserva": (
                _serializar_reserva(
                    reserva
                )
            ),

            "documento": {
                "id": documento.id,
                "numero": documento.numero,
                "tipo_movimento": (
                    documento.tipo_movimento
                ),
                "status": documento.status,
            },
        }

    except ReservaErro as erro:
        raise HTTPException(
            status_code=400,
            detail=str(erro),
        )


@router.get("")
def listar_reservas(
    produto_id: str | None = None,

    documento_origem_id: str | None = None,

    status: str | None = None,

    current_user: User = Depends(
        get_current_user
    ),

    db: Session = Depends(get_db),
):
    exigir_leitura_estoque(
        current_user
    )

    stmt = (
        select(EstoqueReserva)
        .order_by(
            EstoqueReserva.created_at.desc()
        )
    )

    if acesso_estoque_apenas_mobile(
        current_user
    ):
        produtos_permitidos = (
            select(Produto.id)
            .where(
                Produto.setor_id.in_(
                    sorted(
                        setores_mobile_ids(
                            current_user
                        )
                    )
                )
            )
        )

        stmt = stmt.where(
            EstoqueReserva.produto_id.in_(
                produtos_permitidos
            )
        )

    if produto_id:
        stmt = stmt.where(
            EstoqueReserva.produto_id
            == produto_id
        )

    if documento_origem_id:
        stmt = stmt.where(
            EstoqueReserva.documento_origem_id
            == documento_origem_id
        )

    if status:
        stmt = stmt.where(
            EstoqueReserva.status
            == status
        )

    reservas = db.scalars(
        stmt
    ).all()

    return [
        _serializar_reserva(
            reserva
        )
        for reserva
        in reservas
    ]


@router.get(
    "/{reserva_id}/eventos"
)
def listar_eventos(
    reserva_id: str,

    current_user: User = Depends(
        get_current_user
    ),

    db: Session = Depends(get_db),
):
    reserva = db.get(
        EstoqueReserva,
        reserva_id,
    )

    if reserva is None:
        raise HTTPException(
            status_code=404,
            detail="Reserva não encontrada.",
        )

    _exigir_acesso_reserva_existente(
        reserva,
        current_user,
        db,
    )

    eventos = db.scalars(
        select(
            EstoqueReservaEvento
        )
        .where(
            EstoqueReservaEvento.reserva_id
            == reserva_id
        )
        .order_by(
            EstoqueReservaEvento.created_at
        )
    ).all()

    return [
        {
            "id": evento.id,

            "tipo": evento.tipo,

            "quantidade": _numero(
                evento.quantidade
            ),

            "usuario_id": (
                evento.usuario_id
            ),

            "documento_estoque_id": (
                evento.documento_estoque_id
            ),

            "motivo": evento.motivo,

            "created_at": (
                evento.created_at
            ),
        }

        for evento
        in eventos
    ]
