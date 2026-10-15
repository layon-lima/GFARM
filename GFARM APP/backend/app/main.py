from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.entities import router as entities_router
from app.api.relatorios import router as relatorios_router
from app.api.estoque import router as estoque_router
from app.api.reservas import router as reservas_router
from app.api.files import router as files_router
from app.api.users import router as users_router
from app.api.inventario_pendencias import router as inventario_pendencias_router
from app.api.cadastros_mobile import router as cadastros_mobile_router
from app.api.entrada_saldo_mobile import router as entrada_saldo_mobile_router
from app.core.logging_config import configurar_logging
from app.core.scheduler import (
    iniciar_agendador,
    parar_agendador,
)


configurar_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    iniciar_agendador()

    yield

    parar_agendador()


app = FastAPI(
    title="API Estoque Novo Horizonte",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=(
        r"^https?://("
        r"localhost|127\.0\.0\.1|"
        r"10\.\d+\.\d+\.\d+|"
        r"192\.168\.\d+\.\d+|"
        r"172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+"
        r")(:\d+)?$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app.mount(
    "/uploads",
    StaticFiles(directory=UPLOAD_DIR),
    name="uploads",
)

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(users_router)
app.include_router(inventario_pendencias_router)
app.include_router(cadastros_mobile_router)
app.include_router(entrada_saldo_mobile_router)
app.include_router(files_router)
app.include_router(entities_router)
app.include_router(relatorios_router)
app.include_router(estoque_router)
app.include_router(reservas_router)


@app.get("/api/health")
def health():
    return {
        "status": "online",
        "api": "Estoque Novo Horizonte",
    }


# Proteção contra alterações diretas nas tabelas
# legadas de saldo e movimentação.
from app.core.stock_guard import (
    bloquear_mutacoes_estoque_legacy,
)

app.middleware("http")(
    bloquear_mutacoes_estoque_legacy
)

PROJECT_ROOT = (
    Path(__file__).resolve()
    .parents[2]
)

FRONTEND_DIST = (
    PROJECT_ROOT
    / "dist"
)


def _frontend_file(
    relative_path: str,
):
    dist = (
        FRONTEND_DIST.resolve()
    )

    candidate = (
        FRONTEND_DIST
        / relative_path
    ).resolve()

    try:
        candidate.relative_to(
            dist
        )
    except ValueError:
        raise HTTPException(
            status_code=404,
            detail="Arquivo não encontrado.",
        )

    if candidate.is_file():
        return FileResponse(
            candidate
        )

    index = (
        FRONTEND_DIST
        / "index.html"
    )

    if index.is_file():
        return FileResponse(
            index
        )

    raise HTTPException(
        status_code=503,
        detail=(
            "Frontend de produção ainda "
            "não foi compilado."
        ),
    )


@app.get(
    "/",
    include_in_schema=False,
)
def frontend_root():
    return _frontend_file(
        "index.html"
    )


@app.get(
    "/{full_path:path}",
    include_in_schema=False,
)
def frontend_spa(
    full_path: str,
):
    if (
        full_path.startswith("api/")
        or full_path == "api"
        or full_path.startswith(
            "uploads/"
        )
        or full_path == "uploads"
    ):
        raise HTTPException(
            status_code=404,
            detail="Rota não encontrada.",
        )

    return _frontend_file(
        full_path
    )
