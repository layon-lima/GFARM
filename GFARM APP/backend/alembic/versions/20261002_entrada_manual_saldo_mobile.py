"""Adiciona fluxo pendente de Entrada Manual de Saldo no mobile."""

from alembic import op
import sqlalchemy as sa


revision = "entrada_saldo_mobile_20261002"
down_revision = "lavouras_auto_num_20261001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "pode_entrada_manual_saldo_mobile",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.create_table(
        "entradas_saldo_mobile_pendentes",
        sa.Column("nome_produto", sa.String(255), nullable=False),
        sa.Column("quantidade", sa.Float(), nullable=False),
        sa.Column("unidade", sa.String(30), nullable=False, server_default="un"),
        sa.Column("setor_id", sa.String(100), nullable=False),
        sa.Column("deposito_id", sa.String(100), nullable=False),
        sa.Column("gaveta_id", sa.String(100), nullable=True),
        sa.Column("foto_url", sa.Text(), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="PENDENTE"),
        sa.Column("solicitante_nome", sa.String(255), nullable=True),
        sa.Column("analisado_por_id", sa.String(100), nullable=True),
        sa.Column("analisado_por_nome", sa.String(255), nullable=True),
        sa.Column("analisado_em", sa.DateTime(timezone=True), nullable=True),
        sa.Column("motivo_rejeicao", sa.Text(), nullable=True),
        sa.Column("produto_id", sa.String(100), nullable=True),
        sa.Column("documento_estoque_id", sa.String(100), nullable=True),
        sa.Column("data_validade", sa.Date(), nullable=True),
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("created_date", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_date", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_id", sa.String(100), nullable=True),
    )

    for coluna in (
        "nome_produto",
        "setor_id",
        "deposito_id",
        "gaveta_id",
        "status",
        "analisado_por_id",
        "produto_id",
        "documento_estoque_id",
        "created_by_id",
    ):
        op.create_index(
            op.f(f"ix_entradas_saldo_mobile_pendentes_{coluna}"),
            "entradas_saldo_mobile_pendentes",
            [coluna],
            unique=False,
        )


def downgrade() -> None:
    op.drop_table("entradas_saldo_mobile_pendentes")
    op.drop_column("users", "pode_entrada_manual_saldo_mobile")
