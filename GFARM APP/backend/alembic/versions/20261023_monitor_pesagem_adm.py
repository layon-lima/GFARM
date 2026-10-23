"""Telemetria e último registro da pesagem para monitor ADM.

Revision ID: monitor_pesagem_adm_20261023
Revises: balanca_remota_20261023
"""
from alembic import op

revision = "monitor_pesagem_adm_20261023"
down_revision = "balanca_remota_20261023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE balanca_leitura_remota
          ADD COLUMN IF NOT EXISTS estado_automacao JSONB NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS eventos_automacao JSONB NOT NULL DEFAULT '[]'::jsonb,
          ADD COLUMN IF NOT EXISTS ultima_captura JSONB NULL
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE balanca_leitura_remota
          DROP COLUMN IF EXISTS estado_automacao,
          DROP COLUMN IF EXISTS eventos_automacao,
          DROP COLUMN IF EXISTS ultima_captura
    """)
