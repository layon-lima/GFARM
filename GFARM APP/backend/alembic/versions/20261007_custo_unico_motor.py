"""Unifica o custo atual do produto com os saldos do motor.

Reconcilia divergências históricas criadas quando Produto.custo_unitario
e EstoqueSaldo.custo_medio eram atualizados por caminhos diferentes.
"""

from alembic import op


revision = "custo_unico_motor_20261007"
down_revision = "import_pesagem_legada_20261003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE estoque_saldos AS s
        SET
            custo_medio = ROUND(
                CAST(
                    COALESCE(
                        p.custo_unitario,
                        0
                    )
                    AS numeric
                ),
                6
            ),
            valor_total = ROUND(
                CAST(
                    s.quantidade
                    * COALESCE(
                        p.custo_unitario,
                        0
                    )
                    AS numeric
                ),
                2
            ),
            updated_at = NOW()
        FROM produtos AS p
        WHERE
            s.produto_id = p.id
            AND s.quantidade > 0
            AND ABS(
                COALESCE(
                    s.custo_medio,
                    0
                )
                - COALESCE(
                    p.custo_unitario,
                    0
                )
            ) > 0.000001
        """
    )

    op.execute(
        """
        UPDATE estoque_saldos
        SET
            custo_medio = 0,
            valor_total = 0,
            updated_at = NOW()
        WHERE
            quantidade <= 0
            AND (
                COALESCE(
                    custo_medio,
                    0
                ) <> 0
                OR COALESCE(
                    valor_total,
                    0
                ) <> 0
            )
        """
    )


def downgrade() -> None:
    # Reconciliação de dados não é reversível com segurança.
    pass
