from decimal import Decimal
from typing import Any


def _decimal(valor: Any) -> Decimal:
    if valor is None or valor == "":
        return Decimal("0")

    return Decimal(str(valor))


def _unidade(valor: Any) -> str:
    return str(valor or "").strip().upper()


def converter_quantidade_estoque(
    produto,
    quantidade_informada,
    unidade_informada=None,
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

        if (
            not unidade_alternativa
            or unidade_documento
            != unidade_alternativa
        ):
            raise ValueError(
                f"Unidade {unidade_documento} "
                f"não configurada para o produto "
                f"{produto.nome}. "
                f"Unidade-base: {unidade_base}."
            )

        fator = _decimal(
            produto.fator_conversao
        )

        if fator <= 0:
            raise ValueError(
                f"O produto {produto.nome} utiliza "
                f"{unidade_alternativa}, mas não possui "
                "fator de conversão válido."
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
