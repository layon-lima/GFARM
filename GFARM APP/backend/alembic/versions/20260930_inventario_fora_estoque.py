"""Pendências de itens encontrados fora do cadastro no inventário.

Revision ID: inv_fora_estoque_20260930
Revises: mobile_stock_actions_20260930
Create Date: 2026-09-30
"""

from alembic import op
import sqlalchemy as sa


revision = "inv_fora_estoque_20260930"
down_revision = "mobile_stock_actions_20260930"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "inventario_fora_estoque",
        sa.Column("id", sa.String(length=100), nullable=False),
        sa.Column("inventario_id", sa.String(length=100), nullable=True),
        sa.Column("descricao", sa.String(length=255), nullable=False),
        sa.Column("quantidade", sa.Float(), nullable=False, server_default="0"),
        sa.Column("unidade", sa.String(length=30), nullable=True, server_default="un"),
        sa.Column("foto_url", sa.Text(), nullable=True),
        sa.Column("observacao", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pendente"),
        sa.Column("registrado_por", sa.String(length=255), nullable=True),
        sa.Column("data_registro", sa.DateTime(timezone=True), nullable=False),
        sa.Column("produto_id", sa.String(length=100), nullable=True),
        sa.Column("deposito_id", sa.String(length=100), nullable=True),
        sa.Column("gaveta_id", sa.String(length=100), nullable=True),
        sa.Column("revisado_por", sa.String(length=255), nullable=True),
        sa.Column("revisado_em", sa.DateTime(timezone=True), nullable=True),
        sa.Column("motivo_rejeicao", sa.Text(), nullable=True),
        sa.Column("documento_estoque_id", sa.String(length=100), nullable=True),
        sa.Column("created_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_date", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in (
        "inventario_id", "descricao", "status", "produto_id",
        "deposito_id", "gaveta_id", "documento_estoque_id",
    ):
        op.create_index(
            f"ix_inventario_fora_estoque_{column}",
            "inventario_fora_estoque",
            [column],
        )


def downgrade():
    op.drop_table("inventario_fora_estoque")
