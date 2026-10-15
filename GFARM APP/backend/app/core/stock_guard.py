from fastapi import Request
from fastapi.responses import JSONResponse


ENTIDADES_ESTOQUE_PROTEGIDAS = {
    "saldoestoque",
    "movimentacao",
}


async def bloquear_mutacoes_estoque_legacy(
    request: Request,
    call_next,
):
    """
    Impede que a API genérica altere diretamente
    tabelas que representam saldo/movimentação.

    Leituras continuam permitidas, inclusive
    POST /filter usado pelo frontend legado.
    """

    partes = [
        parte
        for parte in request.url.path.strip("/").split("/")
        if parte
    ]

    if (
        len(partes) >= 3
        and partes[0].lower() == "api"
        and partes[1].lower() == "entities"
        and partes[2].lower()
        in ENTIDADES_ESTOQUE_PROTEGIDAS
    ):
        metodo = request.method.upper()

        #
        # GET continua permitido.
        #
        if metodo == "GET":
            return await call_next(request)

        #
        # O frontend legado usa POST /filter
        # apenas para CONSULTAR registros.
        #
        if (
            metodo == "POST"
            and len(partes) >= 4
            and partes[3].lower() == "filter"
        ):
            return await call_next(request)

        if metodo in {
            "POST",
            "PATCH",
            "PUT",
            "DELETE",
        }:
            return JSONResponse(
                status_code=409,
                content={
                    "detail": (
                        "Alteração direta de estoque bloqueada. "
                        "Utilize a API oficial do motor de estoque."
                    )
                },
            )

    return await call_next(request)
