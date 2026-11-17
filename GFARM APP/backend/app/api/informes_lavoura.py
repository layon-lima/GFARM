"""Informe de saída para lavoura: solicitação, revisão e baixa oficial.

Não cria OS e não contabiliza estoque em endpoints de solicitação/edição.
A aprovação chama exclusivamente o motor de estoque; custos vêm dos documentos oficiais.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
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
    Deposito, Gaveta, EstoqueDocumento, EstoqueDocumentoItem, EstoqueSaldo,
    InformeSaidaLavoura, Lavoura, OrdemServicoAplicacao, Produto, Setor, User,
)
from app.services.auditoria_erp import registrar_auditoria
from app.services.motor_estoque import EstoqueErro, movimentar_estoque

router = APIRouter(prefix="/api/informes-lavoura", tags=["Informes de saída para lavoura"])
PERM_SOLICITAR = "mobile.informe_lavoura.solicitar"
PERM_REVISAR = "admin.informe_lavoura.revisar"


class ProdutoSolicitado(BaseModel):
    produto_id: str = Field(min_length=1, max_length=100)
    quantidade: Decimal = Field(gt=0, max_digits=18, decimal_places=3, allow_inf_nan=False)
    deposito_id: str | None = None
    gaveta_id: str | None = None


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
        deposito_id = str(item.deposito_id or "").strip() or None
        gaveta_id = str(item.gaveta_id or "").strip() or None
        if gaveta_id and not deposito_id:
            raise HTTPException(400, "Informe o depósito para a gaveta selecionada.")
        if deposito_id:
            deposito = db.get(Deposito, deposito_id)
            if not deposito or (deposito.setor_id and deposito.setor_id != produto.setor_id):
                raise HTTPException(400, "O depósito não pertence ao setor deste produto.")
        if gaveta_id:
            gaveta = db.get(Gaveta, gaveta_id)
            if not gaveta or gaveta.deposito_id != deposito_id:
                raise HTTPException(400, "A gaveta não pertence ao depósito selecionado.")
        itens.append({
            "deposito_id": deposito_id,
            "gaveta_id": gaveta_id,
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
    if not (tem_permissao(user, PERM_SOLICITAR) or tem_permissao(user, PERM_REVISAR)):
        raise HTTPException(403, "Usuário sem permissão para consultar lavouras.")
    lavouras = db.scalars(select(Lavoura).order_by(Lavoura.nome)).all()
    setores = {setor.id: setor for setor in db.scalars(select(Setor)).all()}
    escopo = setores_mobile_ids(user) if user.role != "admin" and not tem_permissao(user, PERM_REVISAR) else None
    produtos = db.scalars(select(Produto).order_by(Produto.nome)).all()
    depositos = {dep.id: dep for dep in db.scalars(select(Deposito)).all()}
    gavetas = {gav.id: gav for gav in db.scalars(select(Gaveta)).all()}
    saldos = db.scalars(
        select(EstoqueSaldo).where(EstoqueSaldo.tipo_estoque == "livre")
    ).all()
    locais_por_produto = defaultdict(dict)
    for saldo in saldos:
        livre = Decimal(str(saldo.quantidade or 0)) - Decimal(str(saldo.quantidade_reservada or 0))
        if livre <= 0:
            continue
        dep = depositos.get(saldo.deposito_id)
        gav = gavetas.get(saldo.gaveta_id)
        if not dep:
            continue
        chave = (saldo.deposito_id, saldo.gaveta_id or "")
        nome = " — ".join(filter(None, [
            str(dep.numero or dep.nome or "Depósito"),
            str(gav.codigo) if gav else "",
        ]))
        locais_por_produto[saldo.produto_id][chave] = {
            "deposito_id": saldo.deposito_id,
            "gaveta_id": saldo.gaveta_id or None,
            "nome": nome,
        }

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
                "locais": list(locais_por_produto[produto.id].values()),
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
    """Custos contabilizados dos informes e histórico de OS legado separados.

    Valores dos informes vêm somente dos itens do documento oficial.
    Valores legados vêm do custo_total gravado na OS antiga; jamais
    alterá-los nem adicioná-los ao custo oficial dos informes.
    """
    if user.role != "admin":
        raise HTTPException(403, "Custos disponíveis apenas para Administrador Total.")

    informes = db.scalars(
        select(InformeSaidaLavoura)
        .where(InformeSaidaLavoura.status == "APROVADO")
        .order_by(InformeSaidaLavoura.created_date.desc())
    ).all()
    doc_por_informe = {
        str(informe.documento_estoque_id): informe
        for informe in informes if informe.documento_estoque_id
    }
    ids = list(doc_por_informe)
    lavouras = {lav.id: lav for lav in db.scalars(select(Lavoura)).all()}
    produtos = {prod.id: prod for prod in db.scalars(select(Produto)).all()}
    por_lavoura = defaultdict(lambda: {
        "custo_total": 0.0, "quantidade_informes": 0, "produtos": {},
    })
    # Agrupa pelo ID, não pelo nome histórico (a lavoura pode ser renomeada).
    nomes_historicos = {informe.lavoura_id: informe.lavoura_nome for informe in informes}
    detalhes = {informe.id: 0.0 for informe in informes}
    documentos_validos = set()

    if ids:
        # Lotes/localizações podem criar várias linhas para o mesmo produto;
        # a soma por produto usa SOMENTE valores efetivamente contabilizados.
        linhas = db.execute(
            select(
                EstoqueDocumentoItem.documento_id,
                EstoqueDocumentoItem.produto_id,
                EstoqueDocumentoItem.unidade,
                func.sum(EstoqueDocumentoItem.quantidade),
                func.sum(EstoqueDocumentoItem.valor_total),
            )
            .join(EstoqueDocumento, EstoqueDocumento.id == EstoqueDocumentoItem.documento_id)
            .where(
                EstoqueDocumentoItem.documento_id.in_(ids),
                EstoqueDocumento.status == "contabilizado",
                EstoqueDocumento.origem_modulo == "informe_lavoura",
            )
            .group_by(
                EstoqueDocumentoItem.documento_id,
                EstoqueDocumentoItem.produto_id,
                EstoqueDocumentoItem.unidade,
            )
        ).all()
        for doc_id, produto_id, unidade, quantidade, valor in linhas:
            informe = doc_por_informe.get(doc_id)
            if informe is None:
                continue
            documentos_validos.add(doc_id)
            valor_float = float(valor or 0)
            lav = por_lavoura[informe.lavoura_id]
            lav["custo_total"] += valor_float
            detalhes[informe.id] += valor_float
            chave_produto = (produto_id, unidade)
            produto = lav["produtos"].setdefault(chave_produto, {
                "produto_id": produto_id,
                "produto_nome": produtos[produto_id].nome if produto_id in produtos else produto_id,
                "unidade": unidade,
                "quantidade": 0.0,
                "custo_total": 0.0,
            })
            produto["quantidade"] += float(quantidade or 0)
            produto["custo_total"] += valor_float

    # Conta documentos de valor zero também quando efetivamente contabilizados.
    if ids:
        docs_contabilizados = set(db.scalars(
            select(EstoqueDocumento.id)
            .where(
                EstoqueDocumento.id.in_(ids),
                EstoqueDocumento.status == "contabilizado",
                EstoqueDocumento.origem_modulo == "informe_lavoura",
            )
        ).all())
        documentos_validos.update(docs_contabilizados)
    for doc_id in documentos_validos:
        informe = doc_por_informe[doc_id]
        por_lavoura[informe.lavoura_id]["quantidade_informes"] += 1

    # Registro histórico legado é somente leitura e fica separado dos
    # informes; não é contado duas vezes nem tratado como baixa nova.
    historico_os = defaultdict(lambda: {
        "custo_total": 0.0, "quantidade_os": 0,
    })
    antigas = db.scalars(
        select(OrdemServicoAplicacao).where(
            OrdemServicoAplicacao.status.in_(("baixada", "executada"))
        )
    ).all()
    for os in antigas:
        if not os.lavoura_id:
            continue
        dados = historico_os[os.lavoura_id]
        dados["custo_total"] += float(os.custo_total or 0)
        dados["quantidade_os"] += 1

    resultado = []
    chaves = set(por_lavoura) | set(historico_os)
    for lavoura_id in chaves:
        dados = por_lavoura[lavoura_id]
        area = float(lavouras[lavoura_id].hectares or 0) if lavoura_id in lavouras else 0
        legado = historico_os.get(lavoura_id, {"custo_total": 0.0, "quantidade_os": 0})
        resultado.append({
            "lavoura_id": lavoura_id,
            "lavoura_nome": (
                lavouras[lavoura_id].nome if lavoura_id in lavouras
                else nomes_historicos.get(lavoura_id, lavoura_id)
            ),
            "hectares": area,
            "custo_total": round(dados["custo_total"], 2),
            "quantidade_informes": dados["quantidade_informes"],
            "custo_historico_os": round(legado["custo_total"], 2),
            "quantidade_os_historicas": legado["quantidade_os"],
            "produtos": sorted(
                (
                    {**produto, "quantidade": round(produto["quantidade"], 3),
                     "custo_total": round(produto["custo_total"], 2)}
                    for produto in dados["produtos"].values()
                ),
                key=lambda p: p["custo_total"], reverse=True,
            ),
        })
    resultado.sort(key=lambda lav: lav["custo_total"] + lav["custo_historico_os"], reverse=True)
    return {"lavouras": resultado, "informes": detalhes}


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

        origem_deposito = str(solicitado.get("deposito_id") or "")
        origem_gaveta = str(solicitado.get("gaveta_id") or "")
        if origem_deposito:
            posicoes = {
                (dep, gav): qtd for (dep, gav), qtd in posicoes.items()
                if dep == origem_deposito and gav == origem_gaveta
            }
        elif len(posicoes) > 1:
            raise HTTPException(
                409,
                f"'{produto.nome}' possui estoque em mais de um local. Edite o informe e selecione o depósito/gaveta.",
            )

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
    if item.status == "PROCESSANDO":
        # Queda de rede entre a baixa oficial e a marcação como aprovado:
        # apenas reconciliar o documento já contabilizado, sem outra saída.
        doc = db.scalar(
            select(EstoqueDocumento).where(
                EstoqueDocumento.origem_modulo == "informe_lavoura",
                EstoqueDocumento.documento_origem_id == item_id,
                EstoqueDocumento.tipo_movimento == "SAIDA_CONSUMO",
                EstoqueDocumento.status == "contabilizado",
            )
        )
        if doc is not None:
            item.status = "APROVADO"
            item.documento_estoque_id = doc.id
            item.analisado_por_id = user.id
            item.analisado_por_nome = _nome(user)
            item.analisado_em = datetime.now(timezone.utc)
            registrar_auditoria(
                db, usuario=user, acao="reconciliar", entidade="InformeSaidaLavoura",
                registro_id=item.id, depois=_resumo(item),
                detalhe=f"Recuperação sem nova baixa do documento oficial {doc.id}.",
            )
            db.commit()
            db.refresh(item)
            return _resumo(item)
        atualizado = item.updated_date
        if atualizado is not None:
            if atualizado.tzinfo is None:
                atualizado = atualizado.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - atualizado > timedelta(minutes=2):
                item.status = "PENDENTE"
                db.commit()
                raise HTTPException(409, "Processamento anterior não concluiu. Solicitação liberada, tente novamente.")
        raise HTTPException(409, "Solicitação em processamento. Aguarde antes de tentar novamente.")
    if item.status != "PENDENTE":
        raise HTTPException(409, "Esta solicitação já foi analisada.")

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
