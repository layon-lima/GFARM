from __future__ import annotations

from datetime import date, datetime
import re
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
)
from sqlalchemy import (
    asc,
    desc,
    select,
)
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.core.access_control import (
    acesso_apenas_mobile_entidade,
    exigir_confirmacao_abastecimento,
    exigir_leitura_entidade,
    exigir_mutacao_entidade,
    setores_mobile_ids,
    tem_permissao,
)
from app.db.database import get_db
from app.services.auditoria_erp import registrar_auditoria
from app.services.motor_estoque import (
    EstoqueErro,
    reavaliar_custo_produto,
)
from app.models import (
    Abastecimento,
    AnoSafra,
    Cultura,
    Deposito,
    EstoqueDocumento,
    EstoqueSaldo,
    Gaveta,
    Inventario,
    InventarioForaEstoque,
    InventarioItem,
    Lavoura,
    Lote,
    Maquina,
    OrdemServicoAplicacao,
    Pagamento,
    PedidoPesagem,
    Pessoa,
    Produto,
    Setor,
    TicketPesagem,
    User,
    Veiculo,
)


router = APIRouter(
    prefix="/api/entities",
    tags=["Entidades"],
)


MODELS = {
    "Abastecimento": Abastecimento,
    "AnoSafra": AnoSafra,
    "Cultura": Cultura,
    "Deposito": Deposito,
    "Gaveta": Gaveta,
    "Inventario": Inventario,
    "InventarioItem": InventarioItem,
    "Lavoura": Lavoura,
    "Lote": Lote,
    "Maquina": Maquina,
    "OrdemServicoAplicacao": (
        OrdemServicoAplicacao
    ),
    "Pagamento": Pagamento,
    "PedidoPesagem": PedidoPesagem,
    "Pessoa": Pessoa,
    "Produto": Produto,
    "Setor": Setor,
    "TicketPesagem": TicketPesagem,
    "User": User,
    "Veiculo": Veiculo,
}


LEGACY_ESTOQUE_BLOQUEADAS = {
    "Movimentacao",
    "SaldoEstoque",
}


MUTACAO_BLOQUEADA = {
    "Lote",
}


def validar_mutacao(
    entidade: str,
):
    if (
        entidade
        in LEGACY_ESTOQUE_BLOQUEADAS
    ):
        raise HTTPException(
            status_code=410,
            detail=(
                f"A entidade '{entidade}' "
                "pertence ao estoque legado. "
                "Use a API /api/estoque."
            ),
        )

    if (
        entidade
        in MUTACAO_BLOQUEADA
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "Lotes são controlados pelo "
                "motor ERP e são somente "
                "leitura pela API genérica."
            ),
        )


def obter_modelo(
    nome: str,
):
    if (
        nome
        in LEGACY_ESTOQUE_BLOQUEADAS
    ):
        raise HTTPException(
            status_code=410,
            detail=(
                f"A entidade '{nome}' "
                "pertence ao estoque legado. "
                "Use a API /api/estoque."
            ),
        )

    if nome == "User":
        raise HTTPException(
            status_code=403,
            detail=(
                "Usuários são gerenciados "
                "pela API administrativa."
            ),
        )

    model = MODELS.get(
        nome
    )

    if model is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Entidade '{nome}' "
                "não encontrada."
            ),
        )

    return model


def serializar(
    obj,
) -> dict[str, Any]:
    return {
        coluna.name: getattr(
            obj,
            coluna.name,
        )
        for coluna
        in obj.__table__.columns
        if (
            coluna.name
            != "password_hash"
        )
    }


def preparar_dados(
    model,
    dados: dict[str, Any],
) -> dict[str, Any]:
    resultado = {}

    for coluna in (
        model.__table__.columns
    ):
        nome = coluna.name

        if (
            model.__name__
            in {"Produto", "Lote"}
            and nome == "quantidade"
        ):
            continue

        if nome not in dados:
            continue

        valor = dados[nome]

        if valor == "":
            try:
                tipo = (
                    coluna.type.python_type
                )

                if tipo in (
                    date,
                    datetime,
                ):
                    valor = None

            except Exception:
                pass

        if valor is not None:
            try:
                tipo = (
                    coluna.type.python_type
                )

                if (
                    tipo is datetime
                    and isinstance(
                        valor,
                        str,
                    )
                ):
                    valor = (
                        datetime.fromisoformat(
                            valor.replace(
                                "Z",
                                "+00:00",
                            )
                        )
                    )

                elif (
                    tipo is date
                    and isinstance(
                        valor,
                        str,
                    )
                ):
                    valor = (
                        date.fromisoformat(
                            valor[:10]
                        )
                    )

            except (
                ValueError,
                TypeError,
                NotImplementedError,
            ):
                pass

        resultado[nome] = valor

    return resultado


def aplicar_ordenacao(
    stmt,
    model,
    sort: str | None,
):
    if not sort:
        return stmt

    descendente = (
        sort.startswith("-")
    )

    campo = (
        sort[1:]
        if descendente
        else sort
    )

    coluna = getattr(
        model,
        campo,
        None,
    )

    if coluna is None:
        return stmt

    if descendente:
        return stmt.order_by(
            desc(coluna)
        )

    return stmt.order_by(
        asc(coluna)
    )


def aplicar_escopo_mobile(
    stmt,
    model,
    entidade: str,
    current_user: User,
):
    if not (
        acesso_apenas_mobile_entidade(
            current_user,
            entidade,
        )
    ):
        return stmt

    setores = sorted(
        setores_mobile_ids(
            current_user
        )
    )

    if entidade == "Setor":
        return stmt.where(
            Setor.id.in_(setores),
            Setor.tem_aba_mobile.is_(
                True
            ),
        )

    if hasattr(
        model,
        "setor_id",
    ):
        return stmt.where(
            model.setor_id.in_(
                setores
            )
        )

    depositos_permitidos = (
        select(Deposito.id)
        .where(
            Deposito.setor_id.in_(
                setores
            )
        )
    )

    if entidade == "Gaveta":
        return stmt.where(
            Gaveta.deposito_id.in_(
                depositos_permitidos
            )
        )

    if entidade == "Maquina":
        produtos_permitidos = (
            select(Produto.id)
            .where(
                Produto.setor_id.in_(
                    setores
                )
            )
        )

        return stmt.where(
            Maquina.combustivel_id.in_(
                produtos_permitidos
            )
        )

    # Pessoa não possui vínculo de setor.
    # A leitura é mantida porque o fluxo
    # mobile usa fornecedores na entrada.
    return stmt


def _proximo_numero_lavoura(
    db: Session,
) -> str:
    maior = 0

    numeros = db.scalars(
        select(Lavoura.numero)
    ).all()

    for valor in numeros:
        match = re.search(
            r"(\d+)\s*$",
            str(valor or ""),
        )

        if not match:
            continue

        numero = int(match.group(1))

        if numero > maior:
            maior = numero

    return (
        f"LAV-{maior + 1:06d}"
    )


def _validar_duplicidade_lavoura(
    db: Session,
    dados_limpos: dict[str, Any],
    registro_id: str | None = None,
):
    nome = str(
        dados_limpos.get("nome")
        or ""
    ).strip()

    if not nome:
        return

    stmt = select(
        Lavoura
    ).where(
        Lavoura.nome.ilike(nome)
    )

    if registro_id:
        stmt = stmt.where(
            Lavoura.id != registro_id
        )

    if db.scalar(stmt.limit(1)):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Já existe uma lavoura cadastrada "
                f"com o nome '{nome}'."
            ),
        )


def _validar_maquina_sem_deposito(
    dados_limpos: dict[str, Any],
):
    deposito_id = dados_limpos.get("deposito_id")

    if deposito_id not in (None, ""):
        raise HTTPException(
            status_code=400,
            detail=(
                "Máquinas não possuem vínculo com depósito."
            ),
        )

    # O campo permanece temporariamente no modelo/banco por compatibilidade
    # histórica, mas não é aceito como vínculo funcional.
    dados_limpos.pop("deposito_id", None)


def _validar_duplicidade_maquina(
    db: Session,
    dados_limpos: dict[str, Any],
    registro_id: str | None = None,
):
    codigo = str(
        dados_limpos.get("codigo")
        or ""
    ).strip()

    nome = str(
        dados_limpos.get("nome")
        or ""
    ).strip()

    if codigo:
        stmt_codigo = select(
            Maquina
        ).where(
            Maquina.codigo == codigo
        )

        if registro_id:
            stmt_codigo = stmt_codigo.where(
                Maquina.id != registro_id
            )

        if db.scalar(stmt_codigo.limit(1)):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Já existe uma máquina com o código {codigo}."
                ),
            )

    if nome:
        stmt_nome = select(
            Maquina
        ).where(
            Maquina.nome.ilike(nome)
        )

        if registro_id:
            stmt_nome = stmt_nome.where(
                Maquina.id != registro_id
            )

        if db.scalar(stmt_nome.limit(1)):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Já existe uma máquina cadastrada com o nome '{nome}'."
                ),
            )


def _abastecimento_mesmo_conteudo(
    registro: Abastecimento,
    dados_limpos: dict[str, Any],
) -> bool:
    campos_texto = (
        "maquina_id",
        "produto_id",
        "unidade",
        "operador",
        "observacao",
        "foto_url",
    )

    for campo in campos_texto:
        if campo not in dados_limpos:
            continue

        atual = str(
            getattr(
                registro,
                campo,
                None,
            )
            or ""
        ).strip()

        novo = str(
            dados_limpos.get(
                campo
            )
            or ""
        ).strip()

        if atual != novo:
            return False

    if "quantidade" in dados_limpos:
        try:
            atual = float(
                registro.quantidade
                or 0
            )
            novo = float(
                dados_limpos.get(
                    "quantidade"
                )
                or 0
            )
        except (
            TypeError,
            ValueError,
        ):
            return False

        if abs(atual - novo) > 0.000001:
            return False

    return True


def _validar_criacao_abastecimento(
    dados_limpos: dict[str, Any],
    current_user: User,
):
    status_novo = str(
        dados_limpos.get(
            "status",
            "pendente",
        )
        or "pendente"
    ).lower()

    if (
        status_novo
        != "pendente"
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "Abastecimentos novos devem "
                "iniciar como pendentes."
            ),
        )

    foto_url = str(
        dados_limpos.get("foto_url")
        or ""
    ).strip()

    if (
        not foto_url
        and not tem_permissao(
            current_user,
            "operacao.abastecimento.sem_foto",
        )
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Este usuário precisa informar a foto "
                "do painel do abastecedor."
            ),
        )


def _validar_update_abastecimento(
    registro: Abastecimento,
    dados_limpos: dict[str, Any],
    current_user: User,
    db: Session,
):
    status_atual = str(
        registro.status
        or "pendente"
    ).lower()

    status_novo = str(
        dados_limpos.get(
            "status",
            status_atual,
        )
        or status_atual
    ).lower()

    if (
        status_atual
        in {
            "confirmado",
            "cancelado",
        }
    ):
        protegidos = {
            "maquina_id",
            "produto_id",
            "quantidade",
            "unidade",
        }

        if any(
            campo in dados_limpos
            and dados_limpos[campo]
            != getattr(
                registro,
                campo,
            )
            for campo in protegidos
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Abastecimento já processado "
                    "não pode ter produto, máquina "
                    "ou quantidade alterados."
                ),
            )

    if (
        status_novo
        == status_atual
    ):
        return

    if (
        status_atual
        != "pendente"
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "O status deste abastecimento "
                "já foi finalizado."
            ),
        )

    if (
        status_novo
        == "cancelado"
    ):
        return

    if (
        status_novo
        != "confirmado"
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "Transição de status de "
                "abastecimento inválida."
            ),
        )

    exigir_confirmacao_abastecimento(
        current_user
    )

    documento = db.scalar(
        select(
            EstoqueDocumento
        )
        .where(
            EstoqueDocumento.origem_modulo
            == "abastecimento",
            EstoqueDocumento.documento_origem_id
            == registro.id,
            EstoqueDocumento.tipo_movimento
            == "ABASTECIMENTO",
            EstoqueDocumento.status
            == "contabilizado",
        )
        .order_by(
            EstoqueDocumento.data_documento.desc()
        )
        .limit(1)
    )

    if documento is None:
        raise HTTPException(
            status_code=409,
            detail=(
                "A confirmação exige uma "
                "baixa de estoque contabilizada "
                "pelo motor ERP."
            ),
        )

    dados_limpos[
        "numero_mov"
    ] = documento.numero


@router.get("/{entidade}")
def listar(
    entidade: str,
    sort: str | None = Query(
        default=None
    ),
    limit: int | None = Query(
        default=None,
        ge=1,
    ),
    current_user: User = Depends(
        get_current_user
    ),
    db: Session = Depends(get_db),
):
    model = obter_modelo(
        entidade
    )

    exigir_leitura_entidade(
        current_user,
        entidade,
    )

    stmt = select(model)

    stmt = aplicar_escopo_mobile(
        stmt,
        model,
        entidade,
        current_user,
    )

    stmt = aplicar_ordenacao(
        stmt,
        model,
        sort,
    )

    if limit is not None:
        stmt = stmt.limit(
            limit
        )

    registros = db.scalars(
        stmt
    ).all()

    return [
        serializar(registro)
        for registro in registros
    ]


@router.post("/{entidade}/filter")
def filtrar(
    entidade: str,
    filtros: dict[str, Any],
    sort: str | None = Query(
        default=None
    ),
    limit: int | None = Query(
        default=None,
        ge=1,
    ),
    current_user: User = Depends(
        get_current_user
    ),
    db: Session = Depends(get_db),
):
    model = obter_modelo(
        entidade
    )

    exigir_leitura_entidade(
        current_user,
        entidade,
    )

    stmt = select(model)

    for (
        campo,
        valor,
    ) in filtros.items():
        coluna = getattr(
            model,
            campo,
            None,
        )

        if coluna is None:
            continue

        stmt = stmt.where(
            coluna == valor
        )

    stmt = aplicar_escopo_mobile(
        stmt,
        model,
        entidade,
        current_user,
    )

    stmt = aplicar_ordenacao(
        stmt,
        model,
        sort,
    )

    if limit is not None:
        stmt = stmt.limit(
            limit
        )

    registros = db.scalars(
        stmt
    ).all()

    return [
        serializar(registro)
        for registro in registros
    ]


@router.get(
    "/{entidade}/{registro_id}"
)
def obter(
    entidade: str,
    registro_id: str,
    current_user: User = Depends(
        get_current_user
    ),
    db: Session = Depends(get_db),
):
    model = obter_modelo(
        entidade
    )

    exigir_leitura_entidade(
        current_user,
        entidade,
    )

    stmt = select(model).where(
        model.id == registro_id
    )

    stmt = aplicar_escopo_mobile(
        stmt,
        model,
        entidade,
        current_user,
    )

    registro = db.scalar(
        stmt
    )

    if registro is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Registro não encontrado."
            ),
        )

    return serializar(
        registro
    )


@router.post("/{entidade}")
def criar(
    entidade: str,
    dados: dict[str, Any],
    current_user: User = Depends(
        get_current_user
    ),
    db: Session = Depends(get_db),
):
    validar_mutacao(
        entidade
    )

    model = obter_modelo(
        entidade
    )

    exigir_mutacao_entidade(
        current_user,
        entidade,
    )

    dados_limpos = preparar_dados(
        model,
        dados,
    )

    if (
        entidade
        == "Abastecimento"
    ):
        _validar_criacao_abastecimento(
            dados_limpos,
            current_user,
        )

        abastecimento_id = str(
            dados_limpos.get(
                "id"
            )
            or ""
        ).strip()

        if abastecimento_id:
            existente = db.get(
                Abastecimento,
                abastecimento_id,
            )

            if existente is not None:
                if _abastecimento_mesmo_conteudo(
                    existente,
                    dados_limpos,
                ):
                    return serializar(
                        existente
                    )

                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Já existe um abastecimento "
                        "com este identificador e "
                        "dados diferentes."
                    ),
                )

    if entidade == "Maquina":
        _validar_maquina_sem_deposito(
            dados_limpos
        )
        _validar_duplicidade_maquina(
            db,
            dados_limpos,
        )

    if entidade == "Lavoura":
        _validar_duplicidade_lavoura(
            db,
            dados_limpos,
        )
        dados_limpos["numero"] = (
            _proximo_numero_lavoura(db)
        )

    registro = model(
        **dados_limpos
    )

    db.add(registro)
    db.flush()

    registrar_auditoria(
        db,
        usuario=current_user,
        acao="criar",
        entidade=entidade,
        registro_id=registro.id,
        depois=serializar(registro),
    )

    db.commit()
    db.refresh(registro)

    return serializar(
        registro
    )


@router.patch(
    "/{entidade}/{registro_id}"
)
def atualizar(
    entidade: str,
    registro_id: str,
    dados: dict[str, Any],
    current_user: User = Depends(
        get_current_user
    ),
    db: Session = Depends(get_db),
):
    validar_mutacao(
        entidade
    )

    model = obter_modelo(
        entidade
    )

    exigir_mutacao_entidade(
        current_user,
        entidade,
    )

    registro = db.get(
        model,
        registro_id,
    )

    if registro is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Registro não encontrado."
            ),
        )

    dados_limpos = preparar_dados(
        model,
        dados,
    )

    custo_produto_novo = None

    if (
        entidade == "Produto"
        and "custo_unitario"
        in dados_limpos
    ):
        custo_produto_novo = (
            dados_limpos.pop(
                "custo_unitario"
            )
        )

    if (
        entidade
        == "Abastecimento"
    ):
        _validar_update_abastecimento(
            registro,
            dados_limpos,
            current_user,
            db,
        )

    if entidade == "Maquina":
        _validar_maquina_sem_deposito(
            dados_limpos
        )
        _validar_duplicidade_maquina(
            db,
            dados_limpos,
            registro_id=registro_id,
        )

    if entidade == "Lavoura":
        dados_limpos.pop(
            "numero",
            None,
        )
        _validar_duplicidade_lavoura(
            db,
            dados_limpos,
            registro_id=registro_id,
        )

    antes = serializar(
        registro
    )

    for (
        campo,
        valor,
    ) in dados_limpos.items():
        if campo == "id":
            continue

        setattr(
            registro,
            campo,
            valor,
        )

    if custo_produto_novo is not None:
        try:
            reavaliar_custo_produto(
                db,
                produto_id=registro.id,
                novo_custo=custo_produto_novo,
            )
        except EstoqueErro as erro:
            raise HTTPException(
                status_code=400,
                detail=str(erro),
            ) from erro

    db.flush()

    registrar_auditoria(
        db,
        usuario=current_user,
        acao="atualizar",
        entidade=entidade,
        registro_id=registro.id,
        antes=antes,
        depois=serializar(registro),
    )

    db.commit()
    db.refresh(registro)

    return serializar(
        registro
    )


@router.delete(
    "/{entidade}/{registro_id}"
)
def excluir(
    entidade: str,
    registro_id: str,
    current_user: User = Depends(
        get_current_user
    ),
    db: Session = Depends(get_db),
):
    validar_mutacao(
        entidade
    )

    model = obter_modelo(
        entidade
    )

    exigir_mutacao_entidade(
        current_user,
        entidade,
    )

    campos_saldo = {
        "Produto": (
            EstoqueSaldo.produto_id
        ),
        "Deposito": (
            EstoqueSaldo.deposito_id
        ),
        "Gaveta": (
            EstoqueSaldo.gaveta_id
        ),
    }

    campo_saldo = (
        campos_saldo.get(
            entidade
        )
    )

    if (
        campo_saldo
        is not None
    ):
        saldo_vinculado = db.scalar(
            select(
                EstoqueSaldo.id
            )
            .where(
                campo_saldo
                == registro_id
            )
            .limit(1)
        )

        if saldo_vinculado:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Não é possível excluir "
                    "este cadastro porque "
                    "existem posições de "
                    "estoque ERP vinculadas."
                ),
            )

    registro = db.get(
        model,
        registro_id,
    )

    if registro is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Registro não encontrado."
            ),
        )

    antes = serializar(
        registro
    )

    registrar_auditoria(
        db,
        usuario=current_user,
        acao="excluir",
        entidade=entidade,
        registro_id=registro.id,
        antes=antes,
    )

    db.delete(registro)
    db.commit()

    return {
        "success": True
    }


@router.post(
    "/{entidade}/bulk-update"
)
def atualizar_em_lote(
    entidade: str,
    registros: list[
        dict[str, Any]
    ],
    current_user: User = Depends(
        get_current_user
    ),
    db: Session = Depends(get_db),
):
    validar_mutacao(
        entidade
    )

    model = obter_modelo(
        entidade
    )

    exigir_mutacao_entidade(
        current_user,
        entidade,
    )

    atualizados = []
    ids_alterados = []

    for dados in registros:
        registro_id = (
            dados.get("id")
        )

        if not registro_id:
            continue

        registro = db.get(
            model,
            registro_id,
        )

        if registro is None:
            continue

        dados_limpos = preparar_dados(
            model,
            dados,
        )

        if (
            entidade
            == "Abastecimento"
        ):
            _validar_update_abastecimento(
                registro,
                dados_limpos,
                current_user,
                db,
            )

        if entidade == "Maquina":
            _validar_maquina_sem_deposito(
                dados_limpos
            )

        for (
            campo,
            valor,
        ) in dados_limpos.items():
            if campo == "id":
                continue

            setattr(
                registro,
                campo,
                valor,
            )

        atualizados.append(
            registro
        )
        ids_alterados.append(
            registro.id
        )

    if ids_alterados:
        registrar_auditoria(
            db,
            usuario=current_user,
            acao="atualizar_lote",
            entidade=entidade,
            detalhe=(
                f"{len(ids_alterados)} "
                "registro(s) atualizado(s)."
            ),
            depois={
                "ids": ids_alterados,
            },
        )

    db.commit()

    for registro in atualizados:
        db.refresh(
            registro
        )

    return [
        serializar(registro)
        for registro
        in atualizados
    ]
