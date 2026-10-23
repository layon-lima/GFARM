"""Leitura atual da Toledo para consulta remota no GFARM.

Revision ID: balanca_remota_20261023
Revises: pesagem_correcao_20261014
"""

from alembic import op

revision = "balanca_remota_20261023"
down_revision = "pesagem_correcao_20261014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Não altera registros de pesagem nem tabelas de estoque.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS balanca_leitura_remota (
            id VARCHAR(40) PRIMARY KEY,
            peso_kg DOUBLE PRECISION NULL,
            conectada BOOLEAN NOT NULL DEFAULT FALSE,
            publicador_id VARCHAR(100) NOT NULL,
            atualizado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS balanca_leitura_remota")
