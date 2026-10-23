"""Modelo isolado da leitura atual da balança na VPS.

Não representa uma pesagem registrada: apenas telemetria temporária.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, String, text
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
    estado_automacao = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    eventos_automacao = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    ultima_captura = mapped_column(
        JSONB, nullable=True)

