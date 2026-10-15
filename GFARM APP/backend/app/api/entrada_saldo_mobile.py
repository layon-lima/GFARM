from __future__ import annotations

import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.api.entities import serializar
from app.api.users import dep_permissao
from app.core.access_control import setores_mobile_ids, tem_permissao
from app.db.database import get_db
from app.models import (
    Deposito,
    EntradaSaldoMobilePendente,
    Gaveta,
    Produto,
    Setor,
    User,
)
from app.services.auditoria_erp import registrar_auditoria
from app.services.motor_estoque import EstoqueErro, movimentar_estoque


router = APIRouter(
    prefix="/api/entrada-saldo-mobile",
    tags=["Entrada manual de saldo mobile"],
)

UPLOAD_DIR = (Path(__file__).resolve().parents[2] / "uploads").resolve()
TEMP_IMAGE_RE = re.compile(
    r"^/uploads/(?P<nome>[0-9a-fA-F-]{36}\.(?:jpe?g|png|webp|gif|heic|heif))$",
    re.IGNORECASE,
)


class CriarEntradaSaldoMobile(BaseModel):
    nome_produto: str = Field(min_length=1, max_length=255)
    quantidade: float = Field(gt=0)
    setor_id: str = Field(min_length=1, max_length=100)
    deposito_id: str = Field(min_length=1, max_length=100)
    gaveta_id: str | None = None
    foto_url: str | None = None


class AprovarEntradaSaldoMobile(BaseModel):
    nome_produto: str = Field(min_length=1, max_length=255)
    quantidade: float = Field(gt=0)
    setor_id: str = Field(min_length=1, max_length=100)
    deposito_id: str = Field(min_length=1, max_length=100)
    gaveta_id: str | None = None
    unidade: str = Field(default="un", min_length=1, max_length=30)
    data_validade: date | None = None


class RejeitarEntradaSaldoMobile(BaseModel):
    motivo: str = Field(min_length=2, max_length=2000)


def _nome_usuario(user: User) -> str:
    return user.display_name or user.username


def _exigir_permissao_mobile(user: User) -> None:
    if tem_permissao(user, "mobile.estoque.entrada_manual_saldo"):
        return

    raise HTTPException(
        status_code=403,
        detail="Usuário sem permissão para usar a Entrada Manual de Saldo no mobile.",
    )


def _validar_setor_usuario(user: User, setor_id: str) -> None:
    if user.role == "admin":
        return

    if setor_id not in setores_mobile_ids(user):
        raise HTTPException(
            status_code=403,
            detail="Este setor não está liberado para o usuário no mobile.",
        )


def _validar_local(
    db: Session,
    *,
    setor_id: str,
    deposito_id: str,
    gaveta_id: str | None,
) -> tuple[Setor, Deposito, Gaveta | None, bool]:
    setor = db.get(Setor, setor_id)
    if setor is None:
        raise HTTPException(400, "Setor não encontrado.")

    deposito = db.get(Deposito, deposito_id)
    if deposito is None:
        raise HTTPException(400, "Depósito não encontrado.")

    if deposito.setor_id and deposito.setor_id != setor_id:
        raise HTTPException(400, "O depósito selecionado não pertence ao setor informado.")

    gavetas_do_deposito = db.scalars(
        select(Gaveta).where(Gaveta.deposito_id == deposito_id)
    ).all()
    exige_gaveta = len(gavetas_do_deposito) > 0

    gaveta = None
    gaveta_id = str(gaveta_id or "").strip() or None

    if exige_gaveta and not gaveta_id:
        raise HTTPException(
            400,
            "Selecione uma gaveta. Este depósito possui gavetas vinculadas.",
        )

    if gaveta_id:
        gaveta = db.get(Gaveta, gaveta_id)
        if gaveta is None:
            raise HTTPException(400, "Gaveta não encontrada.")
        if gaveta.deposito_id != deposito_id:
            raise HTTPException(400, "A gaveta selecionada não pertence ao depósito informado.")

    return setor, deposito, gaveta, exige_gaveta


def _proximo_codigo_produto(db: Session) -> str:
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        db.execute(text('LOCK TABLE "produtos" IN SHARE ROW EXCLUSIVE MODE'))

    maior = 0
    for codigo in db.scalars(select(Produto.codigo)).all():
        encontrado = re.search(r"(\d+)\s*$", str(codigo or ""))
        if encontrado:
            maior = max(maior, int(encontrado.group(1)))

    return f"P{maior + 1:04d}"


def _produto_por_nome(db: Session, nome: str) -> Produto | None:
    return db.scalar(
        select(Produto)
        .where(func.lower(Produto.nome) == nome.strip().lower())
        .limit(1)
    )


def _caminho_imagem_temporaria(imagem_url: str | None) -> Path | None:
    match = TEMP_IMAGE_RE.fullmatch(str(imagem_url or "").strip())
    if not match:
        return None

    caminho = (UPLOAD_DIR / match.group("nome")).resolve()
    try:
        caminho.relative_to(UPLOAD_DIR)
    except ValueError:
        return None

    return caminho


def _excluir_imagem_rejeitada(imagem_url: str | None) -> None:
    caminho = _caminho_imagem_temporaria(imagem_url)
    if caminho is not None:
        caminho.unlink(missing_ok=True)


def _serializar(item: EntradaSaldoMobilePendente) -> dict:
    return serializar(item)


@router.post("")
def criar(
    dados: CriarEntradaSaldoMobile,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _exigir_permissao_mobile(current_user)
    _validar_setor_usuario(current_user, dados.setor_id)

    nome = dados.nome_produto.strip()
    if not nome:
        raise HTTPException(400, "Informe o nome do produto.")

    _validar_local(
        db,
        setor_id=dados.setor_id,
        deposito_id=dados.deposito_id,
        gaveta_id=dados.gaveta_id,
    )

    if dados.foto_url and _caminho_imagem_temporaria(dados.foto_url) is None:
        raise HTTPException(
            400,
            "A foto do produto deve ser uma imagem enviada pelo próprio sistema.",
        )

    pendente_igual = db.scalar(
        select(EntradaSaldoMobilePendente)
        .where(
            EntradaSaldoMobilePendente.status == "PENDENTE",
            func.lower(EntradaSaldoMobilePendente.nome_produto) == nome.lower(),
            EntradaSaldoMobilePendente.deposito_id == dados.deposito_id,
            EntradaSaldoMobilePendente.gaveta_id == (dados.gaveta_id or None),
            EntradaSaldoMobilePendente.created_by_id == current_user.id,
        )
        .limit(1)
    )

    if pendente_igual is not None:
        raise HTTPException(
            409,
            "Já existe uma Entrada Manual de Saldo pendente para este produto e local.",
        )

    item = EntradaSaldoMobilePendente(
        nome_produto=nome,
        quantidade=float(dados.quantidade),
        unidade="un",
        setor_id=dados.setor_id,
        deposito_id=dados.deposito_id,
        gaveta_id=str(dados.gaveta_id or "").strip() or None,
        foto_url=str(dados.foto_url or "").strip() or None,
        status="PENDENTE",
        solicitante_nome=_nome_usuario(current_user),
        created_by_id=current_user.id,
    )

    db.add(item)
    db.flush()

    registrar_auditoria(
        db,
        usuario=current_user,
        acao="solicitar",
        entidade="EntradaSaldoMobilePendente",
        registro_id=item.id,
        depois=_serializar(item),
        detalhe="Entrada Manual de Saldo enviada pelo mobile para revisão.",
    )

    db.commit()
    db.refresh(item)

    return _serializar(item)


@router.get("/minhas")
def minhas(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _exigir_permissao_mobile(current_user)

    itens = db.scalars(
        select(EntradaSaldoMobilePendente)
        .where(EntradaSaldoMobilePendente.created_by_id == current_user.id)
        .order_by(EntradaSaldoMobilePendente.created_date.desc())
        .limit(20)
    ).all()

    return [_serializar(item) for item in itens]


@router.get("")
def listar_admin(
    status: Literal["PENDENTE", "APROVADO", "REJEITADO"] | None = Query(None),
    _: User = Depends(dep_permissao("admin.entrada_saldo_mobile.revisar")),
    db: Session = Depends(get_db),
):
    stmt = select(EntradaSaldoMobilePendente)

    if status:
        stmt = stmt.where(EntradaSaldoMobilePendente.status == status)

    itens = db.scalars(
        stmt.order_by(EntradaSaldoMobilePendente.created_date.desc())
    ).all()

    return [_serializar(item) for item in itens]


@router.get("/contador")
def contador(
    _: User = Depends(dep_permissao("admin.entrada_saldo_mobile.revisar")),
    db: Session = Depends(get_db),
):
    total = db.scalar(
        select(func.count())
        .select_from(EntradaSaldoMobilePendente)
        .where(EntradaSaldoMobilePendente.status == "PENDENTE")
    ) or 0

    return {"pendentes": total}


def processar_entrada_manual_saldo(
    db: Session,
    *,
    current_user: User,
    nome_produto: str,
    quantidade: float,
    setor_id: str,
    deposito_id: str,
    gaveta_id: str | None,
    unidade: str = "un",
    data_validade: date | None = None,
    foto_url: str | None = None,
    origem_modulo: str,
    documento_origem_id: str | None = None,
    observacao: str | None = None,
    detalhe_criacao: str | None = None,
) -> dict:
    nome = str(nome_produto or "").strip()
    unidade_normalizada = str(unidade or "un").strip().lower() or "un"
    foto = str(foto_url or "").strip() or None

    if not nome:
        raise HTTPException(400, "Informe o nome do produto.")

    setor, _, _, _ = _validar_local(
        db,
        setor_id=setor_id,
        deposito_id=deposito_id,
        gaveta_id=gaveta_id,
    )

    if setor.controla_validade and not data_validade:
        raise HTTPException(
            400,
            "Este setor controla validade. Informe a data de validade.",
        )

    produto = _produto_por_nome(db, nome)
    produto_criado = produto is None

    if produto is not None and produto.setor_id != setor_id:
        raise HTTPException(
            409,
            (
                f"O produto '{nome}' já existe em outro setor. "
                "Revise o cadastro antes de continuar."
            ),
        )

    usuario_id = str(current_user.id)

    if produto is None:
        codigo = _proximo_codigo_produto(db)

        produto = Produto(
            codigo=codigo,
            nome=nome,
            setor_id=setor_id,
            deposito_id=deposito_id,
            gaveta_id=str(gaveta_id or "").strip() or None,
            unidade=unidade_normalizada,
            quantidade=0,
            estoque_minimo=0,
            custo_unitario=0,
            venda=False,
            foto_url=foto,
            created_by_id=usuario_id,
        )

        db.add(produto)
        db.flush()

        registrar_auditoria(
            db,
            usuario=current_user,
            acao="criar",
            entidade="Produto",
            registro_id=produto.id,
            depois=serializar(produto),
            detalhe=(
                detalhe_criacao
                or "Criado pela Entrada Manual de Saldo."
            ),
        )

        db.commit()
        db.refresh(produto)

    produto_id = str(produto.id)
    produto_unidade = str(produto.unidade or unidade_normalizada)
    produto_custo = float(produto.custo_unitario or 0)

    # O motor abre e controla a própria transação.
    db.rollback()

    movimento_item = {
        "produto_id": produto_id,
        "quantidade": float(quantidade),
        "unidade": produto_unidade,
        "deposito_destino_id": deposito_id,
        "gaveta_destino_id": str(gaveta_id or "").strip(),
        "custo_unitario": produto_custo,
    }

    if data_validade:
        movimento_item["data_validade"] = data_validade.isoformat()

    documento = movimentar_estoque(
        db,
        tipo_movimento="ENTRADA_SALDO_ADMIN",
        usuario_id=usuario_id,
        itens=[movimento_item],
        origem_modulo=origem_modulo,
        documento_origem_id=documento_origem_id,
        observacao=(
            str(observacao or "").strip()
            or "Entrada Manual de Saldo."
        ),
    )

    documento_id = str(documento.id)
    documento_numero = str(documento.numero)
    db.rollback()

    produto = db.get(Produto, produto_id)

    if produto is None:
        raise HTTPException(
            404,
            "Produto não encontrado após a contabilização.",
        )

    if foto:
        produto.foto_url = foto

    if not produto.deposito_id:
        produto.deposito_id = deposito_id

    if not produto.gaveta_id and gaveta_id:
        produto.gaveta_id = gaveta_id

    db.commit()
    db.refresh(produto)

    return {
        "produto": produto,
        "produto_id": produto_id,
        "produto_unidade": produto_unidade,
        "documento_id": documento_id,
        "documento_numero": documento_numero,
        "produto_criado": produto_criado,
    }


@router.post("/{item_id}/aprovar")
def aprovar(
    item_id: str,
    dados: AprovarEntradaSaldoMobile,
    current_user: User = Depends(dep_permissao("admin.entrada_saldo_mobile.revisar")),
    db: Session = Depends(get_db),
):
    item = db.scalar(
        select(EntradaSaldoMobilePendente)
        .where(EntradaSaldoMobilePendente.id == item_id)
        .with_for_update()
    )

    if item is None:
        raise HTTPException(404, "Solicitação não encontrada.")

    if item.status != "PENDENTE":
        raise HTTPException(409, "Esta solicitação já foi analisada.")

    nome = dados.nome_produto.strip()
    unidade = dados.unidade.strip().lower() or "un"

    admin_id = str(current_user.id)
    admin_nome = _nome_usuario(current_user)
    foto_url = item.foto_url

    _validar_local(
        db,
        setor_id=dados.setor_id,
        deposito_id=dados.deposito_id,
        gaveta_id=dados.gaveta_id,
    )

    item.status = "PROCESSANDO"
    db.commit()

    try:
        resultado = processar_entrada_manual_saldo(
            db,
            current_user=current_user,
            nome_produto=nome,
            quantidade=float(dados.quantidade),
            setor_id=dados.setor_id,
            deposito_id=dados.deposito_id,
            gaveta_id=dados.gaveta_id,
            unidade=unidade,
            data_validade=dados.data_validade,
            foto_url=foto_url,
            origem_modulo="entrada_saldo_mobile",
            documento_origem_id=item_id,
            observacao=(
                "Entrada Manual de Saldo enviada pelo mobile, "
                f"revisada e aprovada por {admin_nome}."
            ),
            detalhe_criacao=(
                f"Criado pela Entrada Manual de Saldo mobile {item_id}."
            ),
        )

        documento_id = resultado["documento_id"]
        documento_numero = resultado["documento_numero"]
        produto_id = resultado["produto_id"]
        produto_unidade = resultado["produto_unidade"]

        db.rollback()
        item = db.get(EntradaSaldoMobilePendente, item_id)
        produto = db.get(Produto, produto_id)

        if item is None:
            raise HTTPException(
                404,
                "Solicitação não encontrada após a contabilização.",
            )

        if produto is None:
            raise HTTPException(
                404,
                "Produto não encontrado após a contabilização.",
            )

        item.status = "APROVADO"
        item.nome_produto = nome
        item.quantidade = float(dados.quantidade)
        item.unidade = produto_unidade
        item.setor_id = dados.setor_id
        item.deposito_id = dados.deposito_id
        item.gaveta_id = str(dados.gaveta_id or "").strip() or None
        item.data_validade = dados.data_validade
        item.produto_id = produto_id
        item.documento_estoque_id = documento_id
        item.analisado_por_id = admin_id
        item.analisado_por_nome = admin_nome
        item.analisado_em = datetime.now(timezone.utc)

        registrar_auditoria(
            db,
            usuario=current_user,
            acao="aprovar",
            entidade="EntradaSaldoMobilePendente",
            registro_id=item.id,
            depois=_serializar(item),
            detalhe=f"Saldo contabilizado no documento {documento_numero}.",
        )

        db.commit()
        db.refresh(item)
        db.refresh(produto)

        return {
            "solicitacao": _serializar(item),
            "produto": serializar(produto),
            "documento": {
                "id": documento_id,
                "numero": documento_numero,
            },
        }

    except HTTPException:
        db.rollback()
        item = db.get(EntradaSaldoMobilePendente, item_id)

        if item is not None and item.status == "PROCESSANDO":
            item.status = "PENDENTE"
            db.commit()

        raise

    except EstoqueErro as erro:
        db.rollback()
        item = db.get(EntradaSaldoMobilePendente, item_id)

        if item is not None and item.status == "PROCESSANDO":
            item.status = "PENDENTE"
            db.commit()

        raise HTTPException(400, str(erro)) from erro

    except Exception as erro:
        # Falha inesperada nunca deve consumir a solicitação.
        # O usuário pode corrigir/repetir a aprovação sem perder dados/foto.
        db.rollback()
        item = db.get(EntradaSaldoMobilePendente, item_id)

        if item is not None and item.status == "PROCESSANDO":
            item.status = "PENDENTE"
            db.commit()

        raise HTTPException(
            status_code=500,
            detail=(
                "Não foi possível concluir a aprovação. "
                "A solicitação foi preservada como pendente. "
                "Tente novamente."
            ),
        ) from erro


@router.post("/{item_id}/rejeitar")
def rejeitar(
    item_id: str,
    dados: RejeitarEntradaSaldoMobile,
    current_user: User = Depends(dep_permissao("admin.entrada_saldo_mobile.revisar")),
    db: Session = Depends(get_db),
):
    item = db.scalar(
        select(EntradaSaldoMobilePendente)
        .where(EntradaSaldoMobilePendente.id == item_id)
        .with_for_update()
    )

    if item is None:
        raise HTTPException(404, "Solicitação não encontrada.")

    if item.status != "PENDENTE":
        raise HTTPException(409, "Esta solicitação já foi analisada.")

    foto = item.foto_url

    item.status = "REJEITADO"
    item.motivo_rejeicao = dados.motivo.strip()
    item.analisado_por_id = current_user.id
    item.analisado_por_nome = _nome_usuario(current_user)
    item.analisado_em = datetime.now(timezone.utc)
    item.foto_url = None

    registrar_auditoria(
        db,
        usuario=current_user,
        acao="rejeitar",
        entidade="EntradaSaldoMobilePendente",
        registro_id=item.id,
        depois=_serializar(item),
    )

    db.commit()
    _excluir_imagem_rejeitada(foto)
    db.refresh(item)

    return _serializar(item)
