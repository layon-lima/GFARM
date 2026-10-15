"""Completa os campos comuns das pendências de inventário."""
from alembic import op
import sqlalchemy as sa

revision = 'inv_pend_autoria_20260930'
down_revision = 'inv_fora_estoque_20260930'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('inventario_fora_estoque', sa.Column('created_by_id', sa.String(100), nullable=True))
    op.create_index('ix_inventario_fora_estoque_created_by_id', 'inventario_fora_estoque', ['created_by_id'])
    for col in ('created_date', 'updated_date'):
        op.execute(sa.text(f'UPDATE inventario_fora_estoque SET {col} = CURRENT_TIMESTAMP WHERE {col} IS NULL'))
        op.alter_column('inventario_fora_estoque', col, nullable=False, server_default=sa.func.now())

def downgrade():
    op.drop_index('ix_inventario_fora_estoque_created_by_id', table_name='inventario_fora_estoque')
    op.drop_column('inventario_fora_estoque', 'created_by_id')
