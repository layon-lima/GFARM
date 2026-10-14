"""Armazena correção assinada do peso líquido de tickets.

Revision ID: pesagem_correcao_20261014
Revises: permissoes_central_20261007
"""

from alembic import op
import sqlalchemy as sa

revision = "pesagem_correcao_20261014"
down_revision = "permissoes_central_20261007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tickets_pesagem",
        sa.Column(
            "correcao_peso_kg",
            sa.Float(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("tickets_pesagem", "correcao_peso_kg")
