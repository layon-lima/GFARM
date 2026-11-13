"""Modelo isolado da leitura atual da balança na VPS.

Não representa uma pesagem registrada: apenas telemetria temporária.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, JSON, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class BalancaLeituraRemota(Base):
    __tablename__ = "balanca_leitura_remota"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    peso_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    conectada: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    publicador_id: Mapped[str] = mapped_column(String(100), nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    # PostgreSQL mantém JSONB. A variante SQLite permite executar os testes
    # de outros módulos sem tentar criar um tipo exclusivo do PostgreSQL.
    _json_portavel = JSONB().with_variant(JSON(), "sqlite")

    estado_automacao = mapped_column(
        _json_portavel, nullable=False, server_default=text("'{}'")
    )
    eventos_automacao = mapped_column(
        _json_portavel, nullable=False, server_default=text("'[]'")
    )
    ultima_captura = mapped_column(
        _json_portavel, nullable=True)

