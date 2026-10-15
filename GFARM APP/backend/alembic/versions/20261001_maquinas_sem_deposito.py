"""Remove vinculos historicos de deposito das maquinas.

Maquinas nao possuem vinculo funcional com depositos. O campo fisico
permanece temporariamente por compatibilidade, mas todos os valores
existentes sao limpos e novas mutacoes sao bloqueadas pela API.
"""

from alembic import op
import sqlalchemy as sa


revision = "maquinas_sem_dep_20261001"
down_revision = "gavetas_almox01_20261001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    maquinas = sa.table(
        "maquinas",
        sa.column("deposito_id", sa.String(100)),
    )

    bind.execute(
        maquinas.update().values(
            deposito_id=None
        )
    )


def downgrade() -> None:
    # Os vinculos anteriores nao podem ser reconstruidos com seguranca.
    pass
