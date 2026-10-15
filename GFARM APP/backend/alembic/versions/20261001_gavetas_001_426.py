"""Completa o cadastro de gavetas de GAVETA 01 ate GAVETA 426.

A migracao e idempotente em relacao ao numero da gaveta:
- preserva gavetas ja existentes;
- reconhece variantes como "GAVETA 1", "GAVETA 01" e "gaveta 001";
- cria apenas os numeros ausentes entre 1 e 426;
- nao altera estoque, produtos, lotes ou vinculos existentes;
- novas gavetas ficam sem deposito, pois deposito_id e opcional.
"""

from __future__ import annotations

import re
import uuid

from alembic import op
import sqlalchemy as sa


revision = "gavetas_001_426_20261001"
down_revision = "cad_mobile_20261001"
branch_labels = None
depends_on = None


_NAMESPACE = uuid.UUID("9d29fd7d-58e4-4f95-a3ae-7db8e30cdf64")


def _id_gaveta(numero: int) -> str:
    return str(uuid.uuid5(_NAMESPACE, f"gaveta-{numero}"))


def _numero_gaveta(codigo: object) -> int | None:
    texto = str(codigo or "").strip()
    match = re.fullmatch(r"GAVETA\s*0*([0-9]+)", texto, flags=re.IGNORECASE)
    if not match:
        return None

    numero = int(match.group(1))
    return numero if 1 <= numero <= 426 else None


def upgrade() -> None:
    bind = op.get_bind()

    gavetas = sa.table(
        "gavetas",
        sa.column("id", sa.String(100)),
        sa.column("codigo", sa.String(100)),
        sa.column("descricao", sa.Text()),
        sa.column("deposito_id", sa.String(100)),
    )

    existentes = {
        numero
        for (codigo,) in bind.execute(sa.select(gavetas.c.codigo))
        if (numero := _numero_gaveta(codigo)) is not None
    }

    faltantes = [
        {
            "id": _id_gaveta(numero),
            "codigo": f"GAVETA {numero:02d}",
            "descricao": None,
            "deposito_id": None,
        }
        for numero in range(1, 427)
        if numero not in existentes
    ]

    if faltantes:
        op.bulk_insert(gavetas, faltantes)


def downgrade() -> None:
    bind = op.get_bind()

    gavetas = sa.table(
        "gavetas",
        sa.column("id", sa.String(100)),
    )

    ids_criados_por_esta_migracao = [
        _id_gaveta(numero)
        for numero in range(1, 427)
    ]

    bind.execute(
        gavetas.delete().where(
            gavetas.c.id.in_(ids_criados_por_esta_migracao)
        )
    )
