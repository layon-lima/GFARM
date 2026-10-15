from __future__ import annotations

import uuid

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import declared_attr, mapped_column


def novo_id() -> str:
    return str(uuid.uuid4())


class EntityBaseMixin:
    """Campos comuns de identificação, autoria e datas das entidades do ERP."""

    @declared_attr
    def id(cls):
        return mapped_column(String(100), primary_key=True, default=novo_id)

    @declared_attr
    def created_date(cls):
        return mapped_column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
        )

    @declared_attr
    def updated_date(cls):
        return mapped_column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        )

    @declared_attr
    def created_by_id(cls):
        return mapped_column(String(100), nullable=True, index=True)
