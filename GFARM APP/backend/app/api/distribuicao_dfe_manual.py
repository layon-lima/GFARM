"""Sincronizacao sob comando do usuario pelo navegador + extensao GFARM.

O navegador negocia o certificado instalado com a SEFAZ. A extensao transmite
somente docZip e metadados recebidos, nunca chaves privadas. O servidor valida,
arquiva e associa XMLs as pendencias, sem criar movimentacoes de estoque.
Nenhuma chamada a SEFAZ e feita nesta API.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.api.integracao_recebimentos import _exigir_revisor
from app.db.database import get_db
from app.models import User
from app.services.distribuicao_dfe import (
    _chave_nfe,
    _descompactar,
    _destinatario_valido,
    _preencher_pendencias,
    garantir_tabelas_dfe,
)

router = APIRouter(prefix="/api/integracoes/recebimentos/dfe", tags=["Sincronizar XML no navegador"])

MAX_DOCUMENTOS = 50
MAX_ZIP_BASE64 = 4_300_000
MAX_BATCH_BASE64 = 15_000_000
MAX_NSU = 999_999_999_999_999


class DocZipBrowser(BaseModel):
    nsu: int = Field(ge=1, le=MAX_NSU)
    schema_xml: str = Field(default="", max_length=120)
    doc_zip: str = Field(min_length=12, max_length=MAX_ZIP_BASE64)


class LoteBrowser(BaseModel):
    interessado: str = Field(min_length=11, max_length=14)
    anterior_nsu: int = Field(ge=0, le=MAX_NSU)
    ult_nsu: int = Field(ge=0, le=MAX_NSU)
    max_nsu: int = Field(ge=0, le=MAX_NSU)
    cstat: Literal["137", "138", "656"]
    documentos: list[DocZipBrowser] = Field(default_factory=list, max_length=MAX_DOCUMENTOS)


def _tabelas(interessado: str) -> tuple[str, str, str]:
    if re.fullmatch(r"\d{11}", interessado):
        return ("gfarm_dfe_cursores_pf", "gfarm_dfe_documentos_pf", "cpf")
    if re.fullmatch(r"\d{14}", interessado):
        return ("gfarm_dfe_cursores", "gfarm_dfe_documentos", "cnpj")
    raise HTTPException(422, "CPF/CNPJ deve conter 11 ou 14 numeros.")


def validar_lote(lote: LoteBrowser):
    _tabelas(lote.interessado)
    if sum(len(d.doc_zip) for d in lote.documentos) > MAX_BATCH_BASE64:
        raise HTTPException(422, "Lote muito grande; limite de 15 MB compactados.")
    if lote.cstat != "138":
        if lote.documentos or lote.ult_nsu != lote.anterior_nsu:
            raise HTTPException(422, "Status sem documentos nao pode avancar o NSU.")
        return
    if not lote.documentos or not (lote.anterior_nsu < lote.ult_nsu <= lote.max_nsu):
        raise HTTPException(422, "Sequencia NSU do lote inconsistente.")
    nsus = [d.nsu for d in lote.documentos]
    if nsus != sorted(set(nsus)) or nsus[0] <= lote.anterior_nsu or nsus[-1] > lote.ult_nsu:
        raise HTTPException(422, "NSUs repetidos, fora de ordem ou fora do intervalo.")


@router.get("/estado")
def estado(interessado: str, user: User = Depends(get_current_user),
           db: Session = Depends(get_db)):
    _exigir_revisor(user)
    tabela, _, coluna = _tabelas(interessado)
    # Criacao aditiva e isolada, somente quando usuario abre a sincronizacao.
    garantir_tabelas_dfe(forcar=True)
    row = db.execute(text(f"""
        SELECT ult_nsu, max_nsu, proxima_consulta, ultimo_status
          FROM {tabela}
         WHERE {coluna}=:interessado
    """), {"interessado": interessado}).mappings().first()
    if row is None:
        return {"interessado": interessado, "ult_nsu": 0, "max_nsu": 0,
                "aguarde_segundos": 0, "ultimo_status": None}
    agora = datetime.now(timezone.utc)
    proxima = row["proxima_consulta"]
    aguarde = max(0, int((proxima - agora).total_seconds()) + 1) if proxima else 0
    return {"interessado": interessado, "ult_nsu": int(row["ult_nsu"]),
            "max_nsu": int(row["max_nsu"]),
            "aguarde_segundos": aguarde, "ultimo_status": row["ultimo_status"]}


@router.post("/lote")
def receber_lote(lote: LoteBrowser, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    _exigir_revisor(user)
    validar_lote(lote)
    tabela, tabela_docs, coluna = _tabelas(lote.interessado)
    garantir_tabelas_dfe(forcar=True)
    db.execute(text(f"""
        INSERT INTO {tabela} ({coluna})
        VALUES (:interessado)
        ON CONFLICT ({coluna}) DO NOTHING
    """), {"interessado": lote.interessado})
    estado_atual = db.execute(text(f"""
        SELECT ult_nsu, proxima_consulta
          FROM {tabela}
         WHERE {coluna}=:interessado
         FOR UPDATE
    """), {"interessado": lote.interessado}).mappings().first()
    if int(estado_atual["ult_nsu"]) != lote.anterior_nsu:
        db.rollback()
        raise HTTPException(409, "O NSU foi atualizado por outra sessao. Atualize a sincronizacao.")
    agora = datetime.now(timezone.utc)
    if estado_atual["proxima_consulta"] and estado_atual["proxima_consulta"] > agora:
        db.rollback()
        raise HTTPException(429, "Aguarde o intervalo determinado pela SEFAZ antes de continuar.")

    inseridos = 0
    preenchidos = 0
    completos = 0
    if lote.cstat == "138":
        for item in lote.documentos:
            try:
                xml = _descompactar(item.doc_zip)
                chave, tipo = _chave_nfe(xml)
            except (ValueError, TypeError, UnicodeError) as exc:
                db.rollback()
                raise HTTPException(422, "Lote recebeu documento XML comprimido invalido.") from exc
            # Nunca cruzar NF-e entre CPFs distintos nem confiar apenas na chave.
            if tipo == "completo" and not _destinatario_valido(xml, lote.interessado):
                db.rollback()
                raise HTTPException(422, "NF-e com destinatario diferente do certificado escolhido.")
            res = db.execute(text(f"""
                INSERT INTO {tabela_docs}
                    ({coluna}, nsu, chave, tipo, schema_xml, conteudo_xml, sha256)
                VALUES (:interessado, :nsu, :chave, :tipo, :schema, :xml, :hash)
                ON CONFLICT ({coluna}, nsu) DO NOTHING
                RETURNING nsu
            """), {
                "interessado": lote.interessado, "nsu": item.nsu,
                "chave": chave or None, "tipo": tipo,
                "schema": item.schema_xml,
                "xml": xml, "hash": hashlib.sha256(xml).hexdigest(),
            }).first()
            if not res:
                continue
            inseridos += 1
            if tipo == "completo" and chave:
                completos += 1
                preenchidos += _preencher_pendencias(db, chave, xml)

    if lote.cstat == "656":
        intervalo = timedelta(minutes=125)
    elif lote.cstat == "137" or lote.ult_nsu >= lote.max_nsu:
        intervalo = timedelta(minutes=65)
    else:
        intervalo = timedelta(seconds=0)

    db.execute(text(f"""
        UPDATE {tabela}
           SET ult_nsu=:ult, max_nsu=:max, ultimo_status=:status,
               proxima_consulta=:proxima, atualizado_em=NOW()
         WHERE {coluna}=:interessado
    """), {
        "interessado": lote.interessado, "ult": lote.ult_nsu,
        "max": lote.max_nsu, "status": lote.cstat,
        "proxima": agora + intervalo,
    })
    db.commit()
    return {
        "status": lote.cstat,
        "documentos": inseridos,
        "xml_completos": completos,
        "pendencias_atualizadas": preenchidos,
        "ult_nsu": lote.ult_nsu,
        "max_nsu": lote.max_nsu,
        "continuar": lote.cstat == "138" and lote.ult_nsu < lote.max_nsu,
        "aguarde_segundos": int(intervalo.total_seconds()),
    }
