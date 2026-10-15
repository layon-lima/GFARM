from __future__ import annotations

import json
from collections import defaultdict, deque
from threading import Lock
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.access_control import (
    paginas_usuario,
    permissoes_publicas,
    setores_mobile_ids,
    tem_permissao,
)
from app.core.security import (
    create_access_token,
    decode_access_token,
    verify_password,
)
from app.db.database import get_db
from app.models import User


router = APIRouter(
    prefix="/api/auth",
    tags=["Autenticação"],
)

bearer_scheme = HTTPBearer(
    auto_error=False
)


LOGIN_WINDOW_SECONDS = 10 * 60
LOGIN_MAX_FAILURES = 8

_login_failures: dict[
    str,
    deque[float],
] = defaultdict(deque)

_login_lock = Lock()


class LoginRequest(BaseModel):
    username: str
    password: str


class UpdateMeRequest(BaseModel):
    display_name: str


def _lista_json(valor):
    if valor is None:
        return None

    if isinstance(valor, list):
        return valor

    try:
        resultado = json.loads(valor)
        return (
            resultado
            if isinstance(
                resultado,
                list,
            )
            else []
        )
    except Exception:
        return []


def _login_key(
    request: Request,
    username: str,
) -> str:
    host = (
        request.client.host
        if request.client
        else "local"
    )

    return (
        f"{host}:"
        f"{username.strip().lower()}"
    )


def _limpar_tentativas_antigas(
    fila: deque[float],
    agora: float,
):
    limite = (
        agora
        - LOGIN_WINDOW_SECONDS
    )

    while (
        fila
        and fila[0] < limite
    ):
        fila.popleft()


def _verificar_rate_limit(
    chave: str,
):
    agora = monotonic()

    with _login_lock:
        fila = _login_failures[chave]

        _limpar_tentativas_antigas(
            fila,
            agora,
        )

        if (
            len(fila)
            >= LOGIN_MAX_FAILURES
        ):
            raise HTTPException(
                status_code=429,
                detail=(
                    "Muitas tentativas de login. "
                    "Aguarde alguns minutos e tente novamente."
                ),
                headers={
                    "Retry-After": str(
                        LOGIN_WINDOW_SECONDS
                    )
                },
            )


def _registrar_falha_login(
    chave: str,
):
    agora = monotonic()

    with _login_lock:
        fila = _login_failures[chave]

        _limpar_tentativas_antigas(
            fila,
            agora,
        )

        fila.append(agora)


def _limpar_falhas_login(
    chave: str,
):
    with _login_lock:
        _login_failures.pop(
            chave,
            None,
        )


def user_publico(user: User) -> dict:
    paginas = paginas_usuario(user)
    setores = (
        None
        if user.role == "admin"
        else sorted(setores_mobile_ids(user))
    )

    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "permissoes": permissoes_publicas(user),

        # Projeções de compatibilidade para o frontend existente.
        "pode_confirmar_abastecimento": tem_permissao(
            user,
            "operacao.abastecimento.confirmar",
        ),
        "pode_digitar_peso": tem_permissao(
            user,
            "operacao.pesagem.digitar_peso",
        ),
        "pode_baixar_mobile": tem_permissao(
            user,
            "mobile.estoque.baixar",
        ),
        "pode_mudar_gaveta_mobile": tem_permissao(
            user,
            "mobile.estoque.mudar_gaveta",
        ),
        "pode_mudar_deposito_mobile": tem_permissao(
            user,
            "mobile.estoque.mudar_deposito",
        ),
        "pode_entrada_manual_saldo_mobile": tem_permissao(
            user,
            "mobile.estoque.entrada_manual_saldo",
        ),
        "paginas_permitidas": (
            None
            if paginas is None
            else sorted(paginas)
        ),
        "setores_permitidos": setores,
        "ativo": user.ativo,
        "created_date": user.created_date,
        "updated_date": user.updated_date,
    }


def get_current_user(
    credentials: (
        HTTPAuthorizationCredentials
        | None
    ) = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail="Não autenticado.",
        )

    try:
        payload = decode_access_token(
            credentials.credentials
        )

        user_id = payload.get("sub")

    except Exception:
        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail=(
                "Sessão inválida ou expirada."
            ),
        )

    if not user_id:
        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail="Sessão inválida.",
        )

    user = db.get(
        User,
        user_id,
    )

    if (
        user is None
        or not user.ativo
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail=(
                "Usuário inexistente "
                "ou desativado."
            ),
        )

    return user


@router.post("/login")
def login(
    dados: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    username = (
        dados.username.strip()
    )

    chave = _login_key(
        request,
        username,
    )

    _verificar_rate_limit(
        chave
    )

    stmt = select(User).where(
        func.lower(
            User.username
        )
        == username.lower()
    )

    user = db.scalar(stmt)

    if (
        user is None
        or not user.ativo
        or not verify_password(
            dados.password,
            user.password_hash,
        )
    ):
        _registrar_falha_login(
            chave
        )

        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail=(
                "Usuário ou senha inválidos."
            ),
        )

    _limpar_falhas_login(
        chave
    )

    token = create_access_token(
        user_id=user.id,
        username=user.username,
        role=user.role,
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user_publico(user),
    }


@router.get("/me")
def me(
    current_user: User = Depends(
        get_current_user
    ),
):
    return user_publico(
        current_user
    )


@router.patch("/me")
def atualizar_me(
    dados: UpdateMeRequest,
    current_user: User = Depends(
        get_current_user
    ),
    db: Session = Depends(get_db),
):
    nome = (
        dados.display_name.strip()
    )

    if not nome:
        raise HTTPException(
            status_code=400,
            detail="Informe um nome.",
        )

    current_user.display_name = nome

    db.commit()
    db.refresh(
        current_user
    )

    return user_publico(
        current_user
    )
