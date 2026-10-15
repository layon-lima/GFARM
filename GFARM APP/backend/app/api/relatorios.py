from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.core.access_control import (
    exigir_pagina,
    setores_mobile_ids,
    tem_permissao,
)
from app.db.database import get_db
from app.models import (
    Abastecimento,
    AnoSafra,
    Cultura,
    Deposito,
    EstoqueDocumento,
    EstoqueDocumentoItem,
    EstoqueSaldo,
    Gaveta,
    Inventario,
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
from app.models.reservas import EstoqueReserva, EstoqueReservaEvento
from app.services.regras_movimento import (
    MOVIMENTOS_ENTRADA,
    MOVIMENTOS_SAIDA,
    MOVIMENTOS_TRANSFERENCIA,
    REGRAS_MOVIMENTO,
)


router = APIRouter(
    prefix="/api/relatorios",
    tags=["Relatórios"],
)


class ExecutarRelatorioRequest(BaseModel):
    busca: str | None = None
    data_de: date | None = None
    data_ate: date | None = None
    filtros: dict[str, Any] = Field(default_factory=dict)
    limite: int = Field(default=50000, ge=1, le=50000)
    mobile_view: bool = False


def _num(valor: Any) -> float:
    if valor is None:
        return 0.0
    try:
        return float(valor)
    except (TypeError, ValueError):
        return 0.0


def _lista_json(valor: Any) -> list[str] | None:
    if valor is None:
        return None
    if isinstance(valor, list):
        return [str(v) for v in valor]
    try:
        parsed = json.loads(valor)
        if isinstance(parsed, list):
            return [str(v) for v in parsed]
    except Exception:
        pass
    return []




def _ensure_reports_access(user: User) -> None:
    exigir_pagina(user, "relatorios")

def _texto_local(nome: str | None, fallback: str = "—") -> str:
    texto = str(nome or "").strip()
    return texto or fallback


def _deposito_label(dep: Deposito | None) -> str:
    if dep is None:
        return "—"
    numero = str(dep.numero or "").strip()
    nome = str(dep.nome or "").strip()
    if numero and nome:
        return f"{numero} — {nome}"
    return numero or nome or "—"


def _pessoa_papeis(p: Pessoa) -> str:
    papeis = []
    if p.is_cliente:
        papeis.append("Cliente")
    if p.is_fornecedor:
        papeis.append("Fornecedor")
    if p.is_transportadora:
        papeis.append("Transportadora")
    if p.is_motorista:
        papeis.append("Motorista")
    return ", ".join(papeis) or "—"


def _parse_itens(valor: Any) -> list[dict[str, Any]]:
    if not valor:
        return []
    if isinstance(valor, list):
        return [x for x in valor if isinstance(x, dict)]
    if isinstance(valor, str):
        try:
            parsed = json.loads(valor)
            if isinstance(parsed, list):
                return [x for x in parsed if isinstance(x, dict)]
        except Exception:
            return []
    return []


def _col(key: str, label: str, tipo: str = "text", align: str | None = None):
    return {
        "key": key,
        "label": label,
        "type": tipo,
        "align": align or ("right" if tipo in {"number", "currency"} else "left"),
    }


def _filtro(key: str, label: str, option_key: str):
    return {
        "key": key,
        "label": label,
        "option_key": option_key,
    }


REPORTS: dict[str, dict[str, Any]] = {
    "estoque_posicao": {
        "code": "REL-EST-01",
        "title": "Posição de estoque",
        "description": "Saldo físico, reservado, disponível, custo e valor por posição oficial do estoque.",
        "category": "Estoque",
        "icon": "Warehouse",
        "columns": [
            _col("produto_codigo", "Código"),
            _col("produto_nome", "Produto"),
            _col("setor", "Setor"),
            _col("deposito", "Depósito"),
            _col("gaveta", "Gaveta"),
            _col("lote", "Lote"),
            _col("tipo_estoque", "Tipo de estoque"),
            _col("quantidade", "Físico", "number"),
            _col("reservado", "Reservado", "number"),
            _col("disponivel", "Disponível", "number"),
            _col("unidade", "Unidade"),
            _col("custo_medio", "Custo médio", "currency"),
            _col("valor_total", "Valor total", "currency"),
        ],
        "filters": [
            _filtro("produto_id", "Produto", "produtos"),
            _filtro("setor_id", "Setor", "setores"),
            _filtro("deposito_id", "Depósito", "depositos"),
            _filtro("gaveta_id", "Gaveta", "gavetas"),
            _filtro("tipo_estoque", "Tipo de estoque", "tipos_estoque"),
        ],
        "sector_key": "setor_id",
    },
    "estoque_resumo_produto": {
        "code": "REL-EST-02",
        "title": "Resumo de estoque por produto",
        "description": "Consolidação das posições oficiais por produto, incluindo reservas e valoração.",
        "category": "Estoque",
        "icon": "Boxes",
        "columns": [
            _col("produto_codigo", "Código"),
            _col("produto_nome", "Produto"),
            _col("setor", "Setor"),
            _col("quantidade", "Físico", "number"),
            _col("reservado", "Reservado", "number"),
            _col("disponivel", "Disponível", "number"),
            _col("unidade", "Unidade"),
            _col("estoque_minimo", "Estoque mínimo", "number"),
            _col("custo_medio", "Custo médio", "currency"),
            _col("valor_total", "Valor total", "currency"),
        ],
        "filters": [
            _filtro("produto_id", "Produto", "produtos"),
            _filtro("setor_id", "Setor", "setores"),
        ],
        "sector_key": "setor_id",
    },
    "estoque_critico": {
        "code": "REL-EST-03",
        "title": "Estoque crítico e zerado",
        "description": "Produtos com disponibilidade menor ou igual ao estoque mínimo cadastrado.",
        "category": "Estoque",
        "icon": "TriangleAlert",
        "columns": [
            _col("produto_codigo", "Código"),
            _col("produto_nome", "Produto"),
            _col("setor", "Setor"),
            _col("disponivel", "Disponível", "number"),
            _col("estoque_minimo", "Estoque mínimo", "number"),
            _col("diferenca", "Diferença", "number"),
            _col("unidade", "Unidade"),
            _col("status", "Status"),
        ],
        "filters": [
            _filtro("setor_id", "Setor", "setores"),
            _filtro("status", "Status", "status_critico"),
        ],
        "sector_key": "setor_id",
    },
    "lotes_validade": {
        "code": "REL-EST-04",
        "title": "Lotes e validade",
        "description": "Lotes cadastrados, quantidades, localização e datas de validade.",
        "category": "Estoque",
        "icon": "CalendarClock",
        "period_label": "Validade",
        "date_key": "data_validade",
        "columns": [
            _col("produto_codigo", "Código"),
            _col("produto_nome", "Produto"),
            _col("codigo_lote", "Lote"),
            _col("data_validade", "Validade", "date"),
            _col("quantidade", "Quantidade", "number"),
            _col("unidade", "Unidade"),
            _col("setor", "Setor"),
            _col("deposito", "Depósito"),
            _col("gaveta", "Gaveta"),
        ],
        "filters": [
            _filtro("produto_id", "Produto", "produtos"),
            _filtro("setor_id", "Setor", "setores"),
            _filtro("deposito_id", "Depósito", "depositos"),
            _filtro("gaveta_id", "Gaveta", "gavetas"),
        ],
        "sector_key": "setor_id",
    },
    "documentos_estoque": {
        "code": "REL-MOV-01",
        "title": "Documentos de estoque",
        "description": "Livro de documentos contabilizados, estornados e suas referências de origem.",
        "category": "Movimentações",
        "icon": "Files",
        "date_key": "data_documento",
        "columns": [
            _col("numero", "Documento"),
            _col("data_documento", "Data/Hora", "datetime"),
            _col("tipo_movimento", "Tipo de movimento"),
            _col("status", "Status"),
            _col("origem_modulo", "Módulo de origem"),
            _col("referencia_externa", "Referência externa"),
            _col("usuario", "Usuário"),
            _col("qtd_itens", "Itens", "number"),
            _col("valor_total", "Valor total", "currency"),
            _col("observacao", "Observação"),
            _col("motivo_estorno", "Motivo do estorno"),
        ],
        "filters": [
            _filtro("tipo_movimento", "Tipo de movimento", "tipos_movimento"),
            _filtro("status", "Status", "status_documento"),
            _filtro("origem_modulo", "Módulo de origem", "origens_modulo"),
        ],
        "sector_key": "setores_ids",
    },
    "movimentos_estoque": {
        "code": "REL-MOV-02",
        "title": "Livro de movimentos de estoque",
        "description": "Visão detalhada por item dos documentos oficiais do motor de estoque.",
        "category": "Movimentações",
        "icon": "ArrowLeftRight",
        "date_key": "data_documento",
        "columns": [
            _col("documento", "Documento"),
            _col("data_documento", "Data/Hora", "datetime"),
            _col("tipo_movimento", "Tipo de movimento"),
            _col("direcao", "Direção"),
            _col("origem_modulo", "Módulo"),
            _col("referencia_externa", "Referência"),
            _col("produto_codigo", "Código"),
            _col("produto_nome", "Produto"),
            _col("quantidade", "Quantidade", "number"),
            _col("unidade", "Unidade"),
            _col("deposito_origem", "Depósito origem"),
            _col("gaveta_origem", "Gaveta origem"),
            _col("lote_origem", "Lote origem"),
            _col("deposito_destino", "Depósito destino"),
            _col("gaveta_destino", "Gaveta destino"),
            _col("lote_destino", "Lote destino"),
            _col("custo_unitario", "Custo unitário", "currency"),
            _col("valor_total", "Valor total", "currency"),
            _col("usuario", "Usuário"),
            _col("observacao", "Observação"),
        ],
        "filters": [
            _filtro("tipo_movimento", "Tipo de movimento", "tipos_movimento"),
            _filtro("origem_modulo", "Módulo de origem", "origens_modulo"),
            _filtro("produto_id", "Produto", "produtos"),
            _filtro("deposito_id", "Depósito", "depositos"),
        ],
        "sector_key": "setores_ids",
    },
    "entradas_estoque": {
        "code": "REL-MOV-03",
        "title": "Entradas de estoque",
        "description": "Entradas fiscais, devoluções e ajustes positivos contabilizados.",
        "category": "Movimentações",
        "icon": "ArrowDownToLine",
        "date_key": "data_documento",
        "base": "movimentos_estoque",
        "mov_group": "entrada",
    },
    "saidas_estoque": {
        "code": "REL-MOV-04",
        "title": "Saídas de estoque",
        "description": "Consumos, devoluções de saída, ajustes, abastecimentos e aplicações.",
        "category": "Movimentações",
        "icon": "ArrowUpFromLine",
        "date_key": "data_documento",
        "base": "movimentos_estoque",
        "mov_group": "saida",
    },
    "transferencias_estoque": {
        "code": "REL-MOV-05",
        "title": "Transferências de estoque",
        "description": "Transferências contabilizadas entre depósitos, gavetas e lotes.",
        "category": "Movimentações",
        "icon": "Repeat2",
        "date_key": "data_documento",
        "base": "movimentos_estoque",
        "mov_group": "transferencia",
    },
    "estornos_estoque": {
        "code": "REL-MOV-06",
        "title": "Estornos de estoque",
        "description": "Documentos de estorno e rastreabilidade do documento original.",
        "category": "Movimentações",
        "icon": "Undo2",
        "date_key": "data_documento",
        "base": "movimentos_estoque",
        "mov_group": "estorno",
    },
    "reservas_estoque": {
        "code": "REL-MOV-07",
        "title": "Reservas de estoque",
        "description": "Reservas ativas, consumidas e canceladas com saldo remanescente.",
        "category": "Movimentações",
        "icon": "LockKeyhole",
        "date_key": "created_at",
        "columns": [
            _col("created_at", "Criada em", "datetime"),
            _col("produto_codigo", "Código"),
            _col("produto_nome", "Produto"),
            _col("deposito", "Depósito"),
            _col("gaveta", "Gaveta"),
            _col("lote", "Lote"),
            _col("quantidade", "Reservada", "number"),
            _col("consumida", "Consumida", "number"),
            _col("restante", "Restante", "number"),
            _col("status", "Status"),
            _col("origem_modulo", "Origem"),
            _col("referencia", "Referência"),
            _col("usuario", "Usuário"),
            _col("observacao", "Observação"),
        ],
        "filters": [
            _filtro("produto_id", "Produto", "produtos"),
            _filtro("deposito_id", "Depósito", "depositos"),
            _filtro("status", "Status", "status_reserva"),
        ],
        "sector_key": "setor_id",
    },
    "eventos_reserva": {
        "code": "REL-MOV-08",
        "title": "Auditoria de reservas",
        "description": "Livro imutável de reserva, consumo e cancelamento das reservas de estoque.",
        "category": "Movimentações",
        "icon": "ListChecks",
        "date_key": "created_at",
        "columns": [
            _col("created_at", "Data/Hora", "datetime"),
            _col("tipo", "Evento"),
            _col("produto_codigo", "Código"),
            _col("produto_nome", "Produto"),
            _col("quantidade", "Quantidade", "number"),
            _col("status_reserva", "Status da reserva"),
            _col("referencia", "Referência"),
            _col("documento_estoque", "Documento de estoque"),
            _col("usuario", "Usuário"),
            _col("motivo", "Motivo"),
        ],
        "filters": [
            _filtro("tipo", "Evento", "tipos_evento_reserva"),
            _filtro("produto_id", "Produto", "produtos"),
        ],
        "sector_key": "setor_id",
    },
    "abastecimentos": {
        "code": "REL-OPE-01",
        "title": "Abastecimentos",
        "description": "Histórico de abastecimentos, confirmações, máquinas e produtos consumidos.",
        "category": "Operações",
        "icon": "Fuel",
        "date_key": "data",
        "columns": [
            _col("data", "Data/Hora", "datetime"),
            _col("maquina", "Máquina"),
            _col("produto_codigo", "Código"),
            _col("produto_nome", "Produto"),
            _col("quantidade", "Quantidade", "number"),
            _col("unidade", "Unidade"),
            _col("operador", "Operador"),
            _col("status", "Status"),
            _col("confirmado_por", "Confirmado por"),
            _col("data_confirmacao", "Confirmação", "datetime"),
            _col("numero_mov", "Movimento"),
            _col("observacao", "Observação"),
        ],
        "filters": [
            _filtro("maquina_id", "Máquina", "maquinas"),
            _filtro("produto_id", "Produto", "produtos"),
            _filtro("status", "Status", "status_abastecimento"),
        ],
        "sector_key": "setor_id",
    },
    "aplicacoes": {
        "code": "REL-OPE-02",
        "title": "Ordens de aplicação",
        "description": "Ordens de serviço agrícolas por safra, cultura, lavoura, status e custo.",
        "category": "Operações",
        "icon": "Sprout",
        "date_key": "data",
        "columns": [
            _col("numero", "Nº OS"),
            _col("data", "Data", "datetime"),
            _col("data_execucao", "Execução", "datetime"),
            _col("safra", "Safra"),
            _col("cultura", "Cultura"),
            _col("lavoura", "Lavoura"),
            _col("hectares", "Hectares", "number"),
            _col("status", "Status"),
            _col("responsavel", "Responsável"),
            _col("custo_total", "Custo total", "currency"),
            _col("observacao", "Observação"),
        ],
        "filters": [
            _filtro("safra", "Ano / Safra", "safras"),
            _filtro("cultura_id", "Cultura", "culturas"),
            _filtro("lavoura_id", "Lavoura", "lavouras"),
            _filtro("status", "Status", "status_aplicacao"),
        ],
    },
    "aplicacao_itens": {
        "code": "REL-OPE-03",
        "title": "Itens de aplicação",
        "description": "Consumo previsto e realizado por item das ordens de aplicação agrícola.",
        "category": "Operações",
        "icon": "FlaskConical",
        "date_key": "data",
        "columns": [
            _col("numero", "Nº OS"),
            _col("data", "Data", "datetime"),
            _col("safra", "Safra"),
            _col("cultura", "Cultura"),
            _col("lavoura", "Lavoura"),
            _col("hectares", "Hectares", "number"),
            _col("status", "Status"),
            _col("produto_codigo", "Código"),
            _col("produto_nome", "Produto"),
            _col("unidade", "Unidade"),
            _col("dose_ha", "Dose/ha", "number"),
            _col("previsto", "Previsto", "number"),
            _col("realizado", "Realizado", "number"),
            _col("custo_unitario", "Custo unitário", "currency"),
            _col("custo_total", "Custo total", "currency"),
        ],
        "filters": [
            _filtro("safra", "Ano / Safra", "safras"),
            _filtro("cultura_id", "Cultura", "culturas"),
            _filtro("lavoura_id", "Lavoura", "lavouras"),
            _filtro("produto_id", "Produto", "produtos"),
            _filtro("status", "Status", "status_aplicacao"),
        ],
    },
    "inventarios": {
        "code": "REL-OPE-04",
        "title": "Inventários",
        "description": "Inventários realizados, resultados, acertos, divergências e responsáveis.",
        "category": "Operações",
        "icon": "ClipboardCheck",
        "date_key": "data",
        "columns": [
            _col("numero", "Inventário"),
            _col("data", "Abertura", "datetime"),
            _col("data_fechamento", "Fechamento", "datetime"),
            _col("setor", "Setor"),
            _col("status", "Status"),
            _col("resultado", "Resultado"),
            _col("total_itens", "Itens", "number"),
            _col("total_acertos", "Acertos", "number"),
            _col("total_divergencias", "Divergências", "number"),
            _col("responsavel", "Responsável"),
            _col("criterios", "Critérios"),
            _col("observacao", "Observação"),
        ],
        "filters": [
            _filtro("setor_id", "Setor", "setores"),
            _filtro("status", "Status", "status_inventario"),
        ],
        "sector_key": "setor_id",
    },
    "inventario_itens": {
        "code": "REL-OPE-05",
        "title": "Divergências de inventário",
        "description": "Comparação item a item entre quantidade do sistema e quantidade contada.",
        "category": "Operações",
        "icon": "ClipboardList",
        "date_key": "data",
        "columns": [
            _col("inventario", "Inventário"),
            _col("data", "Data", "datetime"),
            _col("setor", "Setor"),
            _col("codigo", "Código"),
            _col("produto", "Produto"),
            _col("qtd_sistema", "Sistema", "number"),
            _col("qtd_contada", "Contado", "number"),
            _col("diferenca", "Diferença", "number"),
            _col("unidade", "Unidade"),
            _col("responsavel", "Responsável"),
        ],
        "filters": [
            _filtro("setor_id", "Setor", "setores"),
            _filtro("produto_id", "Produto", "produtos"),
        ],
        "sector_key": "setor_id",
    },
    "pedidos_pesagem": {
        "code": "REL-PES-01",
        "title": "Pedidos de pesagem",
        "description": "Pedidos comerciais, limites, saldos, sacas e valores vinculados à pesagem.",
        "category": "Pesagem",
        "icon": "ScrollText",
        "columns": [
            _col("numero", "Pedido"),
            _col("cliente", "Cliente"),
            _col("produto_codigo", "Código"),
            _col("produto_nome", "Produto"),
            _col("transportadoras", "Transportadoras"),
            _col("sem_limite", "Sem limite", "boolean"),
            _col("peso_saca_kg", "Peso/saca (kg)", "number"),
            _col("qtd_sacas", "Sacas", "number"),
            _col("total_kg", "Total (kg)", "number"),
            _col("saldo_kg", "Saldo (kg)", "number"),
            _col("valor_saca", "Valor/saca", "currency"),
            _col("valor_total", "Valor total", "currency"),
            _col("status", "Status"),
            _col("observacao", "Observação"),
        ],
        "filters": [
            _filtro("cliente_id", "Cliente", "clientes"),
            _filtro("produto_id", "Produto", "produtos"),
            _filtro("status", "Status", "status_pedido"),
        ],
    },
    "tickets_pesagem": {
        "code": "REL-PES-02",
        "title": "Tickets de pesagem",
        "description": "Tickets de venda e avulsos com pesos, veículos, clientes, transportadoras e NF-e.",
        "category": "Pesagem",
        "icon": "Scale",
        "date_key": "data_abertura",
        "columns": [
            _col("numero", "Ticket"),
            _col("tipo", "Tipo"),
            _col("status", "Status"),
            _col("data_abertura", "Abertura", "datetime"),
            _col("data_fechamento", "Fechamento", "datetime"),
            _col("produto_codigo", "Código"),
            _col("produto_nome", "Produto"),
            _col("cliente", "Cliente"),
            _col("transportadora", "Transportadora"),
            _col("motorista", "Motorista"),
            _col("placa", "Placa"),
            _col("origem", "Origem"),
            _col("destino", "Destino"),
            _col("peso_tara", "Tara", "number"),
            _col("peso_bruto", "Bruto", "number"),
            _col("peso_liquido", "Líquido", "number"),
            _col("pedido", "Pedido"),
            _col("observacao", "Observação"),
        ],
        "filters": [
            _filtro("tipo", "Tipo", "tipos_ticket"),
            _filtro("status", "Status", "status_ticket"),
            _filtro("produto_id", "Produto", "produtos"),
            _filtro("cliente_id", "Cliente", "clientes"),
            _filtro("transportadora_id", "Transportadora", "transportadoras"),
        ],
    },
    "pagamentos": {
        "code": "REL-PES-03",
        "title": "Pagamentos de pedidos",
        "description": "Pagamentos registrados nos pedidos de pesagem, forma de pagamento e valores.",
        "category": "Pesagem",
        "icon": "BadgeDollarSign",
        "date_key": "data_pagamento",
        "columns": [
            _col("numero", "Pagamento"),
            _col("data_pagamento", "Data", "datetime"),
            _col("pedido", "Pedido"),
            _col("cliente", "Cliente"),
            _col("valor", "Valor", "currency"),
            _col("forma_pagamento", "Forma"),
            _col("observacao", "Observação"),
        ],
        "filters": [
            _filtro("cliente_id", "Cliente", "clientes"),
            _filtro("forma_pagamento", "Forma de pagamento", "formas_pagamento"),
        ],
    },
    "nfe_pesagem": {
        "code": "REL-PES-04",
        "title": "Controle de NF-e por ticket",
        "description": "Tickets de venda com indicação de NF-e e dados capturados automaticamente do XML.",
        "category": "Pesagem",
        "icon": "FileCheck2",
        "date_key": "data_abertura",
        "columns": [
            _col("numero", "Ticket"),
            _col("nfe_importada", "Tem NF-e", "boolean"),
            _col("nfe_numero", "Nº NF-e"),
            _col("cliente", "Cliente"),
            _col("produto", "Produto"),
            _col("quantidade", "Quantidade", "number"),
            _col("nfe_valor", "Valor NF-e", "currency"),
            _col("nfe_chave", "Chave NF-e"),
        ],
        "filters": [
            _filtro("nfe_importada", "NF-e", "status_nfe_ticket"),
            _filtro("cliente_id", "Cliente", "clientes"),
            _filtro("produto_id", "Produto", "produtos"),
        ],
    },
    "produtos": {
        "code": "REL-CAD-01",
        "title": "Cadastro de produtos",
        "description": "Cadastro mestre de produtos com localização padrão, unidades, custos e estoque mínimo.",
        "category": "Cadastros",
        "icon": "Package",
        "columns": [
            _col("codigo", "Código"),
            _col("codigo_referencia", "Referência"),
            _col("nome", "Produto"),
            _col("setor", "Setor"),
            _col("deposito", "Depósito padrão"),
            _col("maquina", "Máquina"),
            _col("gaveta", "Gaveta"),
            _col("unidade", "Unidade"),
            _col("unidade_alt", "Unidade alternativa"),
            _col("fator_conversao", "Fator conversão", "number"),
            _col("estoque_minimo", "Estoque mínimo", "number"),
            _col("custo_unitario", "Custo unitário", "currency"),
            _col("venda", "Produto de venda", "boolean"),
        ],
        "filters": [
            _filtro("setor_id", "Setor", "setores"),
            _filtro("deposito_id", "Depósito", "depositos"),
            _filtro("maquina_id", "Máquina", "maquinas"),
        ],
        "sector_key": "setor_id",
    },
    "pessoas": {
        "code": "REL-CAD-02",
        "title": "Cadastro de pessoas",
        "description": "Clientes, fornecedores, transportadoras e motoristas em um cadastro único.",
        "category": "Cadastros",
        "icon": "ContactRound",
        "columns": [
            _col("nome", "Nome"),
            _col("documento", "CPF/CNPJ"),
            _col("ie", "IE"),
            _col("telefone", "Telefone"),
            _col("cidade", "Cidade"),
            _col("uf", "UF"),
            _col("papeis", "Papéis"),
            _col("cnh", "CNH"),
            _col("cnh_validade", "Validade CNH", "date"),
            _col("observacao", "Observação"),
        ],
        "filters": [],
    },
    "clientes": {
        "code": "REL-CAD-03",
        "title": "Clientes",
        "description": "Pessoas classificadas como clientes no cadastro mestre.",
        "category": "Cadastros",
        "icon": "UserRoundCheck",
        "base": "pessoas",
        "pessoa_role": "cliente",
    },
    "fornecedores": {
        "code": "REL-CAD-04",
        "title": "Fornecedores",
        "description": "Pessoas classificadas como fornecedores no cadastro mestre.",
        "category": "Cadastros",
        "icon": "Truck",
        "base": "pessoas",
        "pessoa_role": "fornecedor",
    },
    "transportadoras": {
        "code": "REL-CAD-05",
        "title": "Transportadoras",
        "description": "Pessoas classificadas como transportadoras no cadastro mestre.",
        "category": "Cadastros",
        "icon": "Container",
        "base": "pessoas",
        "pessoa_role": "transportadora",
    },
    "motoristas": {
        "code": "REL-CAD-06",
        "title": "Motoristas",
        "description": "Pessoas classificadas como motoristas, incluindo CNH e validade.",
        "category": "Cadastros",
        "icon": "IdCard",
        "base": "pessoas",
        "pessoa_role": "motorista",
    },
    "veiculos": {
        "code": "REL-CAD-07",
        "title": "Veículos",
        "description": "Frota cadastrada, capacidade, transportadora e motorista vinculados.",
        "category": "Cadastros",
        "icon": "Car",
        "columns": [
            _col("placa", "Placa"),
            _col("modelo", "Modelo"),
            _col("cor", "Cor"),
            _col("ano", "Ano"),
            _col("tara", "Tara", "number"),
            _col("capacidade_kg", "Capacidade (kg)", "number"),
            _col("transportadora", "Transportadora"),
            _col("motorista", "Motorista"),
            _col("observacao", "Observação"),
        ],
        "filters": [
            _filtro("transportadora_id", "Transportadora", "transportadoras"),
            _filtro("motorista_id", "Motorista", "motoristas"),
        ],
    },
    "maquinas": {
        "code": "REL-CAD-08",
        "title": "Máquinas",
        "description": "Máquinas e equipamentos com depósito e combustível associados.",
        "category": "Cadastros",
        "icon": "Tractor",
        "columns": [
            _col("codigo", "Código"),
            _col("nome", "Máquina"),
            _col("deposito", "Depósito"),
            _col("permite_abastecimento", "Permite abastecimento", "boolean"),
            _col("combustivel", "Combustível"),
            _col("descricao", "Descrição"),
        ],
        "filters": [
            _filtro("deposito_id", "Depósito", "depositos"),
        ],
        "sector_key": "setor_id",
    },
    "setores": {
        "code": "REL-CAD-09",
        "title": "Setores",
        "description": "Estrutura organizacional do estoque e regras operacionais dos setores.",
        "category": "Cadastros",
        "icon": "Network",
        "columns": [
            _col("nome", "Setor"),
            _col("descricao", "Descrição"),
            _col("controla_validade", "Controla validade", "boolean"),
            _col("permite_inventario", "Permite inventário", "boolean"),
            _col("tem_aba_mobile", "Aba mobile", "boolean"),
        ],
        "filters": [],
        "sector_key": "setor_id",
    },
    "depositos": {
        "code": "REL-CAD-10",
        "title": "Depósitos",
        "description": "Depósitos cadastrados e respectivos setores.",
        "category": "Cadastros",
        "icon": "Warehouse",
        "columns": [
            _col("numero", "Número"),
            _col("nome", "Depósito"),
            _col("setor", "Setor"),
            _col("descricao", "Descrição"),
        ],
        "filters": [
            _filtro("setor_id", "Setor", "setores"),
        ],
        "sector_key": "setor_id",
    },
    "gavetas": {
        "code": "REL-CAD-11",
        "title": "Gavetas",
        "description": "Endereços físicos internos dos depósitos.",
        "category": "Cadastros",
        "icon": "MapPinHouse",
        "columns": [
            _col("codigo", "Gaveta"),
            _col("deposito", "Depósito"),
            _col("setor", "Setor"),
            _col("descricao", "Descrição"),
        ],
        "filters": [
            _filtro("setor_id", "Setor", "setores"),
            _filtro("deposito_id", "Depósito", "depositos"),
        ],
        "sector_key": "setor_id",
    },
    "lavouras": {
        "code": "REL-CAD-12",
        "title": "Lavouras",
        "description": "Áreas agrícolas cadastradas com número e hectares.",
        "category": "Cadastros",
        "icon": "LandPlot",
        "columns": [
            _col("numero", "Número"),
            _col("nome", "Lavoura"),
            _col("hectares", "Hectares", "number"),
        ],
        "filters": [],
    },
    "culturas": {
        "code": "REL-CAD-13",
        "title": "Culturas",
        "description": "Culturas cadastradas para uso nas aplicações agrícolas.",
        "category": "Cadastros",
        "icon": "Wheat",
        "columns": [
            _col("nome", "Cultura"),
        ],
        "filters": [],
    },
    "anos_safra": {
        "code": "REL-CAD-14",
        "title": "Ano / Safra",
        "description": "Períodos agrícolas cadastrados no ERP.",
        "category": "Cadastros",
        "icon": "CalendarRange",
        "columns": [
            _col("nome", "Ano / Safra"),
        ],
        "filters": [],
    },
    "usuarios": {
        "code": "REL-ADM-01",
        "title": "Usuários e permissões",
        "description": "Usuários do sistema, status e permissões operacionais. Disponível apenas para administradores.",
        "category": "Administração",
        "icon": "ShieldCheck",
        "admin_only": True,
        "columns": [
            _col("username", "Usuário"),
            _col("display_name", "Nome"),
            _col("role", "Perfil"),
            _col("ativo", "Ativo", "boolean"),
            _col("pode_confirmar_abastecimento", "Confirma abastecimento", "boolean"),
            _col("pode_digitar_peso", "Digita peso", "boolean"),
            _col("paginas", "Páginas permitidas"),
            _col("setores", "Setores permitidos"),
            _col("created_date", "Criado em", "datetime"),
        ],
        "filters": [
            _filtro("role", "Perfil", "roles_usuario"),
            _filtro("ativo", "Status", "status_usuario"),
        ],
    },
}


# Relatórios derivados reaproveitam colunas e filtros do relatório-base.
for _key in ("entradas_estoque", "saidas_estoque", "transferencias_estoque", "estornos_estoque"):
    REPORTS[_key]["columns"] = REPORTS["movimentos_estoque"]["columns"]
    REPORTS[_key]["filters"] = [
        f for f in REPORTS["movimentos_estoque"]["filters"]
        if f["key"] != "tipo_movimento"
    ]
    REPORTS[_key]["sector_key"] = "setores_ids"

for _key in ("clientes", "fornecedores", "transportadoras", "motoristas"):
    REPORTS[_key]["columns"] = REPORTS["pessoas"]["columns"]
    REPORTS[_key]["filters"] = []


CATEGORY_ORDER = {
    "Estoque": 10,
    "Movimentações": 20,
    "Operações": 30,
    "Pesagem": 40,
    "Cadastros": 50,
    "Administração": 60,
}


def _contexto(db: Session) -> dict[str, Any]:
    produtos = db.scalars(select(Produto)).all()
    setores = db.scalars(select(Setor)).all()
    depositos = db.scalars(select(Deposito)).all()
    gavetas = db.scalars(select(Gaveta)).all()
    maquinas = db.scalars(select(Maquina)).all()
    lotes = db.scalars(select(Lote)).all()
    pessoas = db.scalars(select(Pessoa)).all()
    usuarios = db.scalars(select(User)).all()
    lavouras = db.scalars(select(Lavoura)).all()
    culturas = db.scalars(select(Cultura)).all()
    pedidos = db.scalars(select(PedidoPesagem)).all()
    documentos = db.scalars(select(EstoqueDocumento)).all()

    return {
        "produtos": {x.id: x for x in produtos},
        "setores": {x.id: x for x in setores},
        "depositos": {x.id: x for x in depositos},
        "gavetas": {x.id: x for x in gavetas},
        "maquinas": {x.id: x for x in maquinas},
        "lotes": {x.id: x for x in lotes},
        "pessoas": {x.id: x for x in pessoas},
        "usuarios": {x.id: x for x in usuarios},
        "lavouras": {x.id: x for x in lavouras},
        "culturas": {x.id: x for x in culturas},
        "pedidos": {x.id: x for x in pedidos},
        "documentos": {x.id: x for x in documentos},
    }


def _user_label(user: User | None) -> str:
    if user is None:
        return "—"
    return _texto_local(user.display_name or user.username)


def _direcao(tipo: str) -> str:
    tipo = (tipo or "").upper()
    if tipo in MOVIMENTOS_ENTRADA:
        return "Entrada"
    if tipo in MOVIMENTOS_SAIDA:
        return "Saída"
    if tipo in MOVIMENTOS_TRANSFERENCIA:
        return "Transferência"
    if tipo == "ESTORNO":
        return "Estorno"
    return tipo or "—"


def _movimento_rows(db: Session, ctx: dict[str, Any]) -> list[dict[str, Any]]:
    documentos = db.scalars(
        select(EstoqueDocumento).order_by(EstoqueDocumento.data_documento.desc())
    ).all()
    itens = db.scalars(
        select(EstoqueDocumentoItem).order_by(
            EstoqueDocumentoItem.documento_id,
            EstoqueDocumentoItem.item_numero,
        )
    ).all()

    itens_por_doc: dict[str, list[EstoqueDocumentoItem]] = defaultdict(list)
    for item in itens:
        itens_por_doc[item.documento_id].append(item)

    rows: list[dict[str, Any]] = []
    produtos = ctx["produtos"]
    depositos = ctx["depositos"]
    gavetas = ctx["gavetas"]
    lotes = ctx["lotes"]
    usuarios = ctx["usuarios"]

    for doc in documentos:
        for item in itens_por_doc.get(doc.id, []):
            prod = produtos.get(item.produto_id)
            dep_o = depositos.get(item.deposito_origem_id or "")
            dep_d = depositos.get(item.deposito_destino_id or "")
            gav_o = gavetas.get(item.gaveta_origem_id or "")
            gav_d = gavetas.get(item.gaveta_destino_id or "")
            lote_o = lotes.get(item.lote_origem_id or "")
            lote_d = lotes.get(item.lote_destino_id or "")
            setores_ids = []
            if dep_o and dep_o.setor_id:
                setores_ids.append(dep_o.setor_id)
            if dep_d and dep_d.setor_id:
                setores_ids.append(dep_d.setor_id)

            rows.append({
                "documento": doc.numero,
                "data_documento": doc.data_documento,
                "tipo_movimento": doc.tipo_movimento,
                "direcao": _direcao(doc.tipo_movimento),
                "origem_modulo": doc.origem_modulo,
                "referencia_externa": doc.referencia_externa or "",
                "produto_codigo": prod.codigo if prod else "",
                "produto_nome": prod.nome if prod else "—",
                "quantidade": _num(item.quantidade),
                "unidade": item.unidade or (prod.unidade if prod else ""),
                "deposito_origem": _deposito_label(dep_o),
                "gaveta_origem": _texto_local(gav_o.codigo if gav_o else None),
                "lote_origem": _texto_local(lote_o.codigo_lote if lote_o else None),
                "deposito_destino": _deposito_label(dep_d),
                "gaveta_destino": _texto_local(gav_d.codigo if gav_d else None),
                "lote_destino": _texto_local(lote_d.codigo_lote if lote_d else None),
                "custo_unitario": _num(item.custo_unitario),
                "valor_total": _num(item.valor_total),
                "usuario": _user_label(usuarios.get(doc.usuario_id)),
                "observacao": item.observacao or doc.observacao or "",
                "produto_id": item.produto_id,
                "deposito_id": [
                    x for x in [item.deposito_origem_id, item.deposito_destino_id] if x
                ],
                "setores_ids": list(dict.fromkeys(setores_ids)),
                "status_documento": doc.status,
                "estorno_de_id": doc.estorno_de_id,
            })

    return rows


def _resumo_financeiro_pedido(
    pedido: PedidoPesagem,
    tickets: list[TicketPesagem],
    pagamentos: list[Pagamento],
) -> dict[str, Any]:
    carregado_kg = sum(
        _num(ticket.peso_liquido)
        for ticket in tickets
        if ticket.status == "fechado"
    )

    peso_saca = _num(pedido.peso_saca_kg)
    valor_saca = _num(pedido.valor_saca)
    valor_carregado = (
        (carregado_kg / peso_saca) * valor_saca
        if peso_saca > 0 and valor_saca > 0
        else 0.0
    )

    valor_contratado = _num(pedido.valor_total)
    valor_pedido = (
        valor_carregado
        if bool(pedido.sem_limite)
        else (
            valor_contratado
            if valor_contratado > 0
            else valor_carregado
        )
    )

    valor_pago = sum(_num(pag.valor) for pag in pagamentos)
    saldo_receber = max(0.0, valor_pedido - valor_pago)
    credito = max(0.0, valor_pago - valor_pedido)

    if pedido.status == "cancelado":
        status_financeiro = "Cancelado"
    elif valor_pedido > 0 and saldo_receber <= 0.005:
        status_financeiro = "Pago"
    elif valor_pago > 0:
        status_financeiro = "Parcial"
    else:
        status_financeiro = "Pendente"

    return {
        "carregado_kg": carregado_kg,
        "valor_pedido": valor_pedido,
        "valor_pago": valor_pago,
        "saldo_receber": saldo_receber,
        "credito": credito,
        "status_financeiro": status_financeiro,
    }


def _pagamentos_resumo_mobile_rows(
    db: Session,
    ctx: dict[str, Any],
) -> list[dict[str, Any]]:
    pedidos = ctx["pedidos"]
    pessoas = ctx["pessoas"]
    produtos = ctx["produtos"]

    tickets_por_pedido: dict[str, list[TicketPesagem]] = defaultdict(list)
    for ticket in db.scalars(
        select(TicketPesagem).order_by(TicketPesagem.data_abertura.desc())
    ).all():
        if ticket.pedido_id:
            tickets_por_pedido[ticket.pedido_id].append(ticket)

    pagamentos_por_pedido: dict[str, list[Pagamento]] = defaultdict(list)
    for pagamento in db.scalars(
        select(Pagamento).order_by(Pagamento.data_pagamento.desc())
    ).all():
        pagamentos_por_pedido[pagamento.pedido_id].append(pagamento)

    rows = []

    for pedido in sorted(
        pedidos.values(),
        key=lambda item: str(
            item.created_date or item.updated_date or ""
        ),
        reverse=True,
    ):
        cliente = pessoas.get(pedido.cliente_id)
        produto = produtos.get(pedido.produto_id)
        pagtos = pagamentos_por_pedido.get(pedido.id, [])
        resumo = _resumo_financeiro_pedido(
            pedido,
            tickets_por_pedido.get(pedido.id, []),
            pagtos,
        )

        ultimo_pagamento = (
            max(
                (pag.data_pagamento for pag in pagtos if pag.data_pagamento),
                default=None,
            )
        )

        rows.append({
            "pedido": pedido.numero or pedido.id,
            "pedido_id": pedido.id,
            "cliente": _texto_local(cliente.nome if cliente else None),
            "cliente_id": pedido.cliente_id or "",
            "produto": _texto_local(produto.nome if produto else None),
            "produto_id": pedido.produto_id or "",
            "sem_limite": bool(pedido.sem_limite),
            "carregado_kg": resumo["carregado_kg"],
            "valor_pedido": resumo["valor_pedido"],
            "valor_pago": resumo["valor_pago"],
            "saldo_receber": resumo["saldo_receber"],
            "credito": resumo["credito"],
            "status_financeiro": resumo["status_financeiro"],
            "data_pedido": pedido.created_date or pedido.updated_date,
            "ultimo_pagamento": ultimo_pagamento,
        })

    return rows


MOBILE_PAGAMENTOS_META = {
    "columns": [
        _col("pedido", "Pedido"),
        _col("cliente", "Cliente"),
        _col("produto", "Produto"),
        _col("valor_pedido", "Valor do pedido", "currency"),
        _col("valor_pago", "Pago", "currency"),
        _col("saldo_receber", "Falta receber", "currency"),
        _col("status_financeiro", "Status"),
        _col("carregado_kg", "Carregado", "number"),
        _col("sem_limite", "Sem limite", "boolean"),
    ],
    "filters": [
        _filtro("cliente_id", "Cliente", "clientes"),
    ],
}


def _build_rows(codigo: str, db: Session, current_user: User) -> list[dict[str, Any]]:
    ctx = _contexto(db)
    produtos = ctx["produtos"]
    setores = ctx["setores"]
    depositos = ctx["depositos"]
    gavetas = ctx["gavetas"]
    maquinas = ctx["maquinas"]
    lotes = ctx["lotes"]
    pessoas = ctx["pessoas"]
    usuarios = ctx["usuarios"]
    pedidos = ctx["pedidos"]

    if codigo in {"movimentos_estoque", "entradas_estoque", "saidas_estoque", "transferencias_estoque", "estornos_estoque"}:
        rows = _movimento_rows(db, ctx)
        grupo = REPORTS[codigo].get("mov_group")
        if grupo == "entrada":
            rows = [r for r in rows if r["tipo_movimento"] in MOVIMENTOS_ENTRADA]
        elif grupo == "saida":
            rows = [r for r in rows if r["tipo_movimento"] in MOVIMENTOS_SAIDA]
        elif grupo == "transferencia":
            rows = [r for r in rows if r["tipo_movimento"] in MOVIMENTOS_TRANSFERENCIA]
        elif grupo == "estorno":
            rows = [r for r in rows if r["tipo_movimento"] == "ESTORNO"]
        return rows

    if codigo == "estoque_posicao":
        rows = []
        for saldo in db.scalars(select(EstoqueSaldo)).all():
            prod = produtos.get(saldo.produto_id)
            dep = depositos.get(saldo.deposito_id)
            gav = gavetas.get(saldo.gaveta_id or "")
            lote = lotes.get(saldo.lote_id or "")
            setor = setores.get(dep.setor_id) if dep and dep.setor_id else None
            rows.append({
                "produto_codigo": prod.codigo if prod else "",
                "produto_nome": prod.nome if prod else "—",
                "setor": _texto_local(setor.nome if setor else None),
                "deposito": _deposito_label(dep),
                "gaveta": _texto_local(gav.codigo if gav else None),
                "lote": _texto_local(lote.codigo_lote if lote else None),
                "tipo_estoque": saldo.tipo_estoque,
                "quantidade": _num(saldo.quantidade),
                "reservado": _num(saldo.quantidade_reservada),
                "disponivel": _num(saldo.quantidade) - _num(saldo.quantidade_reservada),
                "unidade": prod.unidade if prod else "",
                "custo_medio": _num(saldo.custo_medio),
                "valor_total": _num(saldo.valor_total),
                "produto_id": saldo.produto_id,
                "setor_id": dep.setor_id if dep else "",
                "deposito_id": saldo.deposito_id,
                "gaveta_id": saldo.gaveta_id or "",
            })
        return rows

    if codigo in {"estoque_resumo_produto", "estoque_critico"}:
        agrupado: dict[str, dict[str, float]] = defaultdict(lambda: {
            "quantidade": 0.0,
            "reservado": 0.0,
            "valor_total": 0.0,
        })
        for saldo in db.scalars(select(EstoqueSaldo)).all():
            g = agrupado[saldo.produto_id]
            g["quantidade"] += _num(saldo.quantidade)
            g["reservado"] += _num(saldo.quantidade_reservada)
            g["valor_total"] += _num(saldo.valor_total)

        rows = []
        for prod in produtos.values():
            g = agrupado.get(prod.id, {"quantidade": 0.0, "reservado": 0.0, "valor_total": 0.0})
            qtd = g["quantidade"]
            reservado = g["reservado"]
            disponivel = qtd - reservado
            minimo = _num(prod.estoque_minimo)
            setor = setores.get(prod.setor_id)
            custo_medio = g["valor_total"] / qtd if qtd else _num(prod.custo_unitario)
            row = {
                "produto_codigo": prod.codigo,
                "produto_nome": prod.nome,
                "setor": _texto_local(setor.nome if setor else None),
                "quantidade": qtd,
                "reservado": reservado,
                "disponivel": disponivel,
                "unidade": prod.unidade or "",
                "estoque_minimo": minimo,
                "custo_medio": custo_medio,
                "valor_total": g["valor_total"],
                "produto_id": prod.id,
                "setor_id": prod.setor_id,
            }
            if codigo == "estoque_critico":
                if disponivel > minimo:
                    continue
                row = {
                    "produto_codigo": prod.codigo,
                    "produto_nome": prod.nome,
                    "setor": _texto_local(setor.nome if setor else None),
                    "disponivel": disponivel,
                    "estoque_minimo": minimo,
                    "diferenca": disponivel - minimo,
                    "unidade": prod.unidade or "",
                    "status": "Zerado" if disponivel <= 0 else "Crítico",
                    "produto_id": prod.id,
                    "setor_id": prod.setor_id,
                }
            rows.append(row)
        return rows

    if codigo == "lotes_validade":
        rows = []
        saldos_lote = db.scalars(
            select(EstoqueSaldo).where(EstoqueSaldo.lote_id != "")
        ).all()
        for saldo in saldos_lote:
            lote = lotes.get(saldo.lote_id or "")
            if lote is None:
                continue
            prod = produtos.get(saldo.produto_id)
            dep = depositos.get(saldo.deposito_id)
            gav = gavetas.get(saldo.gaveta_id or "")
            setor = setores.get(dep.setor_id) if dep and dep.setor_id else setores.get(lote.setor_id or "")
            rows.append({
                "produto_codigo": prod.codigo if prod else "",
                "produto_nome": prod.nome if prod else "—",
                "codigo_lote": lote.codigo_lote,
                "data_validade": lote.data_validade,
                "quantidade": _num(saldo.quantidade),
                "unidade": prod.unidade if prod else (lote.unidade or ""),
                "setor": _texto_local(setor.nome if setor else None),
                "deposito": _deposito_label(dep),
                "gaveta": _texto_local(gav.codigo if gav else None),
                "produto_id": saldo.produto_id,
                "setor_id": dep.setor_id if dep else (lote.setor_id or ""),
                "deposito_id": saldo.deposito_id,
                "gaveta_id": saldo.gaveta_id or "",
            })
        return rows

    if codigo == "documentos_estoque":
        itens = db.scalars(select(EstoqueDocumentoItem)).all()
        stats: dict[str, dict[str, Any]] = defaultdict(
            lambda: {"qtd": 0, "valor": 0.0, "setores": set()}
        )
        for item in itens:
            stats[item.documento_id]["qtd"] += 1
            stats[item.documento_id]["valor"] += _num(item.valor_total)
            for dep_id in (item.deposito_origem_id, item.deposito_destino_id):
                dep = depositos.get(dep_id or "")
                if dep and dep.setor_id:
                    stats[item.documento_id]["setores"].add(dep.setor_id)
        rows = []
        for doc in db.scalars(select(EstoqueDocumento).order_by(EstoqueDocumento.data_documento.desc())).all():
            st = stats.get(doc.id, {"qtd": 0, "valor": 0.0, "setores": set()})
            rows.append({
                "numero": doc.numero,
                "data_documento": doc.data_documento,
                "tipo_movimento": doc.tipo_movimento,
                "status": doc.status,
                "origem_modulo": doc.origem_modulo,
                "referencia_externa": doc.referencia_externa or "",
                "usuario": _user_label(usuarios.get(doc.usuario_id)),
                "qtd_itens": st["qtd"],
                "valor_total": st["valor"],
                "observacao": doc.observacao or "",
                "motivo_estorno": doc.motivo_estorno or "",
                "setores_ids": list(st["setores"]),
            })
        return rows

    if codigo == "reservas_estoque":
        rows = []
        for reserva in db.scalars(select(EstoqueReserva).order_by(EstoqueReserva.created_at.desc())).all():
            prod = produtos.get(reserva.produto_id)
            dep = depositos.get(reserva.deposito_id)
            gav = gavetas.get(reserva.gaveta_id or "")
            lote = lotes.get(reserva.lote_id or "")
            rows.append({
                "created_at": reserva.created_at,
                "produto_codigo": prod.codigo if prod else "",
                "produto_nome": prod.nome if prod else "—",
                "deposito": _deposito_label(dep),
                "gaveta": _texto_local(gav.codigo if gav else None),
                "lote": _texto_local(lote.codigo_lote if lote else None),
                "quantidade": _num(reserva.quantidade),
                "consumida": _num(reserva.quantidade_consumida),
                "restante": _num(reserva.quantidade) - _num(reserva.quantidade_consumida),
                "status": reserva.status,
                "origem_modulo": reserva.origem_modulo,
                "referencia": reserva.referencia or "",
                "usuario": _user_label(usuarios.get(reserva.usuario_id)),
                "observacao": reserva.observacao or "",
                "produto_id": reserva.produto_id,
                "deposito_id": reserva.deposito_id,
                "setor_id": dep.setor_id if dep else "",
            })
        return rows

    if codigo == "eventos_reserva":
        reservas = {x.id: x for x in db.scalars(select(EstoqueReserva)).all()}
        rows = []
        for evento in db.scalars(select(EstoqueReservaEvento).order_by(EstoqueReservaEvento.created_at.desc())).all():
            reserva = reservas.get(evento.reserva_id)
            prod = produtos.get(reserva.produto_id) if reserva else None
            dep = depositos.get(reserva.deposito_id) if reserva else None
            doc = ctx["documentos"].get(evento.documento_estoque_id or "")
            rows.append({
                "created_at": evento.created_at,
                "tipo": evento.tipo,
                "produto_codigo": prod.codigo if prod else "",
                "produto_nome": prod.nome if prod else "—",
                "quantidade": _num(evento.quantidade),
                "status_reserva": reserva.status if reserva else "—",
                "referencia": reserva.referencia if reserva else "",
                "documento_estoque": doc.numero if doc else "",
                "usuario": _user_label(usuarios.get(evento.usuario_id)),
                "motivo": evento.motivo or "",
                "produto_id": reserva.produto_id if reserva else "",
                "setor_id": dep.setor_id if dep else "",
            })
        return rows

    if codigo == "abastecimentos":
        rows = []
        for ab in db.scalars(select(Abastecimento).order_by(Abastecimento.data.desc())).all():
            maq = maquinas.get(ab.maquina_id)
            prod = produtos.get(ab.produto_id)
            dep = depositos.get(maq.deposito_id or "") if maq else None
            rows.append({
                "data": ab.data,
                "maquina": f"{maq.codigo} — {maq.nome}" if maq else "—",
                "produto_codigo": prod.codigo if prod else "",
                "produto_nome": prod.nome if prod else "—",
                "quantidade": _num(ab.quantidade),
                "unidade": ab.unidade or (prod.unidade if prod else ""),
                "operador": ab.operador or "",
                "status": ab.status or "",
                "confirmado_por": ab.confirmado_por or "",
                "data_confirmacao": ab.data_confirmacao,
                "numero_mov": ab.numero_mov or "",
                "observacao": ab.observacao or "",
                "maquina_id": ab.maquina_id,
                "produto_id": ab.produto_id,
                "setor_id": dep.setor_id if dep else (prod.setor_id if prod else ""),
            })
        return rows

    if codigo == "aplicacoes":
        rows = []
        for os in db.scalars(select(OrdemServicoAplicacao).order_by(OrdemServicoAplicacao.data.desc())).all():
            rows.append({
                "numero": os.numero,
                "data": os.data,
                "data_execucao": os.data_execucao,
                "safra": os.ano_safra or "",
                "cultura": os.cultura_nome or _texto_local(ctx["culturas"].get(os.cultura_id).nome if ctx["culturas"].get(os.cultura_id) else None),
                "lavoura": os.lavoura_nome or _texto_local(ctx["lavouras"].get(os.lavoura_id).nome if ctx["lavouras"].get(os.lavoura_id) else None),
                "hectares": _num(os.hectares),
                "status": os.status,
                "responsavel": os.responsavel or "",
                "custo_total": _num(os.custo_total),
                "observacao": os.observacao or "",
                "cultura_id": os.cultura_id or "",
                "lavoura_id": os.lavoura_id,
            })
        return rows

    if codigo == "aplicacao_itens":
        rows = []
        for os in db.scalars(select(OrdemServicoAplicacao).order_by(OrdemServicoAplicacao.data.desc())).all():
            for item in _parse_itens(os.itens):
                produto_id = str(item.get("produto_id") or "")
                prod = produtos.get(produto_id)
                rows.append({
                    "numero": os.numero,
                    "data": os.data,
                    "safra": os.ano_safra or "",
                    "cultura": os.cultura_nome or "",
                    "lavoura": os.lavoura_nome or "",
                    "hectares": _num(os.hectares),
                    "status": os.status,
                    "produto_codigo": item.get("codigo") or (prod.codigo if prod else ""),
                    "produto_nome": item.get("nome") or (prod.nome if prod else "—"),
                    "unidade": item.get("unidade") or (prod.unidade if prod else ""),
                    "dose_ha": _num(item.get("dose_por_hect")),
                    "previsto": _num(item.get("previsto")),
                    "realizado": _num(item.get("realizado")),
                    "custo_unitario": _num(item.get("custo_unitario")),
                    "custo_total": _num(item.get("custo_total")),
                    "cultura_id": os.cultura_id or "",
                    "lavoura_id": os.lavoura_id,
                    "produto_id": produto_id,
                })
        return rows

    if codigo == "inventarios":
        rows = []
        for inv in db.scalars(select(Inventario).order_by(Inventario.data.desc())).all():
            setor = setores.get(inv.setor_id)
            rows.append({
                "numero": inv.numero or "",
                "data": inv.data,
                "data_fechamento": inv.data_fechamento,
                "setor": inv.setor_nome or _texto_local(setor.nome if setor else None),
                "status": inv.status or "",
                "resultado": inv.resultado or "",
                "total_itens": _num(inv.total_itens),
                "total_acertos": _num(inv.total_acertos),
                "total_divergencias": _num(inv.total_divergencias),
                "responsavel": inv.responsavel or "",
                "criterios": inv.criterios_descricao or inv.criterios or "",
                "observacao": inv.observacao or "",
                "setor_id": inv.setor_id,
            })
        return rows

    if codigo == "inventario_itens":
        inventarios = {x.id: x for x in db.scalars(select(Inventario)).all()}
        rows = []
        for item in db.scalars(select(InventarioItem).order_by(InventarioItem.data.desc())).all():
            inv = inventarios.get(item.inventario_id)
            setor = setores.get(inv.setor_id) if inv else None
            rows.append({
                "inventario": inv.numero if inv else item.inventario_id,
                "data": item.data or (inv.data if inv else None),
                "setor": inv.setor_nome if inv and inv.setor_nome else _texto_local(setor.nome if setor else None),
                "codigo": item.codigo or (produtos.get(item.produto_id).codigo if produtos.get(item.produto_id) else ""),
                "produto": item.nome or (produtos.get(item.produto_id).nome if produtos.get(item.produto_id) else "—"),
                "qtd_sistema": _num(item.qtd_sistema),
                "qtd_contada": _num(item.qtd_contada),
                "diferenca": _num(item.qtd_contada) - _num(item.qtd_sistema),
                "unidade": item.unidade or "",
                "responsavel": item.responsavel or "",
                "setor_id": inv.setor_id if inv else "",
                "produto_id": item.produto_id,
            })
        return rows

    if codigo == "pedidos_pesagem":
        rows = []
        for ped in pedidos.values():
            cliente = pessoas.get(ped.cliente_id)
            prod = produtos.get(ped.produto_id)
            rows.append({
                "numero": ped.numero or "",
                "cliente": _texto_local(cliente.nome if cliente else None),
                "produto_codigo": prod.codigo if prod else "",
                "produto_nome": prod.nome if prod else "—",
                "transportadoras": ped.transportadora_nomes or "",
                "sem_limite": bool(ped.sem_limite),
                "peso_saca_kg": _num(ped.peso_saca_kg),
                "qtd_sacas": _num(ped.qtd_sacas),
                "total_kg": _num(ped.total_kg),
                "saldo_kg": _num(ped.saldo_kg),
                "valor_saca": _num(ped.valor_saca),
                "valor_total": _num(ped.valor_total),
                "status": ped.status or "",
                "observacao": ped.observacao or "",
                "cliente_id": ped.cliente_id,
                "produto_id": ped.produto_id,
            })
        return rows

    if codigo == "tickets_pesagem":
        rows = []
        tickets = db.scalars(select(TicketPesagem).order_by(TicketPesagem.data_abertura.desc())).all()
        for ticket in tickets:
            prod = produtos.get(ticket.produto_id or "")
            cliente = pessoas.get(ticket.cliente_id or "")
            pedido = pedidos.get(ticket.pedido_id or "")
            rows.append({
                "numero": ticket.numero,
                "tipo": ticket.tipo or "",
                "status": ticket.status,
                "data_abertura": ticket.data_abertura,
                "data_fechamento": ticket.data_fechamento,
                "produto_codigo": prod.codigo if prod else "",
                "produto_nome": prod.nome if prod else "—",
                "cliente": ticket.cliente_nome or _texto_local(cliente.nome if cliente else None),
                "transportadora": ticket.transportadora_nome or "",
                "motorista": ticket.motorista,
                "placa": ticket.placa,
                "origem": ticket.origem or "",
                "destino": ticket.destino or "",
                "peso_tara": _num(ticket.peso_tara),
                "peso_bruto": _num(ticket.peso_bruto),
                "peso_liquido": _num(ticket.peso_liquido),
                "pedido": pedido.numero if pedido else "",
                "observacao": ticket.observacao or "",
                "produto_id": ticket.produto_id or "",
                "cliente_id": ticket.cliente_id or "",
                "transportadora_id": ticket.transportadora_id or "",
            })
        return rows

    if codigo == "nfe_pesagem":
        rows = []
        tickets = db.scalars(select(TicketPesagem).order_by(TicketPesagem.data_abertura.desc())).all()
        for ticket in tickets:
            if ticket.tipo != "venda":
                continue

            prod = produtos.get(ticket.produto_id or "")
            cliente = pessoas.get(ticket.cliente_id or "")

            cliente_rel = (
                ticket.nfe_cliente
                or ticket.cliente_nome
                or _texto_local(cliente.nome if cliente else None)
            )
            produto_rel = ticket.nfe_produto or (prod.nome if prod else "—")
            quantidade_rel = (
                _num(ticket.nfe_quantidade)
                if ticket.nfe_importada and _num(ticket.nfe_quantidade) > 0
                else _num(ticket.peso_liquido)
            )

            rows.append({
                "numero": ticket.numero,
                "nfe_importada": bool(ticket.nfe_importada),
                "nfe_numero": ticket.nfe_numero or "",
                "cliente": cliente_rel,
                "produto": produto_rel,
                "quantidade": quantidade_rel,
                "nfe_valor": _num(ticket.nfe_valor),
                "nfe_chave": ticket.nfe_chave or "",
                "data_abertura": ticket.data_abertura,
                "cliente_id": ticket.cliente_id or "",
                "produto_id": ticket.produto_id or "",
            })
        return rows

    if codigo == "pagamentos":
        rows = []
        for pag in db.scalars(select(Pagamento).order_by(Pagamento.data_pagamento.desc())).all():
            pedido = pedidos.get(pag.pedido_id)
            cliente = pessoas.get(pag.cliente_id or "")
            rows.append({
                "numero": pag.numero or "",
                "data_pagamento": pag.data_pagamento,
                "pedido": pedido.numero if pedido else pag.pedido_id,
                "cliente": _texto_local(cliente.nome if cliente else None),
                "valor": _num(pag.valor),
                "forma_pagamento": pag.forma_pagamento or "",
                "observacao": pag.observacao or "",
                "cliente_id": pag.cliente_id or "",
            })
        return rows

    if codigo == "produtos":
        rows = []
        for prod in sorted(produtos.values(), key=lambda x: (x.nome or "").lower()):
            setor = setores.get(prod.setor_id)
            dep = depositos.get(prod.deposito_id or "")
            maq = maquinas.get(prod.maquina_id or "")
            gav = gavetas.get(prod.gaveta_id or "")
            rows.append({
                "codigo": prod.codigo,
                "codigo_referencia": prod.codigo_referencia or "",
                "nome": prod.nome,
                "setor": _texto_local(setor.nome if setor else None),
                "deposito": _deposito_label(dep),
                "maquina": f"{maq.codigo} — {maq.nome}" if maq else "—",
                "gaveta": _texto_local(gav.codigo if gav else None),
                "unidade": prod.unidade or "",
                "unidade_alt": prod.unidade_alt or "",
                "fator_conversao": _num(prod.fator_conversao),
                "estoque_minimo": _num(prod.estoque_minimo),
                "custo_unitario": _num(prod.custo_unitario),
                "venda": bool(prod.venda),
                "setor_id": prod.setor_id,
                "deposito_id": prod.deposito_id or "",
                "maquina_id": prod.maquina_id or "",
            })
        return rows

    if codigo in {"pessoas", "clientes", "fornecedores", "transportadoras", "motoristas"}:
        role_field = {
            "clientes": "is_cliente",
            "fornecedores": "is_fornecedor",
            "transportadoras": "is_transportadora",
            "motoristas": "is_motorista",
        }.get(codigo)
        rows = []
        for p in sorted(pessoas.values(), key=lambda x: (x.nome or "").lower()):
            if role_field and not getattr(p, role_field):
                continue
            rows.append({
                "nome": p.nome,
                "documento": p.documento or "",
                "ie": p.ie or "",
                "telefone": p.telefone or "",
                "cidade": p.cidade or "",
                "uf": p.uf or "",
                "papeis": _pessoa_papeis(p),
                "cnh": p.cnh or "",
                "cnh_validade": p.cnh_validade,
                "observacao": p.observacao or "",
            })
        return rows

    if codigo == "veiculos":
        rows = []
        for v in db.scalars(select(Veiculo).order_by(Veiculo.placa)).all():
            transp = pessoas.get(v.transportadora_id or "")
            motorista = pessoas.get(v.motorista_id or "")
            rows.append({
                "placa": v.placa,
                "modelo": v.modelo or "",
                "cor": v.cor or "",
                "ano": v.ano or "",
                "tara": _num(v.tara),
                "capacidade_kg": _num(v.capacidade_kg),
                "transportadora": _texto_local(transp.nome if transp else None),
                "motorista": _texto_local(motorista.nome if motorista else None),
                "observacao": v.observacao or "",
                "transportadora_id": v.transportadora_id or "",
                "motorista_id": v.motorista_id or "",
            })
        return rows

    if codigo == "maquinas":
        rows = []
        for maq in sorted(maquinas.values(), key=lambda x: (x.codigo or "", x.nome or "")):
            dep = depositos.get(maq.deposito_id or "")
            rows.append({
                "codigo": maq.codigo,
                "nome": maq.nome,
                "deposito": _deposito_label(dep),
                "permite_abastecimento": bool(maq.permite_abastecimento),
                "combustivel": maq.combustivel_nome or "",
                "descricao": maq.descricao or "",
                "deposito_id": maq.deposito_id or "",
                "setor_id": dep.setor_id if dep else "",
            })
        return rows

    if codigo == "setores":
        return [
            {
                "nome": s.nome,
                "descricao": s.descricao or "",
                "controla_validade": bool(s.controla_validade),
                "permite_inventario": bool(s.permite_inventario),
                "tem_aba_mobile": bool(s.tem_aba_mobile),
                "setor_id": s.id,
            }
            for s in sorted(setores.values(), key=lambda x: (x.nome or "").lower())
        ]

    if codigo == "depositos":
        rows = []
        for dep in sorted(depositos.values(), key=lambda x: (x.numero or "", x.nome or "")):
            setor = setores.get(dep.setor_id or "")
            rows.append({
                "numero": dep.numero or "",
                "nome": dep.nome or "",
                "setor": _texto_local(setor.nome if setor else None),
                "descricao": dep.descricao or "",
                "setor_id": dep.setor_id or "",
            })
        return rows

    if codigo == "gavetas":
        rows = []
        for gav in sorted(gavetas.values(), key=lambda x: (x.codigo or "")):
            dep = depositos.get(gav.deposito_id or "")
            setor = setores.get(dep.setor_id) if dep and dep.setor_id else None
            rows.append({
                "codigo": gav.codigo,
                "deposito": _deposito_label(dep),
                "setor": _texto_local(setor.nome if setor else None),
                "descricao": gav.descricao or "",
                "deposito_id": gav.deposito_id or "",
                "setor_id": dep.setor_id if dep else "",
            })
        return rows

    if codigo == "lavouras":
        return [
            {"numero": x.numero or "", "nome": x.nome, "hectares": _num(x.hectares)}
            for x in db.scalars(select(Lavoura).order_by(Lavoura.nome)).all()
        ]

    if codigo == "culturas":
        return [
            {"nome": x.nome}
            for x in db.scalars(select(Cultura).order_by(Cultura.nome)).all()
        ]

    if codigo == "anos_safra":
        return [
            {"nome": x.nome}
            for x in db.scalars(select(AnoSafra).order_by(AnoSafra.nome.desc())).all()
        ]

    if codigo == "usuarios":
        if not tem_permissao(current_user, "admin.relatorios.usuarios"):
            raise HTTPException(status_code=403, detail="Usuário sem permissão para este relatório administrativo.")
        rows = []
        for u in db.scalars(select(User).order_by(User.created_date.desc())).all():
            paginas = _lista_json(u.paginas_permitidas)
            setores_user = _lista_json(u.setores_permitidos)
            nomes_setores = []
            if setores_user is None:
                nomes_setores = ["Todos (não configurado)"]
            else:
                for setor_id in setores_user:
                    setor = setores.get(setor_id)
                    nomes_setores.append(setor.nome if setor else setor_id)
            rows.append({
                "username": u.username,
                "display_name": u.display_name or "",
                "role": u.role,
                "ativo": bool(u.ativo),
                "pode_confirmar_abastecimento": bool(u.pode_confirmar_abastecimento),
                "pode_digitar_peso": bool(u.pode_digitar_peso),
                "paginas": ", ".join(paginas or []) if paginas is not None else "Todas (não configurado)",
                "setores": ", ".join(nomes_setores),
                "created_date": u.created_date,
            })
        return rows

    raise HTTPException(status_code=404, detail="Relatório não implementado.")


def _match(valor: Any, desejado: Any) -> bool:
    if desejado in (None, "", "all"):
        return True
    if isinstance(valor, (list, tuple, set)):
        return str(desejado) in {str(x) for x in valor}
    if isinstance(valor, bool):
        esperado = str(desejado).lower() in {"1", "true", "sim", "ativo"}
        return valor is esperado
    return str(valor or "") == str(desejado)


def _as_date(valor: Any) -> date | None:
    if valor is None or valor == "":
        return None
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    if isinstance(valor, str):
        try:
            return datetime.fromisoformat(valor.replace("Z", "+00:00")).date()
        except ValueError:
            try:
                return date.fromisoformat(valor[:10])
            except ValueError:
                return None
    return None


def _filtrar_rows(
    rows: list[dict[str, Any]],
    meta: dict[str, Any],
    req: ExecutarRelatorioRequest,
    current_user: User,
) -> list[dict[str, Any]]:
    permitidos = setores_mobile_ids(current_user)
    sector_key = meta.get("sector_key")

    if current_user.role != "admin" and sector_key:
        permitidos_set = {str(x) for x in permitidos}
        rows = [
            row for row in rows
            if (
                bool({str(x) for x in row.get(sector_key, [])} & permitidos_set)
                if isinstance(row.get(sector_key), (list, tuple, set))
                else str(row.get(sector_key) or "") in permitidos_set
            )
        ]

    for key, desejado in (req.filtros or {}).items():
        if desejado in (None, "", "all"):
            continue
        rows = [row for row in rows if _match(row.get(key), desejado)]

    date_key = meta.get("date_key")
    if date_key and (req.data_de or req.data_ate):
        filtradas = []
        for row in rows:
            data_row = _as_date(row.get(date_key))
            if data_row is None:
                continue
            if req.data_de and data_row < req.data_de:
                continue
            if req.data_ate and data_row > req.data_ate:
                continue
            filtradas.append(row)
        rows = filtradas

    termo = (req.busca or "").strip().casefold()
    if termo:
        visiveis = [c["key"] for c in meta.get("columns", [])]
        rows = [
            row for row in rows
            if termo in " ".join(str(row.get(k, "")) for k in visiveis).casefold()
        ]

    return rows


def _public_meta(codigo: str, meta: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": codigo,
        "code": meta["code"],
        "title": meta["title"],
        "description": meta["description"],
        "category": meta["category"],
        "icon": meta["icon"],
        "columns": meta.get("columns", []),
        "filters": meta.get("filters", []),
        "period_label": meta.get("period_label", "Período"),
        "has_period": bool(meta.get("date_key")),
    }


def _option(value: Any, label: str) -> dict[str, Any]:
    return {"value": value, "label": label}


def _catalog_options(db: Session, current_user: User) -> dict[str, list[dict[str, Any]]]:
    produtos = db.scalars(select(Produto).order_by(Produto.nome)).all()
    setores = db.scalars(select(Setor).order_by(Setor.nome)).all()
    depositos = db.scalars(select(Deposito).order_by(Deposito.numero, Deposito.nome)).all()
    gavetas = db.scalars(select(Gaveta).order_by(Gaveta.codigo)).all()
    maquinas = db.scalars(select(Maquina).order_by(Maquina.codigo, Maquina.nome)).all()
    lavouras = db.scalars(select(Lavoura).order_by(Lavoura.nome)).all()
    culturas = db.scalars(select(Cultura).order_by(Cultura.nome)).all()
    pessoas = db.scalars(select(Pessoa).order_by(Pessoa.nome)).all()
    safras = db.scalars(select(AnoSafra).order_by(AnoSafra.nome.desc())).all()
    documentos = db.scalars(select(EstoqueDocumento)).all()

    setor_map = {s.id: s.nome for s in setores}
    permitidos = setores_mobile_ids(current_user)
    if current_user.role != "admin":
        allowed = {str(x) for x in permitidos}
        setores = [x for x in setores if x.id in allowed]
        depositos = [x for x in depositos if x.setor_id in allowed]
        produtos = [x for x in produtos if x.setor_id in allowed]
        dep_ids = {x.id for x in depositos}
        gavetas = [x for x in gavetas if x.deposito_id in dep_ids]
        maquinas = [x for x in maquinas if not x.deposito_id or x.deposito_id in dep_ids]

    return {
        "produtos": [_option(x.id, f"{x.codigo} — {x.nome}") for x in produtos],
        "setores": [_option(x.id, x.nome) for x in setores],
        "depositos": [_option(x.id, _deposito_label(x)) for x in depositos],
        "gavetas": [_option(x.id, x.codigo) for x in gavetas],
        "maquinas": [_option(x.id, f"{x.codigo} — {x.nome}") for x in maquinas],
        "lavouras": [_option(x.id, x.nome) for x in lavouras],
        "culturas": [_option(x.id, x.nome) for x in culturas],
        "safras": [_option(x.nome, x.nome) for x in safras],
        "pessoas": [_option(x.id, x.nome) for x in pessoas],
        "clientes": [_option(x.id, x.nome) for x in pessoas if x.is_cliente],
        "transportadoras": [_option(x.id, x.nome) for x in pessoas if x.is_transportadora],
        "motoristas": [_option(x.id, x.nome) for x in pessoas if x.is_motorista],
        "tipos_estoque": [
            _option("livre", "Livre"),
            _option("bloqueado", "Bloqueado"),
            _option("qualidade", "Qualidade"),
        ],
        "tipos_movimento": [
            _option(k, f"{k} — {v.descricao}")
            for k, v in sorted(REGRAS_MOVIMENTO.items())
        ] + [_option("ESTORNO", "ESTORNO — Estorno de documento")],
        "origens_modulo": [
            _option(x, x)
            for x in sorted({str(d.origem_modulo or "").strip() for d in documentos if str(d.origem_modulo or "").strip()})
        ],
        "status_documento": [
            _option("rascunho", "Rascunho"),
            _option("contabilizado", "Contabilizado"),
            _option("estornado", "Estornado"),
        ],
        "status_critico": [_option("Crítico", "Crítico"), _option("Zerado", "Zerado")],
        "status_reserva": [_option("ativa", "Ativa"), _option("consumida", "Consumida"), _option("cancelada", "Cancelada")],
        "tipos_evento_reserva": [_option("RESERVA", "Reserva"), _option("CONSUMO", "Consumo"), _option("CANCELAMENTO", "Cancelamento")],
        "status_abastecimento": [_option("pendente", "Pendente"), _option("confirmado", "Confirmado")],
        "status_aplicacao": [_option("pendente", "Pendente"), _option("baixada", "Baixada"), _option("cancelada", "Cancelada")],
        "status_inventario": [_option("aberto", "Aberto"), _option("fechado", "Fechado")],
        "status_pedido": [_option("aberto", "Aberto"), _option("fechado", "Fechado"), _option("cancelado", "Cancelado")],
        "status_nfe_ticket": [_option("true", "Com NF-e"), _option("false", "Sem NF-e")],
        "tipos_ticket": [_option("venda", "Venda"), _option("avulsa", "Avulsa")],
        "status_ticket": [_option("aberto", "Aberto"), _option("fechado", "Fechado"), _option("cancelado", "Cancelado")],
        "formas_pagamento": [_option("pix", "PIX"), _option("dinheiro", "Dinheiro"), _option("transferencia", "Transferência"), _option("outro", "Outro")],
        "roles_usuario": [
            _option("admin", "Administrador Total"),
            _option("subadmin", "Sub Administrador"),
            _option("user", "Usuário"),
        ],
        "status_usuario": [_option("true", "Ativo"), _option("false", "Inativo")],
        "setor_labels": [_option(k, v) for k, v in sorted(setor_map.items(), key=lambda x: x[1])],
    }


@router.get("/catalogo")
def catalogo_relatorios(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_reports_access(current_user)
    reports = []
    for codigo, meta in REPORTS.items():
        if meta.get("admin_only") and not tem_permissao(
            current_user,
            "admin.relatorios.usuarios",
        ):
            continue
        reports.append(_public_meta(codigo, meta))

    reports.sort(key=lambda x: (CATEGORY_ORDER.get(x["category"], 999), x["code"]))

    return {
        "reports": reports,
        "options": _catalog_options(db, current_user),
        "categories": [
            c for c, _ in sorted(CATEGORY_ORDER.items(), key=lambda x: x[1])
            if any(r["category"] == c for r in reports)
        ],
    }


@router.post("/{codigo}/executar")
def executar_relatorio(
    codigo: str,
    dados: ExecutarRelatorioRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_reports_access(current_user)
    meta = REPORTS.get(codigo)
    if meta is None:
        raise HTTPException(status_code=404, detail="Relatório não encontrado.")
    if meta.get("admin_only") and not tem_permissao(
        current_user,
        "admin.relatorios.usuarios",
    ):
        raise HTTPException(status_code=403, detail="Usuário sem permissão para este relatório administrativo.")

    if codigo == "pagamentos" and dados.mobile_view:
        rows = _pagamentos_resumo_mobile_rows(
            db,
            _contexto(db),
        )
        mobile_meta = {
            **meta,
            **MOBILE_PAGAMENTOS_META,
        }
        mobile_meta.pop("date_key", None)
        rows = _filtrar_rows(
            rows,
            mobile_meta,
            dados,
            current_user,
        )
        visible_keys = [
            c["key"]
            for c in MOBILE_PAGAMENTOS_META["columns"]
        ]
    else:
        rows = _build_rows(codigo, db, current_user)
        rows = _filtrar_rows(rows, meta, dados, current_user)
        visible_keys = [c["key"] for c in meta.get("columns", [])]

    total = len(rows)
    truncado = total > dados.limite
    rows = rows[: dados.limite]

    cleaned = [
        {key: row.get(key) for key in visible_keys}
        for row in rows
    ]

    return {
        "report": _public_meta(codigo, meta),
        "rows": cleaned,
        "total": total,
        "returned": len(cleaned),
        "truncated": truncado,
        "generated_at": datetime.now().astimezone(),
        "view": (
            "mobile_order_summary"
            if codigo == "pagamentos" and dados.mobile_view
            else "table"
        ),
    }
