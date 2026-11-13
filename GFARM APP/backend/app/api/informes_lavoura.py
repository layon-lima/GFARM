"""Informe de saída para lavoura: solicitação, revisão e baixa oficial.

Não cria OS e não contabiliza estoque em endpoints de solicitação/edição.
A aprovação chama exclusivamente o motor de estoque; custos vêm dos documentos oficiais.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.api.users import dep_permissao
from app.core.access_control import setores_mobile_ids, tem_permissao
from app.db.database import get_db
from app.models import (
    EstoqueDocumento, EstoqueDocumentoItem, EstoqueSaldo,
    InformeSaidaLavoura, Lavoura, Produto, Setor, User,
)
from app.services.auditoria_erp import registrar_auditoria
from app.services.motor_estoque import EstoqueErro, movimentar_estoque

router = APIRouter(prefix="/api/informes-lavoura", tags=["Informes de saída para lavoura"])
PERM_SOLICITAR = "mobile.informe_lavoura.solicitar"
PERM_REVISAR = "admin.informe_lavoura.revisar"


class ProdutoSolicitado(BaseModel):
    produto_id: str = Field(min_length=1, max_length=100)
    quantidade: Decimal = Field(gt=0, max_digits=18, decimal_places=3, allow_inf_nan=False)


class DadosInforme(BaseModel):
    lavoura_id: str = Field(min_length=1, max_length=100)
    itens: list[ProdutoSolicitado] = Field(min_length=1, max_length=50)
    observacao: str = Field(default="", max_length=2000)


class CriarInforme(DadosInforme):
    # Uma chave criada no aparelho identifica a tentativa para impedir reenvios.
    chave: UUID


class RecusarInforme(BaseModel):
    motivo: str = Field(min_length=3, max_length=2000)


def _exigir_solicitar(user: User) -> None:
    if tem_permissao(user, PERM_SOLICITAR):
        return
    raise HTTPException(403, "Usuário sem permissão para solicitar saída para lavoura.")


def _nome(user: User) -> str:
    return str(user.display_name or user.username or "Usuário")


def _setor_agricola(setor: Setor | None) -> bool:
    nome = str(setor.nome if setor else "").casefold()
    return any(trecho in nome for trecho in ("defensiv", "adub", "fertiliz"))


def _itens_validados(db: Session, dados: DadosInforme, user: User, *, revisor=False):
    lavoura = db.get(Lavoura, dados.lavoura_id)
    if lavoura is None:
        raise HTTPException(404, "Lavoura não encontrada.")

    ids = [item.produto_id for item in dados.itens]
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "O mesmo produto não pode aparecer duas vezes. Some a quantidade no mesmo item.")

    permitidos = setores_mobile_ids(user) if user.role != "admin" and not revisor else None
    itens = []
    for item in dados.itens:
        produto = db.get(Produto, item.produto_id)
        if produto is None:
            raise HTTPException(404, "Produto não encontrado.")
        setor = db.get(Setor, produto.setor_id)
        if not _setor_agricola(setor):
            raise HTTPException(400, f"O produto '{produto.nome}' não pertence aos setores de defensivos ou adubos.")
        if permitidos is not None and produto.setor_id not in permitidos:
            raise HTTPException(403, "Produto fora dos setores liberados para o usuário.")
        itens.append({
            "produto_id": produto.id,
            "produto_nome": produto.nome,
            "unidade": str(produto.unidade or "un"),
            "quantidade": str(item.quantidade),
        })
    return lavoura, itens


def _resumo(item: InformeSaidaLavoura) -> dict:
    return {
        "id": item.id,
        "lavoura_id": item.lavoura_id,
        "lavoura_nome": item.lavoura_nome,
        "itens": item.itens or [],
        "observacao": item.observacao or "",
        "status": item.status,
        "solicitante_nome": item.solicitante_nome or "",
        "created_date": item.created_date,
        "analisado_por_nome": item.analisado_por_nome,
        "analisado_em": item.analisado_em,
        "motivo_recusa": item.motivo_recusa,
        "documento_estoque_id": item.documento_estoque_id,
    }


def _custos_documentos(db: Session, documentos: list[str]) -> dict[str, float]:
    ids = list({str(doc) for doc in documentos if doc})
    if not ids:
        return {}
    linhas = db.execute(
        select(EstoqueDocumentoItem.documento_id, func.sum(EstoqueDocumentoItem.valor_total))
        .join(EstoqueDocumento, EstoqueDocumento.id == EstoqueDocumentoItem.documento_id)
        .where(
            EstoqueDocumentoItem.documento_id.in_(ids),
            EstoqueDocumento.status == "contabilizado",
        )
        .group_by(EstoqueDocumentoItem.documento_id)
    ).all()
    return {doc_id: float(valor or 0) for doc_id, valor in linhas}


@router.get("/referencias")
def referencias(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _exigir_solicitar(user)
    lavouras = db.scalars(select(Lavoura).order_by(Lavoura.nome)).all()
    setores = {setor.id: setor for setor in db.scalars(select(Setor)).all()}
    escopo = setores_mobile_ids(user) if user.role != "admin" else None
    produtos = db.scalars(select(Produto).order_by(Produto.nome)).all()

    return {
        "lavouras": [
            {"id": lav.id, "nome": lav.nome, "numero": lav.numero, "hectares": lav.hectares}
            for lav in lavouras
        ],
        # Não retorna preço, custo, reserva ou quantidade financeira ao funcionário.
        "produtos": [
            {
                "id": produto.id,
                "nome": produto.nome,
                "codigo": produto.codigo,
                "unidade": produto.unidade or "un",
                "setor": setores[produto.setor_id].nome,
            }
            for produto in produtos
            if _setor_agricola(setores.get(produto.setor_id))
            and (escopo is None or produto.setor_id in escopo)
        ],
    }


@router.post("")
def solicitar(
    dados: CriarInforme,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _exigir_solicitar(user)
    chave = str(dados.chave)
    existente = db.get(InformeSaidaLavoura, chave)
    if existente:
        if existente.created_by_id != user.id:
            raise HTTPException(409, "Esta identificação já está em uso.")
        return _resumo(existente)

    lavoura, itens = _itens_validados(db, dados, user)
    novo = InformeSaidaLavoura(
        id=chave,
        lavoura_id=lavoura.id,
        lavoura_nome=lavoura.nome,
        itens=itens,
        observacao=dados.observacao.strip(),
        status="PENDENTE",
        solicitante_nome=_nome(user),
        created_by_id=user.id,
    )
    db.add(novo)
    db.flush()
    registrar_auditoria(
        db, usuario=user, acao="solicitar", entidade="InformeSaidaLavoura",
        registro_id=novo.id, depois=_resumo(novo),
        detalhe="Solicitação de baixa para lavoura. Nenhum estoque movimentado.",
    )
    db.commit()
    db.refresh(novo)
    return _resumo(novo)


@router.get("/minhas")
def minhas(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _exigir_solicitar(user)
    itens = db.scalars(
        select(InformeSaidaLavoura)
        .where(InformeSaidaLavoura.created_by_id == user.id)
        .order_by(InformeSaidaLavoura.created_date.desc()).limit(50)
    ).all()
    return [_resumo(item) for item in itens]


@router.get("/admin")
def listar_admin(
    _: User = Depends(dep_permissao(PERM_REVISAR)),
    db: Session = Depends(get_db),
):
    itens = db.scalars(
        select(InformeSaidaLavoura)
        .order_by(InformeSaidaLavoura.created_date.desc())
        .limit(300)
    ).all()
    # Retorna apenas dados operacionais para revisores.
    # Custos são restritos ao Administrador Total no endpoint separado.
    return [_resumo(item) for item in itens]


@router.get("/admin/custos")
def custos_administrador(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(403, "Custos disponíveis apenas para Administrador Total.")
    itens = db.scalars(
        select(InformeSaidaLavoura)
        .where(InformeSaidaLavoura.status == "APROVADO")
        .order_by(InformeSaidaLavoura.created_date.desc())
    ).all()
    custos = _custos_documentos(db, [item.documento_estoque_id for item in itens])
    por_lavoura = defaultdict(lambda: {"custo_total": 0.0, "quantidade_informes": 0})
    detalhes = {}
    for item in itens:
        valor = custos.get(item.documento_estoque_id, 0.0)
        dados = por_lavoura[(item.lavoura_id, item.lavoura_nome)]
        dados["custo_total"] += valor
        dados["quantidade_informes"] += 1
        detalhes[item.id] = valor
    return {
        "lavouras": [
            {"lavoura_id": lav_id, "lavoura_nome": nome, **dados}
            for (lav_id, nome), dados in por_lavoura.items()
        ],
        "informes": detalhes,
    }


@router.patch("/admin/{item_id}")
def editar(
    item_id: str,
    dados: DadosInforme,
    user: User = Depends(dep_permissao(PERM_REVISAR)),
    db: Session = Depends(get_db),
):
    item = db.scalar(
        select(InformeSaidaLavoura).where(InformeSaidaLavoura.id == item_id).with_for_update()
    )
    if item is None:
        raise HTTPException(404, "Informe não encontrado.")
    if item.status != "PENDENTE":
        raise HTTPException(409, "Somente informes pendentes podem ser editados.")
    lavoura, itens = _itens_validados(db, dados, user, revisor=True)
    antes = _resumo(item)
    item.lavoura_id = lavoura.id
    item.lavoura_nome = lavoura.nome
    item.itens = itens
    item.observacao = dados.observacao.strip()
    registrar_auditoria(
        db, usuario=user, acao="editar", entidade="InformeSaidaLavoura",
        registro_id=item.id, antes=antes, depois=_resumo(item),
        detalhe="Edição da solicitação pendente, sem alterar estoque.",
    )
    db.commit()
    db.refresh(item)
    return _resumo(item)


@router.post("/admin/{item_id}/recusar")
def recusar(
    item_id: str,
    dados: RecusarInforme,
    user: User = Depends(dep_permissao(PERM_REVISAR)),
    db: Session = Depends(get_db),
):
    item = db.scalar(
        select(InformeSaidaLavoura).where(InformeSaidaLavoura.id == item_id).with_for_update()
    )
    if item is None:
        raise HTTPException(404, "Informe não encontrado.")
    if item.status != "PENDENTE":
        raise HTTPException(409, "Esta solicitação já foi analisada.")
    item.status = "RECUSADO"
    item.motivo_recusa = dados.motivo.strip()
    item.analisado_por_id = user.id
    item.analisado_por_nome = _nome(user)
    item.analisado_em = datetime.now(timezone.utc)
    registrar_auditoria(
        db, usuario=user, acao="recusar", entidade="InformeSaidaLavoura",
        registro_id=item.id, depois=_resumo(item),
    )
    db.commit()
    db.refresh(item)
    return _resumo(item)


def _itens_para_motor(db: Session, item: InformeSaidaLavoura) -> list[dict]:
    """Planeja locais a partir dos saldos livres sem recalcular valor/custo.

    O motor faz a alocação FEFO, valida disponibilidade novamente e
    calcula o custo oficial na própria transação.
    """
    movimentos = []
    for solicitado in item.itens or []:
        produto = db.get(Produto, solicitado["produto_id"])
        setor = db.get(Setor, produto.setor_id) if produto else None
        if not produto or not _setor_agricola(setor):
            raise HTTPException(400, "Produto inexistente ou não permitido na saída agrícola.")
        restante = Decimal(str(solicitado["quantidade"]))
        if restante <= 0:
            raise HTTPException(400, "Quantidade inválida.")

        posicoes = defaultdict(Decimal)
        saldos = db.scalars(
            select(EstoqueSaldo)
            .where(
                EstoqueSaldo.produto_id == produto.id,
                EstoqueSaldo.tipo_estoque == "livre",
            )
            .order_by(EstoqueSaldo.deposito_id, EstoqueSaldo.gaveta_id)
        ).all()
        for saldo in saldos:
            livre = Decimal(str(saldo.quantidade or 0)) - Decimal(str(saldo.quantidade_reservada or 0))
            if livre > 0:
                posicoes[(saldo.deposito_id, saldo.gaveta_id or "")] += livre

        for (deposito_id, gaveta_id), disponivel in posicoes.items():
            if restante <= 0:
                break
            quantidade = min(restante, disponivel)
            movimentos.append({
                "produto_id": produto.id,
                "quantidade": str(quantidade),
                "unidade": str(produto.unidade or "un"),
                "deposito_origem_id": deposito_id,
                "gaveta_origem_id": gaveta_id,
                "observacao": f"Informe {item.id} | Lavoura {item.lavoura_nome}",
            })
            restante -= quantidade
        if restante > 0:
            raise HTTPException(409, f"Saldo insuficiente para '{produto.nome}'. Ajuste a solicitação.")
    return movimentos


@router.post("/admin/{item_id}/aprovar")
def aprovar(
    item_id: str,
    user: User = Depends(dep_permissao(PERM_REVISAR)),
    db: Session = Depends(get_db),
):
    item = db.scalar(
        select(InformeSaidaLavoura).where(InformeSaidaLavoura.id == item_id).with_for_update()
    )
    if item is None:
        raise HTTPException(404, "Informe não encontrado.")
    if item.status != "PENDENTE":
        raise HTTPException(409, "Esta solicitação já foi processada ou está em processamento.")

    # Trava a solicitação para impedir aprovação concorrente.
    item.status = "PROCESSANDO"
    db.commit()

    try:
        # A sessão do auth e as leituras não podem entrar na transação do motor.
        item = db.get(InformeSaidaLavoura, item_id)
        movimentos = _itens_para_motor(db, item)
        db.rollback()

        documento = movimentar_estoque(
            db,
            tipo_movimento="SAIDA_CONSUMO",
            usuario_id=user.id,
            itens=movimentos,
            origem_modulo="informe_lavoura",
            documento_origem_id=item_id,
            observacao=f"Informe de saída para lavoura {item.lavoura_nome} ({item.lavoura_id}).",
        )
        documento_id = str(documento.id)
        db.rollback()

        item = db.get(InformeSaidaLavoura, item_id)
        item.status = "APROVADO"
        item.documento_estoque_id = documento_id
        item.analisado_por_id = user.id
        item.analisado_por_nome = _nome(user)
        item.analisado_em = datetime.now(timezone.utc)
        registrar_auditoria(
            db, usuario=user, acao="aprovar", entidade="InformeSaidaLavoura",
            registro_id=item.id, depois=_resumo(item),
            detalhe=f"Baixa efetivada exclusivamente pelo motor. Documento {documento_id}.",
        )
        db.commit()
        db.refresh(item)
        return _resumo(item)

    except Exception as error:
        # Se o documento já foi contabilizado, jamais reabrir a solicitação
        # como pendente. A idempotência do motor protege nova contabilização.
        db.rollback()
        existente = db.scalar(
            select(EstoqueDocumento).where(
                EstoqueDocumento.origem_modulo == "informe_lavoura",
                EstoqueDocumento.documento_origem_id == item_id,
                EstoqueDocumento.tipo_movimento == "SAIDA_CONSUMO",
                EstoqueDocumento.status == "contabilizado",
            )
        )
        db.rollback()
        if existente is None:
            item = db.get(InformeSaidaLavoura, item_id)
            if item and item.status == "PROCESSANDO":
                item.status = "PENDENTE"
                db.commit()
        if isinstance(error, HTTPException):
            raise error
        if isinstance(error, EstoqueErro):
            raise HTTPException(409, str(error)) from error
        raise HTTPException(500, "Não foi possível concluir a baixa. Verifique a solicitação antes de tentar novamente.") from error
