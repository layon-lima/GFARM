"""Cria a fila segura de cadastros mobile pendentes."""

from alembic import op
import sqlalchemy as sa


revision = "cad_mobile_20261001"
down_revision = "inv_pend_autoria_20260930"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "cadastros_mobile_pendentes",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("tipo", sa.String(30), nullable=False),
        sa.Column("dados", sa.JSON(), nullable=False),
        sa.Column("imagem_url", sa.Text(), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="PENDENTE"),
        sa.Column("solicitante_nome", sa.String(255), nullable=True),
        sa.Column("analisado_por_id", sa.String(100), nullable=True),
        sa.Column("analisado_por_nome", sa.String(255), nullable=True),
        sa.Column("analisado_em", sa.DateTime(timezone=True), nullable=True),
        sa.Column("motivo_rejeicao", sa.Text(), nullable=True),
        sa.Column("registro_criado_id", sa.String(100), nullable=True),
        sa.Column("created_date", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_date", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_id", sa.String(100), nullable=True),
    )
    for coluna in (
        "tipo", "status", "analisado_por_id", "registro_criado_id", "created_by_id"
    ):
        op.create_index(
            f"ix_cadastros_mobile_pendentes_{coluna}",
            "cadastros_mobile_pendentes",
            [coluna],
        )


def downgrade():
    op.drop_table("cadastros_mobile_pendentes")
