from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.api.users import dep_permissao
from app.core.access_control import exigir_pagina, tem_permissao
from app.db.database import get_db
from app.models import Inventario, InventarioForaEstoque, Produto, Deposito, Gaveta, User
from app.services.motor_estoque import movimentar_estoque, EstoqueErro

router = APIRouter(prefix='/api/inventario-pendencias', tags=['Inventário'])


class Registro(BaseModel):
    descricao: str = Field(min_length=1, max_length=255)
    quantidade: float = Field(gt=0, allow_inf_nan=False)
    unidade: str = Field(min_length=1, max_length=30)
    foto_url: str = Field(min_length=1)
    observacao: str = ''
    inventario_id: str | None = None


class Revisao(BaseModel):
    decisao: Literal['aprovado', 'rejeitado']
    produto_id: str | None = None
    deposito_id: str | None = None
    gaveta_id: str | None = None
    motivo: str = ''
    data_validade: date | None = None


def publico(item):
    return {c.name: getattr(item, c.name) for c in item.__table__.columns}


@router.get('')
def listar(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    exigir_pagina(user, 'inventario')
    query = select(InventarioForaEstoque)
    if not tem_permissao(user, 'admin.inventario.revisar'):
        query = query.where(InventarioForaEstoque.created_by_id == user.id)
    return [publico(item) for item in db.scalars(query.order_by(InventarioForaEstoque.data_registro.desc())).all()]


@router.post('')
def registrar(dados: Registro, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    exigir_pagina(user, 'inventario')
    if not dados.descricao.strip() or not dados.unidade.strip():
        raise HTTPException(400, 'Descrição e unidade são obrigatórias.')
    if dados.inventario_id and not db.get(Inventario, dados.inventario_id):
        raise HTTPException(400, 'Inventário relacionado não encontrado.')
    item = InventarioForaEstoque(**dados.model_dump(), status='pendente', created_by_id=user.id,
        registrado_por=user.display_name or user.username, data_registro=datetime.now(timezone.utc))
    db.add(item)
    db.commit()
    db.refresh(item)
    return publico(item)


@router.post('/{item_id}/revisar')
def revisar(item_id: str, dados: Revisao, user: User = Depends(dep_permissao('admin.inventario.revisar')), db: Session = Depends(get_db)):
    item = db.scalar(select(InventarioForaEstoque).where(InventarioForaEstoque.id == item_id).with_for_update())
    if item is None:
        raise HTTPException(404, 'Registro não encontrado.')
    if item.status != 'pendente':
        raise HTTPException(409, 'Este registro já foi revisado.')
    if dados.decisao == 'rejeitado':
        if not dados.motivo.strip():
            raise HTTPException(400, 'Informe o motivo da rejeição.')
        item.motivo_rejeicao = dados.motivo.strip()
    else:
        produto = db.get(Produto, dados.produto_id) if dados.produto_id else None
        deposito = db.get(Deposito, dados.deposito_id) if dados.deposito_id else None
        gaveta = db.get(Gaveta, dados.gaveta_id) if dados.gaveta_id else None
        if not produto or not deposito or not gaveta or gaveta.deposito_id != deposito.id:
            raise HTTPException(400, 'Selecione produto, depósito e gaveta válidos.')
        if produto.setor_id != deposito.setor_id:
            raise HTTPException(400, 'O depósito deve pertencer ao setor do produto.')
        if (produto.unidade or 'un').strip().lower() != item.unidade.strip().lower():
            raise HTTPException(400, 'A unidade contada deve corresponder à unidade do produto. Revise o cadastro antes de aprovar.')
        try:
            # A sessão do motor usa SAVEPOINT na transação que mantém a pendência
            # bloqueada. Entrada e decisão são confirmadas juntas pelo commit abaixo.
            with Session(bind=db.connection(), join_transaction_mode='create_savepoint') as stock_db:
                documento = movimentar_estoque(stock_db, tipo_movimento='AJUSTE_POSITIVO',
                    usuario_id=user.id, origem_modulo='inventario', documento_origem_id=f'fora-estoque:{item.id}',
                    observacao=f'Item encontrado: {item.descricao}', itens=[{
                        'produto_id': produto.id, 'quantidade': item.quantidade, 'unidade': item.unidade,
                        'deposito_destino_id': deposito.id, 'gaveta_destino_id': gaveta.id,
                        'custo_unitario': produto.custo_unitario or 0,
                        'data_validade': dados.data_validade,
                    }])
                item.documento_estoque_id = documento.id
        except EstoqueErro as error:
            db.rollback()
            raise HTTPException(400, str(error)) from error
        item.produto_id, item.deposito_id, item.gaveta_id = produto.id, deposito.id, gaveta.id
    item.status = dados.decisao
    item.revisado_por = user.display_name or user.username
    item.revisado_em = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return publico(item)
