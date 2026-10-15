from __future__ import annotations

import json
from collections.abc import Iterable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Produto, User


VALID_PAGE_KEYS = frozenset({
    "dashboard",
    "movimentacoes",
    "abastecimento",
    "pesagem",
    "aplicacao",
    "cadastros",
    "relatorios",
    "inventario",
})

PAGE_PERMISSION_KEYS = {
    pagina: f"page.{pagina}"
    for pagina in VALID_PAGE_KEYS
}

LEGACY_FLAG_PERMISSIONS = {
    "pode_confirmar_abastecimento": "operacao.abastecimento.confirmar",
    "pode_digitar_peso": "operacao.pesagem.digitar_peso",
    "pode_baixar_mobile": "mobile.estoque.baixar",
    "pode_mudar_gaveta_mobile": "mobile.estoque.mudar_gaveta",
    "pode_mudar_deposito_mobile": "mobile.estoque.mudar_deposito",
    "pode_entrada_manual_saldo_mobile": "mobile.estoque.entrada_manual_saldo",
}

PERMISSION_CATALOG = (
    {"key": "page.dashboard", "group": "areas", "label": "Pesquisa", "description": "Acessar a Pesquisa de Estoque."},
    {"key": "page.movimentacoes", "group": "areas", "label": "Movimentos", "description": "Acessar movimentações de estoque."},
    {"key": "page.abastecimento", "group": "areas", "label": "Abastecimento", "description": "Acessar o módulo de abastecimento."},
    {"key": "page.pesagem", "group": "areas", "label": "Pesagem", "description": "Acessar o módulo de pesagem."},
    {"key": "page.aplicacao", "group": "areas", "label": "Aplicação", "description": "Acessar ordens de aplicação."},
    {"key": "page.cadastros", "group": "areas", "label": "Cadastros", "description": "Acessar cadastros do sistema."},
    {"key": "page.relatorios", "group": "areas", "label": "Relatórios", "description": "Acessar relatórios."},
    {"key": "page.inventario", "group": "areas", "label": "Inventário", "description": "Acessar inventários."},

    {"key": "operacao.abastecimento.confirmar", "group": "operacao", "label": "Confirmar abastecimentos", "description": "Conferir e confirmar a baixa de abastecimentos."},
    {"key": "operacao.abastecimento.sem_foto", "group": "operacao", "label": "Abastecimento sem foto obrigatória", "description": "Permite registrar abastecimento sem tirar a foto do painel do abastecedor."},
    {"key": "operacao.pesagem.digitar_peso", "group": "operacao", "label": "Digitar peso manualmente", "description": "Informar peso manual nos tickets de pesagem."},

    {"key": "mobile.estoque.baixar", "group": "mobile", "label": "Dar baixa pelo celular", "description": "Realizar saída real do saldo pelo mobile."},
    {"key": "mobile.estoque.mudar_gaveta", "group": "mobile", "label": "Mudar gaveta pelo celular", "description": "Transferir saldo entre gavetas."},
    {"key": "mobile.estoque.mudar_deposito", "group": "mobile", "label": "Mudar depósito pelo celular", "description": "Transferir saldo para outro depósito."},
    {"key": "mobile.estoque.entrada_manual_saldo", "group": "mobile", "label": "Solicitar entrada manual de saldo", "description": "Enviar solicitação mobile para revisão administrativa."},

    {"key": "admin.usuarios.visualizar", "group": "administracao", "label": "Visualizar usuários", "description": "Abrir a lista de usuários."},
    {"key": "admin.usuarios.criar", "group": "administracao", "label": "Criar usuários", "description": "Criar usuários padrão. Apenas o Administrador Total cria outros administradores."},
    {"key": "admin.usuarios.editar", "group": "administracao", "label": "Editar usuários", "description": "Editar nome, senha e status de usuários padrão."},
    {"key": "admin.usuarios.excluir", "group": "administracao", "label": "Excluir usuários", "description": "Excluir usuários padrão."},
    {"key": "admin.balanca.acessar", "group": "administracao", "label": "Acessar Balança", "description": "Abrir a área administrativa da balança."},
    {"key": "admin.cadastros_mobile.solicitar", "group": "administracao", "label": "Modo Admin no celular", "description": "Criar solicitações de cadastros pelo modo administrativo mobile."},
    {"key": "admin.cadastros_mobile.revisar", "group": "administracao", "label": "Revisar cadastros mobile", "description": "Aprovar ou rejeitar cadastros enviados pelo celular."},
    {"key": "admin.entrada_saldo_mobile.revisar", "group": "administracao", "label": "Revisar entradas de saldo mobile", "description": "Aprovar ou rejeitar solicitações de entrada de saldo."},
    {"key": "admin.inventario.revisar", "group": "administracao", "label": "Revisar itens encontrados", "description": "Aprovar ou rejeitar itens encontrados no inventário."},
    {"key": "admin.estoque.entrada_manual", "group": "administracao", "label": "Entrada manual de saldo no PC", "description": "Registrar entrada administrativa de saldo pelo módulo Movimentos."},
    {"key": "admin.relatorios.usuarios", "group": "administracao", "label": "Relatório de usuários", "description": "Visualizar o relatório administrativo de usuários e permissões."},
    {"key": "admin.integridade.visualizar", "group": "administracao", "label": "Ver integridade do sistema", "description": "Consultar o painel de integridade do ERP."},
    {"key": "admin.integridade.verificar", "group": "administracao", "label": "Executar verificação de integridade", "description": "Rodar verificação manual de consistência."},
    {"key": "admin.auditoria.visualizar", "group": "administracao", "label": "Ver auditoria", "description": "Consultar o histórico de auditoria do ERP."},
    {"key": "admin.backups.visualizar", "group": "administracao", "label": "Ver backups", "description": "Consultar backups existentes."},
    {"key": "admin.backups.criar", "group": "administracao", "label": "Criar backup", "description": "Criar backup manual do ERP."},
    {"key": "admin.backups.verificar", "group": "administracao", "label": "Verificar backup", "description": "Validar um arquivo de backup."},
)

VALID_PERMISSION_KEYS = frozenset(item["key"] for item in PERMISSION_CATALOG)
ADMIN_PERMISSION_KEYS = frozenset(
    key
    for key in VALID_PERMISSION_KEYS
    if key.startswith("admin.")
)
SCOPE_PERMISSION_KEYS = frozenset({"mobile.setor"})


ENTITY_READ_PAGES = {
    "Abastecimento": {"abastecimento", "relatorios"},
    "AnoSafra": {"cadastros", "aplicacao", "relatorios"},
    "Cultura": {"cadastros", "aplicacao", "relatorios"},
    "Deposito": {"dashboard", "movimentacoes", "abastecimento", "aplicacao", "cadastros", "inventario", "relatorios"},
    "Gaveta": {"dashboard", "movimentacoes", "cadastros", "inventario", "relatorios"},
    "Inventario": {"inventario", "relatorios"},
    "InventarioForaEstoque": {"inventario", "relatorios"},
    "InventarioItem": {"inventario", "relatorios"},
    "Lavoura": {"cadastros", "aplicacao", "relatorios"},
    "Lote": {"dashboard", "movimentacoes", "abastecimento", "aplicacao", "cadastros", "inventario", "relatorios"},
    "Maquina": {"dashboard", "movimentacoes", "abastecimento", "cadastros", "inventario", "relatorios"},
    "OrdemServicoAplicacao": {"aplicacao", "relatorios"},
    "Pagamento": {"pesagem", "relatorios"},
    "PedidoPesagem": {"pesagem", "relatorios"},
    "Pessoa": {"movimentacoes", "pesagem", "cadastros", "relatorios"},
    "Produto": {"dashboard", "movimentacoes", "abastecimento", "pesagem", "aplicacao", "cadastros", "inventario", "relatorios"},
    "Setor": {"dashboard", "movimentacoes", "abastecimento", "aplicacao", "cadastros", "inventario", "relatorios"},
    "TicketPesagem": {"pesagem", "relatorios"},
    "Veiculo": {"pesagem", "cadastros", "relatorios"},
}

ENTITY_WRITE_PAGES = {
    "Abastecimento": {"abastecimento"},
    "AnoSafra": {"cadastros"},
    "Cultura": {"cadastros"},
    "Deposito": {"cadastros"},
    "Gaveta": {"cadastros"},
    "Inventario": {"inventario"},
    "InventarioForaEstoque": {"inventario"},
    "InventarioItem": {"inventario"},
    "Lavoura": {"cadastros"},
    "Lote": set(),
    "Maquina": {"cadastros"},
    "OrdemServicoAplicacao": {"aplicacao"},
    "Pagamento": {"pesagem"},
    "PedidoPesagem": {"pesagem"},
    "Pessoa": {"cadastros"},
    "Produto": {"cadastros"},
    "Setor": {"cadastros"},
    "TicketPesagem": {"pesagem"},
    "Veiculo": {"cadastros"},
}

MOBILE_SECTOR_READ_ENTITIES = frozenset({
    "Deposito", "Gaveta", "Lote", "Maquina", "Pessoa", "Produto", "Setor",
})

STOCK_READ_PAGES = frozenset({
    "dashboard", "movimentacoes", "abastecimento", "pesagem",
    "aplicacao", "cadastros", "inventario", "relatorios",
})

ORIGIN_PAGE = {
    "abastecimento": "abastecimento",
    "aplicacao": "aplicacao",
    "inventario": "inventario",
    "pesagem": "pesagem",
    "movimentacoes": "movimentacoes",
    "nfe_manual": "movimentacoes",
    "manual": "movimentacoes",
}


def _json_list(valor):
    if valor is None:
        return None
    if isinstance(valor, list):
        return [str(item) for item in valor]
    try:
        parsed = json.loads(valor)
    except Exception:
        return []
    return [str(item) for item in parsed] if isinstance(parsed, list) else []


def _records(user: User):
    try:
        return list(user.permission_records or [])
    except Exception:
        return []


def _legacy_permissions(user: User) -> set[str]:
    permissoes: set[str] = set()
    paginas = _json_list(user.paginas_permitidas)

    if paginas is None:
        paginas = list(VALID_PAGE_KEYS)

    for pagina in paginas:
        if pagina in VALID_PAGE_KEYS:
            permissoes.add(PAGE_PERMISSION_KEYS[pagina])

    for campo, key in LEGACY_FLAG_PERMISSIONS.items():
        if getattr(user, campo, False) is True:
            permissoes.add(key)

    return permissoes


def permissoes_usuario(user: User) -> set[str]:
    if user.role == "admin":
        return {"*"}

    registros = _records(user)
    if registros:
        return {
            str(item.permission_key)
            for item in registros
            if not str(item.scope_value or "").strip()
            and str(item.permission_key) in VALID_PERMISSION_KEYS
        }

    return _legacy_permissions(user)


def permissoes_publicas(user: User) -> list[str]:
    if user.role == "admin":
        return ["*"]
    return sorted(permissoes_usuario(user))


def escopos_permissao(user: User, permission_key: str) -> set[str] | None:
    if user.role == "admin":
        return None

    registros = _records(user)
    if registros:
        return {
            str(item.scope_value)
            for item in registros
            if str(item.permission_key) == permission_key
            and str(item.scope_value or "").strip()
        }

    if permission_key == "mobile.setor":
        return {
            item
            for item in (_json_list(user.setores_permitidos) or [])
            if item
        }

    return set()


def tem_permissao(user: User, permission_key: str) -> bool:
    if user.role == "admin":
        return True
    return permission_key in permissoes_usuario(user)


def exigir_permissao(user: User, permission_key: str):
    if tem_permissao(user, permission_key):
        return
    raise HTTPException(
        status_code=403,
        detail="Usuário sem permissão para executar esta operação.",
    )


def paginas_usuario(user: User) -> set[str] | None:
    if user.role == "admin":
        return None

    permitidas = permissoes_usuario(user)
    return {
        pagina
        for pagina, permission_key in PAGE_PERMISSION_KEYS.items()
        if permission_key in permitidas
    }


def paginas_publicas(valor):
    paginas = _json_list(valor)
    if paginas is None:
        return None
    return [pagina for pagina in paginas if pagina in VALID_PAGE_KEYS]


def setores_mobile_ids(user: User) -> set[str]:
    escopos = escopos_permissao(user, "mobile.setor")
    if escopos is None:
        return set()
    return set(escopos)


def tem_pagina(user: User, pagina: str) -> bool:
    if user.role == "admin":
        return True
    return tem_permissao(user, PAGE_PERMISSION_KEYS.get(pagina, f"page.{pagina}"))


def tem_alguma_pagina(user: User, paginas: Iterable[str]) -> bool:
    if user.role == "admin":
        return True
    return any(tem_pagina(user, pagina) for pagina in paginas)


def exigir_pagina(user: User, pagina: str):
    if tem_pagina(user, pagina):
        return
    raise HTTPException(
        status_code=403,
        detail=f"Usuário sem permissão para acessar o módulo '{pagina}'.",
    )


def exigir_alguma_pagina(user: User, paginas: Iterable[str]):
    if tem_alguma_pagina(user, paginas):
        return
    raise HTTPException(
        status_code=403,
        detail="Usuário sem permissão para executar esta operação.",
    )


def exigir_confirmacao_abastecimento(user: User):
    exigir_pagina(user, "abastecimento")
    exigir_permissao(user, "operacao.abastecimento.confirmar")


def exigir_leitura_entidade(user: User, entidade: str):
    paginas = ENTITY_READ_PAGES.get(entidade, set())
    if tem_alguma_pagina(user, paginas):
        return
    if entidade in MOBILE_SECTOR_READ_ENTITIES and setores_mobile_ids(user):
        return
    raise HTTPException(
        status_code=403,
        detail=f"Usuário sem permissão para consultar '{entidade}'.",
    )


def exigir_mutacao_entidade(user: User, entidade: str):
    paginas = ENTITY_WRITE_PAGES.get(entidade, set())
    if paginas and tem_alguma_pagina(user, paginas):
        return
    raise HTTPException(
        status_code=403,
        detail=f"Usuário sem permissão para alterar '{entidade}'.",
    )


def acesso_apenas_mobile_entidade(user: User, entidade: str) -> bool:
    if user.role == "admin":
        return False
    paginas = ENTITY_READ_PAGES.get(entidade, set())
    return (
        not tem_alguma_pagina(user, paginas)
        and entidade in MOBILE_SECTOR_READ_ENTITIES
        and bool(setores_mobile_ids(user))
    )


def exigir_leitura_estoque(user: User):
    if tem_alguma_pagina(user, STOCK_READ_PAGES):
        return
    if setores_mobile_ids(user):
        return
    raise HTTPException(status_code=403, detail="Usuário sem permissão para consultar o estoque.")


def acesso_estoque_apenas_mobile(user: User) -> bool:
    if user.role == "admin":
        return False
    return (
        not tem_alguma_pagina(user, STOCK_READ_PAGES)
        and bool(setores_mobile_ids(user))
    )


def produtos_em_setores_mobile(
    user: User,
    produto_ids: Iterable[str],
    db: Session,
) -> bool:
    ids = {str(produto_id) for produto_id in produto_ids if produto_id}
    if not ids:
        return False

    setores = setores_mobile_ids(user)
    if not setores:
        return False

    registros = db.execute(
        select(Produto.id, Produto.setor_id).where(Produto.id.in_(ids))
    ).all()

    if len(registros) != len(ids):
        return False

    return all(setor_id in setores for _, setor_id in registros)


def pagina_da_origem(origem_modulo: str | None) -> str:
    origem = str(origem_modulo or "").strip().lower()
    return ORIGIN_PAGE.get(origem, "movimentacoes")


def exigir_origem_operacional(user: User, origem_modulo: str | None):
    pagina = pagina_da_origem(origem_modulo)
    if pagina == "abastecimento":
        exigir_confirmacao_abastecimento(user)
        return
    exigir_pagina(user, pagina)


def exigir_acao_estoque_mobile(user: User, acao: str):
    mapa = {
        "baixar": "mobile.estoque.baixar",
        "mudar_gaveta": "mobile.estoque.mudar_gaveta",
        "mudar_deposito": "mobile.estoque.mudar_deposito",
    }
    key = mapa.get(acao)
    if key and tem_permissao(user, key):
        return

    nomes = {
        "baixar": "dar baixa",
        "mudar_gaveta": "mudar gaveta",
        "mudar_deposito": "mudar depósito",
    }
    raise HTTPException(
        status_code=403,
        detail=f"Usuário sem permissão para {nomes.get(acao, 'executar esta ação')} pelo celular.",
    )
