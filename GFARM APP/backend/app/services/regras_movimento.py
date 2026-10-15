from dataclasses import dataclass
from enum import Enum


class DirecaoMovimento(str, Enum):
    ENTRADA = "entrada"
    SAIDA = "saida"
    TRANSFERENCIA = "transferencia"


@dataclass(frozen=True)
class RegraMovimento:
    codigo: str
    descricao: str
    direcao: DirecaoMovimento

    exige_origem: bool = False
    exige_destino: bool = False

    permite_custo_informado: bool = False

    # Se True, a operação não pode gerar
    # estoque disponível negativo.
    bloqueia_saldo_negativo: bool = True

    # Indica se a operação normalmente nasce
    # de outro módulo/documento do ERP.
    origem_controlada: bool = False


REGRAS_MOVIMENTO = {
    #
    # ENTRADAS
    #
    "ENTRADA_COMPRA": RegraMovimento(
        codigo="ENTRADA_COMPRA",
        descricao="Entrada por documento fiscal",
        direcao=DirecaoMovimento.ENTRADA,
        exige_destino=True,
        permite_custo_informado=True,
        origem_controlada=True,
    ),

    "DEVOLUCAO_ENTRADA": RegraMovimento(
        codigo="DEVOLUCAO_ENTRADA",
        descricao="Entrada por devolução",
        direcao=DirecaoMovimento.ENTRADA,
        exige_destino=True,
        permite_custo_informado=True,
        origem_controlada=True,
    ),

    "AJUSTE_POSITIVO": RegraMovimento(
        codigo="AJUSTE_POSITIVO",
        descricao="Ajuste positivo de estoque",
        direcao=DirecaoMovimento.ENTRADA,
        exige_destino=True,
        permite_custo_informado=True,
        origem_controlada=True,
    ),

    "ENTRADA_SALDO_ADMIN": RegraMovimento(
        codigo="ENTRADA_SALDO_ADMIN",
        descricao="Entrada manual de saldo por administrador",
        direcao=DirecaoMovimento.ENTRADA,
        exige_destino=True,
        permite_custo_informado=True,
        origem_controlada=True,
    ),

    #
    # SAÍDAS
    #
    "SAIDA_CONSUMO": RegraMovimento(
        codigo="SAIDA_CONSUMO",
        descricao="Saída para consumo",
        direcao=DirecaoMovimento.SAIDA,
        exige_origem=True,
    ),

    "DEVOLUCAO_SAIDA": RegraMovimento(
        codigo="DEVOLUCAO_SAIDA",
        descricao="Saída por devolução",
        direcao=DirecaoMovimento.SAIDA,
        exige_origem=True,
        origem_controlada=True,
    ),

    "AJUSTE_NEGATIVO": RegraMovimento(
        codigo="AJUSTE_NEGATIVO",
        descricao="Ajuste negativo de estoque",
        direcao=DirecaoMovimento.SAIDA,
        exige_origem=True,
        origem_controlada=True,
    ),

    "ABASTECIMENTO": RegraMovimento(
        codigo="ABASTECIMENTO",
        descricao="Consumo por abastecimento",
        direcao=DirecaoMovimento.SAIDA,
        exige_origem=True,
        origem_controlada=True,
    ),

    "APLICACAO": RegraMovimento(
        codigo="APLICACAO",
        descricao="Consumo por aplicação agrícola",
        direcao=DirecaoMovimento.SAIDA,
        exige_origem=True,
        origem_controlada=True,
    ),

    #
    # TRANSFERÊNCIA
    #
    "TRANSFERENCIA": RegraMovimento(
        codigo="TRANSFERENCIA",
        descricao="Transferência entre locais de estoque",
        direcao=DirecaoMovimento.TRANSFERENCIA,
        exige_origem=True,
        exige_destino=True,
    ),
}


def obter_regra_movimento(
    codigo: str,
) -> RegraMovimento:
    codigo = (codigo or "").strip().upper()

    regra = REGRAS_MOVIMENTO.get(codigo)

    if regra is None:
        raise ValueError(
            f"Tipo de movimento inválido: {codigo}"
        )

    return regra


MOVIMENTOS_VALIDOS = set(
    REGRAS_MOVIMENTO.keys()
)

MOVIMENTOS_ENTRADA = {
    codigo
    for codigo, regra in REGRAS_MOVIMENTO.items()
    if regra.direcao == DirecaoMovimento.ENTRADA
}

MOVIMENTOS_SAIDA = {
    codigo
    for codigo, regra in REGRAS_MOVIMENTO.items()
    if regra.direcao == DirecaoMovimento.SAIDA
}

MOVIMENTOS_TRANSFERENCIA = {
    codigo
    for codigo, regra in REGRAS_MOVIMENTO.items()
    if regra.direcao == DirecaoMovimento.TRANSFERENCIA
}
