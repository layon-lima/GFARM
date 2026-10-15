"""Armazena dados da NF-e vinculada ao ticket de pesagem.

Revision ID: nfe_ticket_20260926
Revises: e3e9c6af02d1
"""

from alembic import op
import sqlalchemy as sa


revision = "nfe_ticket_20260926"
down_revision = "e3e9c6af02d1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "tickets_pesagem",
        sa.Column("nfe_cliente", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "tickets_pesagem",
        sa.Column("nfe_quantidade", sa.Float(), nullable=True),
    )
    op.add_column(
        "tickets_pesagem",
        sa.Column("nfe_valor", sa.Float(), nullable=True),
    )


def downgrade():
    op.drop_column("tickets_pesagem", "nfe_valor")
    op.drop_column("tickets_pesagem", "nfe_quantidade")
    op.drop_column("tickets_pesagem", "nfe_cliente")
