"""Preenche numero automatico nas lavouras sem numero.

Preserva numeros ja existentes e atribui LAV-000001, LAV-000002...
somente aos registros que ainda nao possuem numero.
"""

from __future__ import annotations

import re

from alembic import op
import sqlalchemy as sa


revision = "lavouras_auto_num_20261001"
down_revision = "maquinas_sem_dep_20261001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    lavouras = sa.table(
        "lavouras",
        sa.column("id", sa.String(100)),
        sa.column("numero", sa.String(100)),
        sa.column("created_date", sa.DateTime(timezone=True)),
    )

    rows = bind.execute(
        sa.select(
            lavouras.c.id,
            lavouras.c.numero,
            lavouras.c.created_date,
        ).order_by(
            lavouras.c.created_date,
            lavouras.c.id,
        )
    ).mappings().all()

    maior = 0

    for row in rows:
        match = re.search(
            r"(\d+)\s*$",
            str(row["numero"] or ""),
        )

        if match:
            maior = max(
                maior,
                int(match.group(1)),
            )

    for row in rows:
        if str(row["numero"] or "").strip():
            continue

        maior += 1

        bind.execute(
            lavouras.update()
            .where(
                lavouras.c.id
                == row["id"]
            )
            .values(
                numero=(
                    f"LAV-{maior:06d}"
                )
            )
        )


def downgrade() -> None:
    # Numeros gerados passam a identificar as lavouras e nao sao apagados.
    pass
