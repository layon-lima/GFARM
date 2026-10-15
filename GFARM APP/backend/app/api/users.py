from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user, user_publico
from app.core.access_control import (
    ADMIN_PERMISSION_KEYS,
    LEGACY_FLAG_PERMISSIONS,
    PAGE_PERMISSION_KEYS,
    PERMISSION_CATALOG,
    VALID_PAGE_KEYS,
    VALID_PERMISSION_KEYS,
    exigir_permissao,
    permissoes_usuario,
    setores_mobile_ids,
    tem_permissao,
)
from app.core.security import hash_password
from app.db.database import get_db
from app.models import Setor, User, UserPermission
from app.services.auditoria_erp import registrar_auditoria


router = APIRouter(
    prefix="/api/users",
    tags=["Usuários"],
)


class CriarUsuarioRequest(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=4, max_length=200)
    display_name: str = Field(min_length=1, max_length=255)
    role: Literal["admin", "subadmin", "user"] = "user"


class AtualizarUsuarioRequest(BaseModel):
    display_name: str | None = None
    role: Literal["admin", "subadmin", "user"] | None = None
    ativo: bool | None = None
    password: str | None = None

    # Compatibilidade com versões anteriores do frontend.
    pode_confirmar_abastecimento: bool | None = None
    pode_digitar_peso: bool | None = None
    pode_baixar_mobile: bool | None = None
    pode_mudar_gaveta_mobile: bool | None = None
    pode_mudar_deposito_mobile: bool | None = None
    pode_entrada_manual_saldo_mobile: bool | None = None
    paginas_permitidas: list[str] | None = None
    setores_permitidos: list[str] | None = None


class AtualizarPermissoesRequest(BaseModel):
    role: Literal["admin", "subadmin", "user"]
    permissoes: list[str] = Field(default_factory=list)
    setores_permitidos: list[str] = Field(default_factory=list)


def exigir_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """Administrador Total. Não confundir com Sub Administrador."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Acesso permitido somente para Administradores Totais.",
        )
    return current_user


def dep_permissao(permission_key: str):
    def dependency(
        current_user: User = Depends(get_current_user),
    ) -> User:
        exigir_permissao(current_user, permission_key)
        return current_user

    return dependency


USER_MANAGEMENT_PERMISSIONS = (
    "admin.usuarios.visualizar",
    "admin.usuarios.criar",
    "admin.usuarios.editar",
    "admin.usuarios.excluir",
)


def exigir_acesso_usuarios(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.role == "admin":
        return current_user

    if any(
        tem_permissao(current_user, key)
        for key in USER_MANAGEMENT_PERMISSIONS
    ):
        return current_user

    raise HTTPException(
        status_code=403,
        detail="Usuário sem permissão para acessar a administração de usuários.",
    )


def quantidade_admins_ativos(db: Session) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.role == "admin",
                User.ativo.is_(True),
            )
        )
        or 0
    )


def _validar_paginas(paginas: list[str]):
    invalidas = sorted({
        pagina
        for pagina in paginas
        if pagina not in VALID_PAGE_KEYS
    })
    if invalidas:
        raise HTTPException(
            status_code=400,
            detail="Permissões de página inválidas: " + ", ".join(invalidas),
        )


def _validar_setores(db: Session, setores: list[str]):
    ids = {str(item) for item in setores if item}
    if not ids:
        return

    existentes = set(
        db.scalars(
            select(Setor.id).where(Setor.id.in_(ids))
        ).all()
    )
    ausentes = sorted(ids - existentes)
    if ausentes:
        raise HTTPException(
            status_code=400,
            detail="Setor(es) de permissão não encontrado(s): " + ", ".join(ausentes),
        )


def _validar_permissoes(keys: list[str]):
    invalidas = sorted({
        str(key)
        for key in keys
        if str(key) not in VALID_PERMISSION_KEYS
    })
    if invalidas:
        raise HTTPException(
            status_code=400,
            detail="Permissão(ões) inválida(s): " + ", ".join(invalidas),
        )


def _sincronizar_projecoes_legadas(
    user: User,
    permissoes: set[str],
    setores: set[str],
):
    paginas = sorted(
        pagina
        for pagina, key in PAGE_PERMISSION_KEYS.items()
        if key in permissoes
    )

    user.paginas_permitidas = json.dumps(
        paginas,
        ensure_ascii=False,
    )
    user.setores_permitidos = json.dumps(
        sorted(setores),
        ensure_ascii=False,
    )

    for campo, key in LEGACY_FLAG_PERMISSIONS.items():
        setattr(user, campo, key in permissoes)


def substituir_permissoes(
    db: Session,
    user: User,
    *,
    permissoes: set[str],
    setores: set[str],
    autor_id: str | None,
):
    db.execute(
        delete(UserPermission).where(
            UserPermission.user_id == user.id
        )
    )

    if user.role != "admin":
        for key in sorted(permissoes):
            db.add(
                UserPermission(
                    user_id=user.id,
                    permission_key=key,
                    scope_value="",
                    created_by_id=autor_id,
                )
            )

        for setor_id in sorted(setores):
            db.add(
                UserPermission(
                    user_id=user.id,
                    permission_key="mobile.setor",
                    scope_value=setor_id,
                    created_by_id=autor_id,
                )
            )

        _sincronizar_projecoes_legadas(
            user,
            permissoes,
            setores,
        )
    else:
        # Admin Total ignora a matriz granular.
        user.paginas_permitidas = None
        user.setores_permitidos = None
        for campo in LEGACY_FLAG_PERMISSIONS:
            setattr(user, campo, True)

    db.flush()
    db.expire(user, ["permission_records"])


def _aplicar_patch_legado(
    db: Session,
    user: User,
    dados: AtualizarUsuarioRequest,
    current_user: User,
):
    campos_legados = (
        dados.paginas_permitidas is not None
        or dados.setores_permitidos is not None
        or any(
            getattr(dados, campo) is not None
            for campo in LEGACY_FLAG_PERMISSIONS
        )
    )

    if not campos_legados:
        return

    if current_user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Somente o Administrador Total pode alterar permissões.",
        )

    permissoes = set(permissoes_usuario(user))
    permissoes.discard("*")
    setores = set(setores_mobile_ids(user))

    if dados.paginas_permitidas is not None:
        _validar_paginas(dados.paginas_permitidas)
        permissoes -= set(PAGE_PERMISSION_KEYS.values())
        permissoes |= {
            PAGE_PERMISSION_KEYS[pagina]
            for pagina in dados.paginas_permitidas
        }

    if dados.setores_permitidos is not None:
        _validar_setores(db, dados.setores_permitidos)
        setores = {
            str(item)
            for item in dados.setores_permitidos
            if item
        }

    for campo, key in LEGACY_FLAG_PERMISSIONS.items():
        valor = getattr(dados, campo)
        if valor is None:
            continue
        if valor:
            permissoes.add(key)
        else:
            permissoes.discard(key)

    substituir_permissoes(
        db,
        user,
        permissoes=permissoes,
        setores=setores,
        autor_id=current_user.id,
    )


@router.get("/permissions/catalog")
def catalogo_permissoes(
    _: User = Depends(exigir_admin),
):
    return {
        "groups": [
            {"key": "areas", "label": "Áreas do sistema"},
            {"key": "operacao", "label": "Operação"},
            {"key": "mobile", "label": "Ações no celular"},
            {"key": "administracao", "label": "Funções administrativas"},
        ],
        "permissions": list(PERMISSION_CATALOG),
        "roles": [
            {"value": "user", "label": "Usuário"},
            {"value": "subadmin", "label": "Sub Administrador"},
            {"value": "admin", "label": "Administrador Total"},
        ],
    }


@router.get("")
def listar_usuarios(
    _: User = Depends(exigir_acesso_usuarios),
    db: Session = Depends(get_db),
):
    usuarios = db.scalars(
        select(User).order_by(User.created_date.desc())
    ).all()
    return [user_publico(user) for user in usuarios]


@router.post("")
def criar_usuario(
    dados: CriarUsuarioRequest,
    current_user: User = Depends(
        dep_permissao("admin.usuarios.criar")
    ),
    db: Session = Depends(get_db),
):
    if current_user.role != "admin" and dados.role != "user":
        raise HTTPException(
            status_code=403,
            detail="Somente o Administrador Total pode criar Administradores ou Sub Administradores.",
        )

    username = dados.username.strip()
    display_name = dados.display_name.strip()

    existente = db.scalar(
        select(User).where(
            func.lower(User.username) == username.lower()
        )
    )
    if existente:
        raise HTTPException(status_code=409, detail="Esse nome de usuário já existe.")

    user = User(
        username=username,
        password_hash=hash_password(dados.password),
        display_name=display_name,
        role=dados.role,
        pode_confirmar_abastecimento=False,
        pode_digitar_peso=False,
        pode_baixar_mobile=False,
        pode_mudar_gaveta_mobile=False,
        pode_mudar_deposito_mobile=False,
        pode_entrada_manual_saldo_mobile=False,
        paginas_permitidas=json.dumps([], ensure_ascii=False),
        setores_permitidos=json.dumps([], ensure_ascii=False),
        ativo=True,
    )

    db.add(user)
    db.flush()

    registrar_auditoria(
        db,
        usuario=current_user,
        acao="criar",
        entidade="User",
        registro_id=user.id,
        depois=user_publico(user),
    )

    db.commit()
    db.refresh(user)
    return user_publico(user)


@router.get("/{user_id}")
def obter_usuario(
    user_id: str,
    _: User = Depends(exigir_acesso_usuarios),
    db: Session = Depends(get_db),
):
    usuario = db.get(User, user_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    return user_publico(usuario)


@router.put("/{user_id}/permissions")
def atualizar_permissoes(
    user_id: str,
    dados: AtualizarPermissoesRequest,
    current_user: User = Depends(exigir_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    if user.id == current_user.id and dados.role != "admin":
        raise HTTPException(
            status_code=400,
            detail="Você não pode remover seu próprio perfil de Administrador Total.",
        )

    if (
        user.role == "admin"
        and user.ativo
        and dados.role != "admin"
        and quantidade_admins_ativos(db) <= 1
    ):
        raise HTTPException(
            status_code=400,
            detail="O sistema precisa manter pelo menos um Administrador Total ativo.",
        )

    _validar_permissoes(dados.permissoes)
    _validar_setores(db, dados.setores_permitidos)

    permissoes = {str(key) for key in dados.permissoes}
    setores = {
        str(item)
        for item in dados.setores_permitidos
        if item
    }

    if dados.role == "user" and permissoes & ADMIN_PERMISSION_KEYS:
        raise HTTPException(
            status_code=400,
            detail="Funções administrativas exigem o perfil Sub Administrador.",
        )

    antes = user_publico(user)
    user.role = dados.role

    substituir_permissoes(
        db,
        user,
        permissoes=permissoes,
        setores=setores,
        autor_id=current_user.id,
    )

    registrar_auditoria(
        db,
        usuario=current_user,
        acao="atualizar_permissoes",
        entidade="User",
        registro_id=user.id,
        antes=antes,
        depois=user_publico(user),
    )

    db.commit()
    db.refresh(user)
    return user_publico(user)


@router.patch("/{user_id}")
def atualizar_usuario(
    user_id: str,
    dados: AtualizarUsuarioRequest,
    current_user: User = Depends(
        dep_permissao("admin.usuarios.editar")
    ),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    if current_user.role != "admin":
        if user.role != "user":
            raise HTTPException(
                status_code=403,
                detail="Sub Administradores só podem editar usuários padrão.",
            )
        if dados.role is not None and dados.role != "user":
            raise HTTPException(
                status_code=403,
                detail="Somente o Administrador Total pode alterar perfis administrativos.",
            )

    if (
        user.role == "admin"
        and user.ativo
        and quantidade_admins_ativos(db) <= 1
    ):
        removendo_admin = dados.role is not None and dados.role != "admin"
        desativando = dados.ativo is False
        if removendo_admin or desativando:
            raise HTTPException(
                status_code=400,
                detail="O sistema precisa manter pelo menos um Administrador Total ativo.",
            )

    if user.id == current_user.id and dados.role is not None and dados.role != "admin":
        raise HTTPException(
            status_code=400,
            detail="Você não pode remover sua própria permissão de Administrador Total.",
        )

    antes = user_publico(user)

    if dados.display_name is not None:
        nome = dados.display_name.strip()
        if not nome:
            raise HTTPException(status_code=400, detail="O nome não pode ficar vazio.")
        user.display_name = nome

    if dados.role is not None:
        if current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Somente o Administrador Total pode alterar o perfil.")
        user.role = dados.role
        if dados.role == "admin":
            substituir_permissoes(
                db,
                user,
                permissoes=set(),
                setores=set(),
                autor_id=current_user.id,
            )

    if dados.ativo is not None:
        user.ativo = dados.ativo

    if dados.password is not None:
        if len(dados.password) < 4:
            raise HTTPException(status_code=400, detail="A senha deve possuir pelo menos 4 caracteres.")
        user.password_hash = hash_password(dados.password)

    _aplicar_patch_legado(
        db,
        user,
        dados,
        current_user,
    )

    db.flush()

    registrar_auditoria(
        db,
        usuario=current_user,
        acao="atualizar",
        entidade="User",
        registro_id=user.id,
        antes=antes,
        depois=user_publico(user),
    )

    db.commit()
    db.refresh(user)
    return user_publico(user)


@router.delete("/{user_id}")
def excluir_usuario(
    user_id: str,
    current_user: User = Depends(
        dep_permissao("admin.usuarios.excluir")
    ),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Você não pode excluir seu próprio usuário.")

    if current_user.role != "admin" and user.role != "user":
        raise HTTPException(
            status_code=403,
            detail="Sub Administradores só podem excluir usuários padrão.",
        )

    if (
        user.role == "admin"
        and user.ativo
        and quantidade_admins_ativos(db) <= 1
    ):
        raise HTTPException(
            status_code=400,
            detail="O sistema precisa manter pelo menos um Administrador Total ativo.",
        )

    registrar_auditoria(
        db,
        usuario=current_user,
        acao="excluir",
        entidade="User",
        registro_id=user.id,
        antes=user_publico(user),
    )

    db.delete(user)
    db.commit()
    return {"success": True}
