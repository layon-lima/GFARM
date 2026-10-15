from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.api.entrada_saldo_mobile import (
    _caminho_imagem_temporaria,
    processar_entrada_manual_saldo,
)
from app.core.access_control import (
    acesso_estoque_apenas_mobile,
    exigir_acao_estoque_mobile,
    exigir_confirmacao_abastecimento,
    exigir_leitura_estoque,
    pagina_da_origem,
    produtos_em_setores_mobile,
    setores_mobile_ids,
    tem_pagina,
    tem_permissao,
)
from app.db.database import get_db
from app.models import (
    Deposito,
    EstoqueDocumento,
    EstoqueDocumentoItem,
    EstoqueSaldo,
    Produto,
    User,
)
from app.services.motor_estoque import (
    EstoqueErro,
    MOVIMENTOS_VALIDOS,
    estornar_documento,
    movimentar_estoque,
)


router = APIRouter(
    prefix="/api/estoque",
    tags=["Estoque"],
)


class MovimentoItemRequest(BaseModel):
    produto_id: str
    quantidade: Decimal = Field(gt=0)
    unidade: str | None = None
    fator_conversao: Decimal | None = Field(
        default=None,
        gt=0,
    )

    deposito_origem_id: str | None = None
    gaveta_origem_id: str | None = None
    lote_origem_id: str | None = None

    deposito_destino_id: str | None = None
    gaveta_destino_id: str | None = None
    lote_destino_id: str | None = None

    custo_unitario: Decimal | None = None
    data_validade: str | None = None
    observacao: str | None = None


class MovimentoRequest(BaseModel):
    tipo_movimento: str
    origem_modulo: str = "manual"
    documento_origem_id: str | None = None
    referencia_externa: str | None = None
    observacao: str | None = None
    itens: list[MovimentoItemRequest]


class EntradaManualSaldoRequest(BaseModel):
    nome_produto: str = Field(min_length=1, max_length=255)
    quantidade: Decimal = Field(gt=0)
    setor_id: str = Field(min_length=1, max_length=100)
    deposito_id: str = Field(min_length=1, max_length=100)
    gaveta_id: str | None = None
    unidade: str = Field(default="un", min_length=1, max_length=30)
    data_validade: date | None = None
    foto_url: str | None = None
    observacao: str | None = Field(default=None, max_length=2000)


class EstornoRequest(BaseModel):
    motivo: str = Field(
        min_length=3,
        max_length=500,
    )


def _numero(valor):
    if valor is None:
        return 0

    return float(valor)


def _serializar_documento(
    db: Session,
    documento: EstoqueDocumento,
) -> dict[str, Any]:
    itens = db.scalars(
        select(EstoqueDocumentoItem)
        .where(
            EstoqueDocumentoItem.documento_id
            == documento.id
        )
        .order_by(
            EstoqueDocumentoItem.item_numero
        )
    ).all()

    return {
        "id": documento.id,
        "numero": documento.numero,
        "tipo_movimento": documento.tipo_movimento,
        "status": documento.status,
        "origem_modulo": documento.origem_modulo,
        "documento_origem_id": documento.documento_origem_id,
        "referencia_externa": documento.referencia_externa,
        "data_documento": documento.data_documento,
        "contabilizado_em": documento.contabilizado_em,
        "estornado_em": documento.estornado_em,
        "estorno_de_id": documento.estorno_de_id,
        "estornado_por_documento_id": (
            documento.estornado_por_documento_id
        ),
        "motivo_estorno": documento.motivo_estorno,
        "usuario_id": documento.usuario_id,
        "observacao": documento.observacao,
        "itens": [
            {
                "id": item.id,
                "item_numero": item.item_numero,
                "produto_id": item.produto_id,
                "quantidade": _numero(
                    item.quantidade
                ),
                "unidade": item.unidade,
                "quantidade_informada": _numero(
                    item.quantidade_informada
                ),
                "unidade_informada": item.unidade_informada,
                "fator_conversao": _numero(
                    item.fator_conversao
                ),
                "deposito_origem_id": item.deposito_origem_id,
                "gaveta_origem_id": item.gaveta_origem_id,
                "lote_origem_id": item.lote_origem_id,
                "deposito_destino_id": item.deposito_destino_id,
                "gaveta_destino_id": item.gaveta_destino_id,
                "lote_destino_id": item.lote_destino_id,
                "custo_unitario": _numero(
                    item.custo_unitario
                ),
                "valor_total": _numero(
                    item.valor_total
                ),
                "observacao": item.observacao,
            }
            for item in itens
        ],
    }


def _produto_ids(
    dados: MovimentoRequest,
) -> list[str]:
    return [
        item.produto_id
        for item in dados.itens
        if item.produto_id
    ]


def _exigir_movimentacao_permitida(
    dados: MovimentoRequest,
    current_user: User,
    db: Session,
):
    origem = str(dados.origem_modulo or "").strip().lower()
    tipo = str(dados.tipo_movimento or "").strip().upper()

    if tipo == "ENTRADA_SALDO_ADMIN":
        if not tem_permissao(
            current_user,
            "admin.estoque.entrada_manual",
        ):
            raise HTTPException(
                status_code=403,
                detail="Usuário sem permissão para registrar entrada manual de saldo.",
            )

        if origem != "movimentacoes":
            raise HTTPException(
                status_code=400,
                detail="A entrada manual de saldo só pode ser registrada pela página Movimentos.",
            )

        if dados.documento_origem_id or dados.referencia_externa:
            raise HTTPException(
                status_code=400,
                detail="A entrada manual de saldo não aceita nota fiscal ou documento de origem.",
            )

        if len(str(dados.observacao or "").strip()) < 3:
            raise HTTPException(
                status_code=400,
                detail="Informe uma justificativa para a entrada manual de saldo.",
            )

        for item in dados.itens:
            if item.deposito_origem_id or item.gaveta_origem_id or item.lote_origem_id:
                raise HTTPException(
                    status_code=400,
                    detail="A entrada manual de saldo deve informar somente o destino do estoque.",
                )

        return

    if str(dados.documento_origem_id or '').startswith('fora-estoque:'):
        raise HTTPException(403, 'A entrada de itens encontrados exige revisão pela rotina de inventário.')

    if origem == "mobile":
        if not produtos_em_setores_mobile(
            current_user,
            _produto_ids(dados),
            db,
        ) and current_user.role != "admin":
            raise HTTPException(
                status_code=403,
                detail="Produto fora dos setores liberados para este usuário.",
            )

        for item in dados.itens:
            produto = db.get(Produto, item.produto_id)

            if produto is None:
                raise HTTPException(status_code=404, detail="Produto não encontrado.")

            deposito_ids = {
                str(valor).strip()
                for valor in (
                    item.deposito_origem_id,
                    item.deposito_destino_id,
                )
                if valor
            }

            for deposito_id in deposito_ids:
                deposito = db.get(Deposito, deposito_id)

                if deposito is None or deposito.setor_id != produto.setor_id:
                    raise HTTPException(
                        status_code=403,
                        detail="O depósito informado não pertence ao setor do produto.",
                    )

        if tipo == "SAIDA_CONSUMO":
            exigir_acao_estoque_mobile(current_user, "baixar")
            return

        if tipo == "TRANSFERENCIA":
            acoes = set()

            for item in dados.itens:
                origem_dep = str(item.deposito_origem_id or "").strip()
                destino_dep = str(item.deposito_destino_id or "").strip()
                origem_gav = str(item.gaveta_origem_id or "").strip()
                destino_gav = str(item.gaveta_destino_id or "").strip()

                if not origem_gav or not destino_gav:
                    raise HTTPException(
                        status_code=400,
                        detail="A gaveta de origem e a gaveta de destino são obrigatórias.",
                    )

                if origem_dep == destino_dep:
                    if origem_gav == destino_gav:
                        raise HTTPException(
                            status_code=400,
                            detail="Escolha uma gaveta de destino diferente.",
                        )
                    acoes.add("mudar_gaveta")
                else:
                    if origem_gav == destino_gav:
                        raise HTTPException(
                            status_code=400,
                            detail="Ao mudar o depósito, a gaveta também deve mudar.",
                        )
                    acoes.add("mudar_deposito")

            if len(acoes) != 1:
                raise HTTPException(
                    status_code=400,
                    detail="Uma movimentação mobile deve executar apenas uma ação.",
                )

            exigir_acao_estoque_mobile(current_user, acoes.pop())
            return

        raise HTTPException(
            status_code=400,
            detail="Tipo de movimentação não permitido pelo celular.",
        )

    pagina = pagina_da_origem(
        dados.origem_modulo
    )

    if pagina == "abastecimento":
        exigir_confirmacao_abastecimento(
            current_user
        )
        return

    if tem_pagina(
        current_user,
        pagina,
    ):
        return

    if (
        pagina == "movimentacoes"
        and produtos_em_setores_mobile(
            current_user,
            _produto_ids(dados),
            db,
        )
    ):
        return

    raise HTTPException(
        status_code=403,
        detail=(
            "Usuário sem permissão para "
            "contabilizar esta movimentação."
        ),
    )


def _produto_ids_documento(
    db: Session,
    documento_id: str,
) -> list[str]:
    return list(
        db.scalars(
            select(
                EstoqueDocumentoItem.produto_id
            )
            .where(
                EstoqueDocumentoItem.documento_id
                == documento_id
            )
        ).all()
    )


def _exigir_estorno_permitido(
    documento: EstoqueDocumento,
    current_user: User,
    db: Session,
):
    # A aba Movimentos continua podendo
    # estornar documentos, como já fazia.
    if tem_pagina(
        current_user,
        "movimentacoes",
    ):
        return

    pagina_origem = pagina_da_origem(
        documento.origem_modulo
    )

    if (
        pagina_origem
        == "abastecimento"
    ):
        exigir_confirmacao_abastecimento(
            current_user
        )
        return

    if tem_pagina(
        current_user,
        pagina_origem,
    ):
        return

    if produtos_em_setores_mobile(
        current_user,
        _produto_ids_documento(
            db,
            documento.id,
        ),
        db,
    ):
        return

    raise HTTPException(
        status_code=403,
        detail=(
            "Usuário sem permissão para "
            "estornar este documento."
        ),
    )


def _aplicar_escopo_mobile_documentos(
    stmt,
    current_user: User,
):
    if not acesso_estoque_apenas_mobile(
        current_user
    ):
        return stmt

    setores = sorted(
        setores_mobile_ids(
            current_user
        )
    )

    documentos_permitidos = (
        select(
            EstoqueDocumentoItem.documento_id
        )
        .join(
            Produto,
            Produto.id
            == EstoqueDocumentoItem.produto_id,
        )
        .where(
            Produto.setor_id.in_(
                setores
            )
        )
        .distinct()
    )

    documentos_fora_escopo = (
        select(
            EstoqueDocumentoItem.documento_id
        )
        .join(
            Produto,
            Produto.id
            == EstoqueDocumentoItem.produto_id,
        )
        .where(
            Produto.setor_id.notin_(
                setores
            )
        )
        .distinct()
    )

    return stmt.where(
        EstoqueDocumento.id.in_(
            documentos_permitidos
        ),
        EstoqueDocumento.id.notin_(
            documentos_fora_escopo
        ),
    )


def _documento_visivel(
    documento: EstoqueDocumento,
    current_user: User,
    db: Session,
) -> bool:
    if not acesso_estoque_apenas_mobile(
        current_user
    ):
        return True

    return produtos_em_setores_mobile(
        current_user,
        _produto_ids_documento(
            db,
            documento.id,
        ),
        db,
    )


@router.get("/tipos-movimento")
def tipos_movimento(
    current_user: User = Depends(
        get_current_user
    ),
):
    exigir_leitura_estoque(
        current_user
    )

    return sorted(
        MOVIMENTOS_VALIDOS
    )


@router.post("/entrada-manual")
def registrar_entrada_manual_pc(
    dados: EntradaManualSaldoRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not tem_permissao(
        current_user,
        "admin.estoque.entrada_manual",
    ):
        raise HTTPException(
            status_code=403,
            detail="Usuário sem permissão para registrar entrada manual de saldo.",
        )

    if (
        dados.foto_url
        and _caminho_imagem_temporaria(
            dados.foto_url
        ) is None
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "A foto do produto deve ser uma imagem "
                "enviada pelo próprio sistema."
            ),
        )

    try:
        resultado = processar_entrada_manual_saldo(
            db,
            current_user=current_user,
            nome_produto=dados.nome_produto,
            quantidade=float(dados.quantidade),
            setor_id=dados.setor_id,
            deposito_id=dados.deposito_id,
            gaveta_id=dados.gaveta_id,
            unidade=dados.unidade,
            data_validade=dados.data_validade,
            foto_url=dados.foto_url,
            origem_modulo="movimentacoes",
            observacao=(
                str(dados.observacao or "").strip()
                or (
                    "Entrada Manual de Saldo registrada "
                    "diretamente pelo módulo do PC."
                )
            ),
            detalhe_criacao=(
                "Produto criado pela Entrada Manual de Saldo "
                "do módulo Movimentos no PC."
            ),
        )

        return {
            "produto_id": resultado["produto_id"],
            "produto_criado": resultado["produto_criado"],
            "documento": {
                "id": resultado["documento_id"],
                "numero": resultado["documento_numero"],
            },
        }

    except EstoqueErro as erro:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=str(erro),
        ) from erro


@router.post("/movimentar")
def movimentar(
    dados: MovimentoRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _exigir_movimentacao_permitida(
        dados,
        current_user,
        db,
    )

    usuario_id = current_user.id

    # A autenticaÃƒÂ§ÃƒÂ£o jÃƒÂ¡ realizou uma leitura usando
    # esta sessÃƒÂ£o. Encerramos essa transaÃƒÂ§ÃƒÂ£o somente
    # de leitura antes de abrir a transaÃƒÂ§ÃƒÂ£o do estoque.
    db.rollback()

    try:
        documento = movimentar_estoque(
            db,
            tipo_movimento=dados.tipo_movimento,
            usuario_id=usuario_id,
            itens=[
                item.model_dump(
                    exclude_none=True
                )
                for item in dados.itens
            ],
            origem_modulo=dados.origem_modulo,
            documento_origem_id=dados.documento_origem_id,
            referencia_externa=dados.referencia_externa,
            observacao=dados.observacao,
        )

        return {
            "success": True,
            "message": (
                f"MovimentaÃƒÂ§ÃƒÂ£o {documento.numero} "
                "contabilizada com sucesso."
            ),
            "documento": _serializar_documento(
                db,
                documento,
            ),
        }

    except EstoqueErro as erro:
        raise HTTPException(
            status_code=400,
            detail=str(erro),
        )


@router.post(
    "/documentos/{documento_id}/estornar"
)
def estornar(
    documento_id: str,
    dados: EstornoRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    documento_alvo = db.get(
        EstoqueDocumento,
        documento_id,
    )

    if documento_alvo is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Documento de estoque "
                "não encontrado."
            ),
        )

    _exigir_estorno_permitido(
        documento_alvo,
        current_user,
        db,
    )

    usuario_id = current_user.id

    db.rollback()

    try:
        documento = estornar_documento(
            db,
            documento_id=documento_id,
            usuario_id=usuario_id,
            motivo=dados.motivo,
        )

        return {
            "success": True,
            "message": (
                f"Documento {documento.referencia_externa} "
                f"estornado atravÃƒÂ©s de "
                f"{documento.numero}."
            ),
            "documento": _serializar_documento(
                db,
                documento,
            ),
        }

    except EstoqueErro as erro:
        raise HTTPException(
            status_code=400,
            detail=str(erro),
        )


@router.get("/saldos")
def listar_saldos(
    produto_id: str | None = None,
    deposito_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exigir_leitura_estoque(
        current_user
    )

    stmt = (
        select(
            EstoqueSaldo,
            Produto,
        )
        .join(
            Produto,
            Produto.id
            == EstoqueSaldo.produto_id,
        )
        .order_by(
            Produto.nome,
            EstoqueSaldo.deposito_id,
        )
    )

    if acesso_estoque_apenas_mobile(
        current_user
    ):
        stmt = stmt.where(
            Produto.setor_id.in_(
                sorted(
                    setores_mobile_ids(
                        current_user
                    )
                )
            )
        )

    if produto_id:
        stmt = stmt.where(
            EstoqueSaldo.produto_id
            == produto_id
        )

    if deposito_id:
        stmt = stmt.where(
            EstoqueSaldo.deposito_id
            == deposito_id
        )

    registros = db.execute(stmt).all()

    return [
        {
            "id": saldo.id,
            "produto_id": saldo.produto_id,
            "produto_codigo": produto.codigo,
            "produto_nome": produto.nome,
            "deposito_id": saldo.deposito_id,
            "gaveta_id": saldo.gaveta_id or None,
            "lote_id": saldo.lote_id or None,
            "tipo_estoque": saldo.tipo_estoque,
            "quantidade": _numero(
                saldo.quantidade
            ),
            "quantidade_reservada": _numero(
                saldo.quantidade_reservada
            ),
            "quantidade_disponivel": _numero(
                saldo.quantidade
                - saldo.quantidade_reservada
            ),
            "custo_medio": _numero(
                saldo.custo_medio
            ),
            "valor_total": _numero(
                saldo.valor_total
            ),
        }
        for saldo, produto in registros
    ]


@router.get("/documentos")
def listar_documentos(
    limit: int = 100,
    origem_modulo: str | None = None,
    documento_origem_id: str | None = None,
    referencia_externa: str | None = None,
    tipo_movimento: str | None = None,
    status: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exigir_leitura_estoque(
        current_user
    )

    limit = max(
        1,
        min(limit, 500),
    )

    stmt = select(
        EstoqueDocumento
    )

    stmt = (
        _aplicar_escopo_mobile_documentos(
            stmt,
            current_user,
        )
    )

    if origem_modulo:
        stmt = stmt.where(
            EstoqueDocumento.origem_modulo
            == origem_modulo.strip().lower()
        )

    if documento_origem_id:
        stmt = stmt.where(
            EstoqueDocumento.documento_origem_id
            == documento_origem_id.strip()
        )

    if referencia_externa:
        stmt = stmt.where(
            EstoqueDocumento.referencia_externa
            == referencia_externa.strip()
        )

    if tipo_movimento:
        stmt = stmt.where(
            EstoqueDocumento.tipo_movimento
            == tipo_movimento.strip().upper()
        )

    if status:
        stmt = stmt.where(
            EstoqueDocumento.status
            == status.strip().lower()
        )

    documentos = db.scalars(
        stmt
        .order_by(
            EstoqueDocumento.data_documento.desc()
        )
        .limit(limit)
    ).all()

    return [
        _serializar_documento(
            db,
            documento,
        )
        for documento in documentos
    ]


@router.get("/documentos/{documento_id}")
def obter_documento(
    documento_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exigir_leitura_estoque(
        current_user
    )

    documento = db.get(
        EstoqueDocumento,
        documento_id,
    )

    if documento is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Documento de estoque "
                "não encontrado."
            ),
        )

    if not _documento_visivel(
        documento,
        current_user,
        db,
    ):
        raise HTTPException(
            status_code=404,
            detail=(
                "Documento de estoque "
                "não encontrado."
            ),
        )

    return _serializar_documento(
        db,
        documento,
    )
