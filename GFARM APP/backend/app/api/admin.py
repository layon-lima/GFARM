from __future__ import annotations

from fastapi import (
    APIRouter,
    Depends,
    Query,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.users import dep_permissao
from app.db.database import get_db
from app.models import (
    AuditoriaERP,
    User,
)
from app.services.auditoria_erp import (
    registrar_auditoria,
)
from app.services.backup_erp import (
    BACKUP_DIR,
    criar_backup,
    listar_backups,
    verificar_backup,
)
from app.services.consistencia_estoque import (
    verificar_consistencia_estoque,
)


router = APIRouter(
    prefix="/api/admin",
    tags=["Administração"],
)


def _audit_publico(
    item: AuditoriaERP,
) -> dict:
    return {
        "id": item.id,
        "created_date":
            item.created_date,
        "usuario_id":
            item.usuario_id,
        "usuario_nome":
            item.usuario_nome,
        "acao":
            item.acao,
        "entidade":
            item.entidade,
        "registro_id":
            item.registro_id,
        "antes_json":
            item.antes_json,
        "depois_json":
            item.depois_json,
        "detalhe":
            item.detalhe,
    }


@router.post(
    "/verificar-consistencia-estoque"
)
def verificar_consistencia(
    current_user: User = Depends(
        dep_permissao("admin.integridade.verificar")
    ),
    db: Session = Depends(get_db),
):
    resultado = (
        verificar_consistencia_estoque(
            db
        )
    )

    registrar_auditoria(
        db,
        usuario=current_user,
        acao="verificar",
        entidade="IntegridadeEstoque",
        detalhe=(
            "Verificação manual de "
            "consistência do estoque."
        ),
        depois={
            "produtos_com_divergencia":
                resultado[
                    "produtos_com_divergencia"
                ],
            "saldos_negativos":
                resultado[
                    "saldos_negativos"
                ],
            "reservas_invalidas":
                resultado[
                    "reservas_invalidas"
                ],
        },
    )

    db.commit()

    return resultado


@router.get("/integridade")
def integridade(
    _: User = Depends(
        dep_permissao("admin.integridade.visualizar")
    ),
    db: Session = Depends(get_db),
):
    resultado = (
        verificar_consistencia_estoque(
            db
        )
    )

    problemas = (
        resultado[
            "produtos_com_divergencia"
        ]
        + resultado[
            "saldos_negativos"
        ]
        + resultado[
            "reservas_invalidas"
        ]
    )

    total_auditoria = (
        db.scalar(
            select(
                func.count(
                    AuditoriaERP.id
                )
            )
        )
        or 0
    )

    ultimo_evento = db.scalar(
        select(
            AuditoriaERP
        )
        .order_by(
            AuditoriaERP.created_date.desc()
        )
        .limit(1)
    )

    return {
        "status":
            (
                "ok"
                if problemas == 0
                else "atencao"
            ),
        "problemas":
            problemas,
        "produtos_com_divergencia":
            resultado[
                "produtos_com_divergencia"
            ],
        "saldos_negativos":
            resultado[
                "saldos_negativos"
            ],
        "reservas_invalidas":
            resultado[
                "reservas_invalidas"
            ],
        "fonte_oficial":
            resultado[
                "fonte_oficial"
            ],
        "verificado_em":
            resultado[
                "verificado_em"
            ],
        "auditoria_total":
            total_auditoria,
        "ultimo_evento":
            (
                _audit_publico(
                    ultimo_evento
                )
                if ultimo_evento
                else None
            ),
    }


@router.get("/auditoria")
def auditoria(
    entidade: str | None = None,
    acao: str | None = None,
    limit: int = Query(
        default=50,
        ge=1,
        le=500,
    ),
    _: User = Depends(
        dep_permissao("admin.auditoria.visualizar")
    ),
    db: Session = Depends(get_db),
):
    stmt = select(
        AuditoriaERP
    )

    if entidade:
        stmt = stmt.where(
            AuditoriaERP.entidade
            == entidade
        )

    if acao:
        stmt = stmt.where(
            AuditoriaERP.acao
            == acao
        )

    itens = db.scalars(
        stmt
        .order_by(
            AuditoriaERP.created_date.desc()
        )
        .limit(limit)
    ).all()

    return [
        _audit_publico(item)
        for item in itens
    ]


@router.get("/backups")
def backups(
    _: User = Depends(
        dep_permissao("admin.backups.visualizar")
    ),
):
    return {
        "diretorio":
            str(BACKUP_DIR),
        "retencao":
            30,
        "itens":
            listar_backups(),
    }


@router.post("/backup")
def backup_manual(
    current_user: User = Depends(
        dep_permissao("admin.backups.criar")
    ),
    db: Session = Depends(get_db),
):
    resultado = (
        criar_backup(
            origem="manual"
        )
    )

    registrar_auditoria(
        db,
        usuario=current_user,
        acao="backup",
        entidade="Sistema",
        detalhe=(
            "Backup manual criado."
        ),
        depois={
            "nome":
                resultado["nome"],
            "tamanho_bytes":
                resultado[
                    "tamanho_bytes"
                ],
        },
    )

    db.commit()

    return resultado


@router.post(
    "/backups/{nome}/verificar"
)
def validar_backup(
    nome: str,
    current_user: User = Depends(
        dep_permissao("admin.backups.verificar")
    ),
    db: Session = Depends(get_db),
):
    resultado = (
        verificar_backup(
            nome
        )
    )

    registrar_auditoria(
        db,
        usuario=current_user,
        acao="verificar_backup",
        entidade="Sistema",
        detalhe=(
            f"Backup validado: {nome}"
        ),
        depois=resultado,
    )

    db.commit()

    return resultado
