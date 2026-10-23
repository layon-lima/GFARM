"""Distribuição autenticada do peso da Toledo pela VPS.

A porta RS-232 continua exclusiva do computador de pesagem. A VPS recebe
somente a última leitura, sem acionar a balança nem permitir pesar remotamente.
"""

from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.core.access_control import tem_pagina, tem_permissao
from app.db.database import engine, get_db
from app.models import User


router = APIRouter(prefix="/api/balanca/live", tags=["Balança ao vivo"])

BALANCA_ID = "toledo_principal"
# O receptor considera a fonte perdida se ela parar de publicar por 8 s.
TEMPO_SEM_SINAL_SEG = 8

CRIAR_TABELA = """
CREATE TABLE IF NOT EXISTS balanca_leitura_remota (
    id VARCHAR(40) PRIMARY KEY,
    peso_kg DOUBLE PRECISION NULL,
    conectada BOOLEAN NOT NULL DEFAULT FALSE,
    publicador_id VARCHAR(100) NOT NULL,
    atualizado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)
"""


def garantir_tabela_balanca_remota() -> None:
    """Protege instalações onde uma migração legada tenha sido adiada."""
    with engine.begin() as conn:
        conn.execute(text(CRIAR_TABELA))


class PublicacaoPeso(BaseModel):
    publicador_id: str = Field(
        min_length=20,
        max_length=100,
        pattern=r"^[a-zA-Z0-9_-]+$",
    )
    conectada: bool
    peso_kg: float | None = Field(default=None, ge=-500000, le=500000)


def exigir_acesso_pesagem(user: User) -> None:
    if tem_pagina(user, "pesagem") or tem_permissao(user, "admin.balanca.acessar"):
        return
    raise HTTPException(
        status_code=403,
        detail="Usuário sem permissão para visualizar a pesagem.",
    )


def retorno_leitura(registro) -> dict:
    if registro is None:
        return {
            "status": "sem_sinal",
            "online": False,
            "conectada": False,
            "peso_kg": None,
            "atualizado_em": None,
            "idade_segundos": None,
        }

    atualizado = registro["atualizado_em"]
    if atualizado.tzinfo is None:
        atualizado = atualizado.replace(tzinfo=timezone.utc)
    idade = max(0.0, (datetime.now(timezone.utc) - atualizado).total_seconds())
    fonte_ativa = idade <= TEMPO_SEM_SINAL_SEG
    conectada = fonte_ativa and bool(registro["conectada"])
    peso = registro["peso_kg"] if conectada else None
    if peso is not None and not isfinite(peso):
        peso = None

    status = "sem_sinal"
    if fonte_ativa:
        if not conectada:
            status = "desconectada"
        else:
            status = "ao_vivo" if peso is not None else "sem_leitura"

    return {
        "status": status,
        "online": status == "ao_vivo",
        "conectada": conectada,
        "peso_kg": peso,
        "atualizado_em": atualizado.isoformat(),
        "idade_segundos": round(idade, 1),
    }


@router.get("")
def consultar_peso(
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exigir_acesso_pesagem(user)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    registro = db.execute(
        text(
            """
            SELECT peso_kg, conectada, atualizado_em
            FROM balanca_leitura_remota
            WHERE id = :id
            """
        ),
        {"id": BALANCA_ID},
    ).mappings().first()
    return retorno_leitura(registro)


@router.post("")
def publicar_peso(
    payload: PublicacaoPeso,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exigir_acesso_pesagem(user)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"

    # A desconexão ou falta de frame recente nunca mantém peso antigo.
    peso = payload.peso_kg if payload.conectada else None
    if peso is not None and not isfinite(peso):
        raise HTTPException(status_code=422, detail="Peso inválido.")

    # Uma única estação é a publicadora ativa. Outras abas/computadores
    # aguardam 8 segundos após o último sinal antes de assumir a transmissão.
    atualizado = db.execute(
        text(
            """
            INSERT INTO balanca_leitura_remota (
                id, peso_kg, conectada, publicador_id, atualizado_em
            )
            VALUES (:id, :peso, :conectada, :publicador, now())
            ON CONFLICT (id) DO UPDATE
            SET peso_kg = EXCLUDED.peso_kg,
                conectada = EXCLUDED.conectada,
                publicador_id = EXCLUDED.publicador_id,
                atualizado_em = now()
            WHERE
                balanca_leitura_remota.publicador_id = EXCLUDED.publicador_id
                OR balanca_leitura_remota.atualizado_em
                    < now() - interval '8 seconds'
            RETURNING id
            """
        ),
        {
            "id": BALANCA_ID,
            "peso": peso,
            "conectada": bool(payload.conectada),
            "publicador": payload.publicador_id,
        },
    ).first()

    if atualizado is None:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Outra estação já está transmitindo o peso da balança.",
        )

    db.commit()
    return {"publicado": True}
