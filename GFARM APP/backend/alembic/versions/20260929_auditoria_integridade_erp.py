"""Auditoria e integridade ERP

Revision ID: aud_integridade_20260929
Revises: nfe_ticket_20260926
Create Date: 2026-09-29
"""

from alembic import op
import sqlalchemy as sa


revision = "aud_integridade_20260929"
down_revision = "nfe_ticket_20260926"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "auditoria_erp",
        sa.Column(
            "usuario_id",
            sa.String(length=100),
            nullable=True,
        ),
        sa.Column(
            "usuario_nome",
            sa.String(length=255),
            nullable=True,
        ),
        sa.Column(
            "acao",
            sa.String(length=50),
            nullable=False,
        ),
        sa.Column(
            "entidade",
            sa.String(length=100),
            nullable=False,
        ),
        sa.Column(
            "registro_id",
            sa.String(length=100),
            nullable=True,
        ),
        sa.Column(
            "antes_json",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "depois_json",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "detalhe",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "id",
            sa.String(length=100),
            nullable=False,
        ),
        sa.Column(
            "created_date",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_date",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_by_id",
            sa.String(length=100),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    for coluna in [
        "usuario_id",
        "usuario_nome",
        "acao",
        "entidade",
        "registro_id",
        "created_by_id",
    ]:
        op.create_index(
            f"ix_auditoria_erp_{coluna}",
            "auditoria_erp",
            [coluna],
            unique=False,
        )


def downgrade():
    for coluna in [
        "created_by_id",
        "registro_id",
        "entidade",
        "acao",
        "usuario_nome",
        "usuario_id",
    ]:
        op.drop_index(
            f"ix_auditoria_erp_{coluna}",
            table_name="auditoria_erp",
        )

    op.drop_table(
        "auditoria_erp"
    )
