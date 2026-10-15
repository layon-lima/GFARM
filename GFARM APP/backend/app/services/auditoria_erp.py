from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditoriaERP, User


CAMPOS_SENSIVEIS = {
    "password",
    "password_hash",
    "secret_key",
    "token",
    "access_token",
}


def _seguro(valor: Any):
    if isinstance(
        valor,
        (datetime, date),
    ):
        return valor.isoformat()

    if isinstance(valor, Decimal):
        return float(valor)

    if isinstance(valor, dict):
        return {
            str(chave): (
                "***"
                if str(chave).lower()
                in CAMPOS_SENSIVEIS
                else _seguro(item)
            )
            for chave, item
            in valor.items()
        }

    if isinstance(
        valor,
        (list, tuple, set),
    ):
        return [
            _seguro(item)
            for item in valor
        ]

    if (
        valor is None
        or isinstance(
            valor,
            (str, int, float, bool),
        )
    ):
        return valor

    return str(valor)


def _json(valor: Any) -> str | None:
    if valor is None:
        return None

    return json.dumps(
        _seguro(valor),
        ensure_ascii=False,
        sort_keys=True,
    )


def registrar_auditoria(
    db: Session,
    *,
    usuario: User | None,
    acao: str,
    entidade: str,
    registro_id: str | None = None,
    antes: Any = None,
    depois: Any = None,
    detalhe: str | None = None,
):
    registro = AuditoriaERP(
        usuario_id=(
            usuario.id
            if usuario
            else None
        ),
        usuario_nome=(
            (
                usuario.display_name
                or usuario.username
            )
            if usuario
            else "SISTEMA"
        ),
        acao=acao,
        entidade=entidade,
        registro_id=registro_id,
        antes_json=_json(antes),
        depois_json=_json(depois),
        detalhe=detalhe,
        created_by_id=(
            usuario.id
            if usuario
            else None
        ),
    )

    db.add(registro)

    return registro
