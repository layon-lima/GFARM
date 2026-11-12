from decimal import Decimal
from typing import Any


def _decimal(valor: Any) -> Decimal:
    if valor is None or valor == "":
        return Decimal("0")

    return Decimal(str(valor))


# Todas as grafias oficiais e comerciais abaixo representam tonelada.
# A conversao fisica padrao (1 tonelada = 1000 kg) so e habilitada
# automaticamente para recebimentos de NF-e. Outros modulos mantem a
# politica anterior de unidades alternativas cadastradas.
SINONIMOS_TONELADA = {"T", "TN", "TON", "TO", "TONS", "TONELADA", "TONELADAS"}


def _unidade(valor: Any) -> str:
    unidade = str(valor or "").strip().upper()
    return "TON" if unidade in SINONIMOS_TONELADA else unidade


# Fatores metrologicos exatos em relacao à unidade-base da familia.
# Nunca converter embalagem ou dosagem para massa/volume por presuncao.
UNIDADES_PADRAO = {
    "KG": ("massa", Decimal("1")),
    "QUILO": ("massa", Decimal("1")),
    "QUILOS": ("massa", Decimal("1")),
    "QUILOGRAMA": ("massa", Decimal("1")),
    "QUILOGRAMAS": ("massa", Decimal("1")),
    "KGS": ("massa", Decimal("1")),
    "G": ("massa", Decimal("0.001")),
    "GR": ("massa", Decimal("0.001")),
    "GRAMA": ("massa", Decimal("0.001")),
    "GRAMAS": ("massa", Decimal("0.001")),
    "TON": ("massa", Decimal("1000")),
    "L": ("volume", Decimal("1")),
    "LT": ("volume", Decimal("1")),
    "LITRO": ("volume", Decimal("1")),
    "LITROS": ("volume", Decimal("1")),
    "ML": ("volume", Decimal("0.001")),
    "MILILITRO": ("volume", Decimal("0.001")),
    "MILILITROS": ("volume", Decimal("0.001")),
}


def fator_conversao_padrao(unidade_origem: Any, unidade_destino: Any) -> Decimal | None:
    """Fator exato para unidades fisicas da mesma familia, sem embalagem."""
    origem = UNIDADES_PADRAO.get(_unidade(unidade_origem))
    destino = UNIDADES_PADRAO.get(_unidade(unidade_destino))
    if origem is None or destino is None or origem[0] != destino[0]:
        return None
    return origem[1] / destino[1]


def converter_quantidade_estoque(
    produto,
    quantidade_informada,
    unidade_informada=None,
    *,
    permitir_conversao_padrao=False,
):
    """
    Converte a quantidade do documento para
    a unidade-base oficial do produto.

    Exemplo:
        Produto:
            unidade = KG
            unidade_alt = CX
            fator_conversao = 50

        Documento:
            2 CX

        Resultado:
            100 KG
    """

    quantidade = _decimal(
        quantidade_informada
    )

    if quantidade <= 0:
        raise ValueError(
            "A quantidade deve ser maior que zero."
        )

    unidade_base = _unidade(
        produto.unidade or "UN"
    )

    unidade_documento = _unidade(
        unidade_informada
        or unidade_base
    )

    #
    # Já veio na unidade-base.
    #
    if unidade_documento == unidade_base:
        fator = Decimal("1")

    else:
        unidade_alternativa = _unidade(
            produto.unidade_alt
        )
        # Para a NF-e: TN, T, TON, TO e toneladas são equivalentes;
        # conversões exatas para KG/G e L/ML dispensam configuração.
        # Se for CX, SACO, DOSE etc., continua valendo o fator do
        # cadastro (jamais presumir kg por caixa ou ml por frasco).
        padrao = (
            fator_conversao_padrao(unidade_documento, unidade_base)
            if permitir_conversao_padrao else None
        )
        if padrao is not None:
            fator = padrao
        elif unidade_alternativa and unidade_documento == unidade_alternativa:
            fator = _decimal(produto.fator_conversao)
            if fator <= 0:
                raise ValueError(
                    f"O produto {produto.nome} utiliza "
                    f"{unidade_alternativa}, mas não possui "
                    "fator de conversão válido."
                )
        else:
            raise ValueError(
                f"Unidade {unidade_documento} "
                f"não configurada para o produto "
                f"{produto.nome}. "
                f"Unidade-base: {unidade_base}."
            )

    quantidade_base = (
        quantidade
        * fator
    )

    return {
        "quantidade_informada": quantidade,
        "unidade_informada": unidade_documento,
        "fator_conversao": fator,
        "quantidade_base": quantidade_base,
        "unidade_base": unidade_base,
    }
