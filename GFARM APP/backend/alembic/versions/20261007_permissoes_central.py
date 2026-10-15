"""Banco central de permissões e perfil Sub Administrador.

Revision ID: permissoes_central_20261007
Revises: custo_unico_motor_20261007
"""

from __future__ import annotations

import json
import uuid

from alembic import op
import sqlalchemy as sa


revision = "permissoes_central_20261007"
down_revision = "custo_unico_motor_20261007"
branch_labels = None
depends_on = None


PAGE_KEYS = (
    "dashboard",
    "movimentacoes",
    "abastecimento",
    "pesagem",
    "aplicacao",
    "cadastros",
    "relatorios",
    "inventario",
)

LEGACY_FLAGS = {
    "pode_confirmar_abastecimento": "operacao.abastecimento.confirmar",
    "pode_digitar_peso": "operacao.pesagem.digitar_peso",
    "pode_baixar_mobile": "mobile.estoque.baixar",
    "pode_mudar_gaveta_mobile": "mobile.estoque.mudar_gaveta",
    "pode_mudar_deposito_mobile": "mobile.estoque.mudar_deposito",
    "pode_entrada_manual_saldo_mobile": "mobile.estoque.entrada_manual_saldo",
}


def _lista_json(valor):
    if valor is None:
        return None

    if isinstance(valor, list):
        return [str(item) for item in valor]

    try:
        parsed = json.loads(valor)
    except Exception:
        return []

    return [str(item) for item in parsed] if isinstance(parsed, list) else []


def upgrade() -> None:
    op.create_table(
        "user_permissions",
        sa.Column("id", sa.String(length=100), nullable=False),
        sa.Column("created_date", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_date", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by_id", sa.String(length=100), nullable=True),
        sa.Column("user_id", sa.String(length=100), nullable=False),
        sa.Column("permission_key", sa.String(length=150), nullable=False),
        sa.Column("scope_value", sa.String(length=150), server_default="", nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "permission_key", "scope_value", name="uq_user_permission_scope"),
    )
    op.create_index("ix_user_permissions_user_id", "user_permissions", ["user_id"], unique=False)
    op.create_index("ix_user_permissions_permission_key", "user_permissions", ["permission_key"], unique=False)
    op.create_index("ix_user_permissions_scope_value", "user_permissions", ["scope_value"], unique=False)

    conn = op.get_bind()
    usuarios = conn.execute(
        sa.text(
            """
            SELECT
                id,
                role,
                paginas_permitidas,
                setores_permitidos,
                pode_confirmar_abastecimento,
                pode_digitar_peso,
                pode_baixar_mobile,
                pode_mudar_gaveta_mobile,
                pode_mudar_deposito_mobile,
                pode_entrada_manual_saldo_mobile
            FROM users
            """
        )
    ).mappings().all()

    permission_table = sa.table(
        "user_permissions",
        sa.column("id", sa.String),
        sa.column("user_id", sa.String),
        sa.column("permission_key", sa.String),
        sa.column("scope_value", sa.String),
        sa.column("created_by_id", sa.String),
    )

    registros = []

    for user in usuarios:
        if user["role"] == "admin":
            continue

        paginas = _lista_json(user["paginas_permitidas"])
        if paginas is None:
            paginas = list(PAGE_KEYS)

        for pagina in paginas:
            if pagina in PAGE_KEYS:
                registros.append({
                    "id": str(uuid.uuid4()),
                    "user_id": user["id"],
                    "permission_key": f"page.{pagina}",
                    "scope_value": "",
                    "created_by_id": None,
                })

        for campo, permissao in LEGACY_FLAGS.items():
            if bool(user[campo]):
                registros.append({
                    "id": str(uuid.uuid4()),
                    "user_id": user["id"],
                    "permission_key": permissao,
                    "scope_value": "",
                    "created_by_id": None,
                })

        for setor_id in _lista_json(user["setores_permitidos"]) or []:
            if setor_id:
                registros.append({
                    "id": str(uuid.uuid4()),
                    "user_id": user["id"],
                    "permission_key": "mobile.setor",
                    "scope_value": str(setor_id),
                    "created_by_id": None,
                })

    if registros:
        op.bulk_insert(permission_table, registros)


def downgrade() -> None:
    op.drop_index("ix_user_permissions_scope_value", table_name="user_permissions")
    op.drop_index("ix_user_permissions_permission_key", table_name="user_permissions")
    op.drop_index("ix_user_permissions_user_id", table_name="user_permissions")
    op.drop_table("user_permissions")
