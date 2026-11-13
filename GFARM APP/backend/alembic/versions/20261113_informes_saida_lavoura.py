"""Fila de saída para lavoura; não altera movimentações ou documentos existentes.

Revision ID: informes_lavoura_20261113
Revises: monitor_pesagem_adm_20261023
"""
from alembic import op
import sqlalchemy as sa

revision = "informes_lavoura_20261113"
down_revision = "monitor_pesagem_adm_20261023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "informes_saida_lavoura",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("created_date", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_date", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_id", sa.String(100), nullable=True),
        sa.Column("lavoura_id", sa.String(100), nullable=False),
        sa.Column("lavoura_nome", sa.String(255), nullable=False),
        sa.Column("itens", sa.JSON(), nullable=False),
        sa.Column("observacao", sa.Text(), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="PENDENTE"),
        sa.Column("solicitante_nome", sa.String(255), nullable=True),
        sa.Column("analisado_por_id", sa.String(100), nullable=True),
        sa.Column("analisado_por_nome", sa.String(255), nullable=True),
        sa.Column("analisado_em", sa.DateTime(timezone=True), nullable=True),
        sa.Column("motivo_recusa", sa.Text(), nullable=True),
        sa.Column("documento_estoque_id", sa.String(100), nullable=True),
    )
    for coluna in ("lavoura_id", "status", "created_by_id", "documento_estoque_id"):
        op.create_index(
            f"ix_informes_saida_lavoura_{coluna}", "informes_saida_lavoura", [coluna],
        )


def downgrade() -> None:
    for coluna in ("documento_estoque_id", "created_by_id", "status", "lavoura_id"):
        op.drop_index(f"ix_informes_saida_lavoura_{coluna}", table_name="informes_saida_lavoura")
    op.drop_table("informes_saida_lavoura")
