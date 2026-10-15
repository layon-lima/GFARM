import logging

from apscheduler.schedulers.background import (
    BackgroundScheduler,
)

from app.db.database import SessionLocal
from app.services.backup_erp import (
    criar_backup,
)
from app.services.consistencia_estoque import (
    verificar_consistencia_estoque,
)
from app.services.nfe_ticket_watcher import (
    processar_pasta_nfe_tickets,
)


logger = logging.getLogger(
    __name__
)

scheduler = BackgroundScheduler(
    timezone="America/Sao_Paulo"
)


def executar_verificacao_automatica():
    db = SessionLocal()

    try:
        resultado = (
            verificar_consistencia_estoque(
                db
            )
        )

        logger.info(
            (
                "Estoque: %s divergência(s), "
                "%s saldo(s) negativo(s), "
                "%s reserva(s) inválida(s)."
            ),
            resultado[
                "produtos_com_divergencia"
            ],
            resultado[
                "saldos_negativos"
            ],
            resultado[
                "reservas_invalidas"
            ],
        )

    except Exception:
        db.rollback()

        logger.exception(
            "Erro na verificação automática."
        )

    finally:
        db.close()


def executar_backup_automatico():
    try:
        resultado = (
            criar_backup(
                origem="automatico"
            )
        )

        logger.info(
            "Backup automático: %s",
            resultado["nome"],
        )

    except Exception:
        logger.exception(
            "Erro no backup automático."
        )


def iniciar_agendador():
    if scheduler.running:
        return

    scheduler.add_job(
        executar_verificacao_automatica,
        trigger="cron",
        minute=0,
        id=(
            "verificacao_"
            "consistencia_estoque"
        ),
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )

    scheduler.add_job(
        processar_pasta_nfe_tickets,
        trigger="interval",
        seconds=2,
        id=(
            "monitor_xml_"
            "nfe_tickets"
        ),
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )

    scheduler.add_job(
        executar_backup_automatico,
        trigger="cron",
        hour=2,
        minute=30,
        id="backup_erp_diario",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=(
            6 * 60 * 60
        ),
    )

    scheduler.start()


def parar_agendador():
    if scheduler.running:
        scheduler.shutdown(
            wait=False
        )
