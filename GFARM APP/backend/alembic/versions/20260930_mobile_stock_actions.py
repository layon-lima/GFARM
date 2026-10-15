"""Permissões para ações de estoque no mobile.

Revision ID: mobile_stock_actions_20260930
Revises: aud_integridade_20260929
Create Date: 2026-09-30
"""

from alembic import op
import sqlalchemy as sa


revision = "mobile_stock_actions_20260930"
down_revision = "aud_integridade_20260929"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column(
            "pode_baixar_mobile",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "pode_mudar_gaveta_mobile",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "pode_mudar_deposito_mobile",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade():
    op.drop_column("users", "pode_mudar_deposito_mobile")
    op.drop_column("users", "pode_mudar_gaveta_mobile")
    op.drop_column("users", "pode_baixar_mobile")
