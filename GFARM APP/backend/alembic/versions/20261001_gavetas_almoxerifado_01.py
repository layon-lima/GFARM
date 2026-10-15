"""Vincula GAVETA 01 ate GAVETA 426 ao deposito ALMOXERIFADO 01.

A migracao:
- localiza o deposito de forma tolerante a variacoes entre numero/nome;
- atualiza somente gavetas numeradas de 1 a 426;
- preserva produtos, lotes, saldos e demais dados;
- funciona mesmo se a migracao anterior ja tiver sido aplicada.
"""

from __future__ import annotations

import re

from alembic import op
import sqlalchemy as sa


revision = "gavetas_almox01_20261001"
down_revision = "gavetas_001_426_20261001"
branch_labels = None
depends_on = None


def _norm(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().upper())


def _numero_gaveta(codigo: object) -> int | None:
    texto = _norm(codigo)
    match = re.fullmatch(r"GAVETA\s*0*([0-9]+)", texto)
    if not match:
        return None

    numero = int(match.group(1))
    return numero if 1 <= numero <= 426 else None


def _eh_almoxerifado_01(numero: object, nome: object) -> bool:
    numero_n = _norm(numero)
    nome_n = _norm(nome)

    candidatos = {
        nome_n,
        numero_n,
        _norm(f"{nome_n} {numero_n}"),
        _norm(f"{numero_n} {nome_n}"),
    }

    if "ALMOXERIFADO 01" in candidatos:
        return True

    # Tambem aceita cadastro separado como numero=01 e nome=ALMOXERIFADO.
    return (
        nome_n == "ALMOXERIFADO"
        and numero_n in {"1", "01", "001"}
    )


def upgrade() -> None:
    bind = op.get_bind()

    depositos = sa.table(
        "depositos",
        sa.column("id", sa.String(100)),
        sa.column("numero", sa.String(100)),
        sa.column("nome", sa.String(255)),
    )

    gavetas = sa.table(
        "gavetas",
        sa.column("id", sa.String(100)),
        sa.column("codigo", sa.String(100)),
        sa.column("deposito_id", sa.String(100)),
    )

    depositos_encontrados = [
        row
        for row in bind.execute(
            sa.select(
                depositos.c.id,
                depositos.c.numero,
                depositos.c.nome,
            )
        ).mappings()
        if _eh_almoxerifado_01(row["numero"], row["nome"])
    ]

    if len(depositos_encontrados) != 1:
        detalhes = [
            f'id={row["id"]}, numero={row["numero"]!r}, nome={row["nome"]!r}'
            for row in depositos_encontrados
        ]
        raise RuntimeError(
            "Nao foi possivel identificar unicamente o deposito ALMOXERIFADO 01. "
            f"Encontrados: {detalhes or 'nenhum'}"
        )

    deposito_id = depositos_encontrados[0]["id"]

    ids_gavetas = [
        row["id"]
        for row in bind.execute(
            sa.select(gavetas.c.id, gavetas.c.codigo)
        ).mappings()
        if _numero_gaveta(row["codigo"]) is not None
    ]

    if ids_gavetas:
        bind.execute(
            gavetas.update()
            .where(gavetas.c.id.in_(ids_gavetas))
            .values(deposito_id=deposito_id)
        )


def downgrade() -> None:
    # Nao desfaz o vinculo automaticamente para nao apagar relacoes que
    # possam ter sido ajustadas manualmente depois da migracao.
    pass
