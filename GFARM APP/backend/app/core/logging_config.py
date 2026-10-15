from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


DATA_ROOT = (
    Path.home()
    / "Documents"
    / "INDEX ERP DATA"
)

LOG_DIR = DATA_ROOT / "logs"
LOG_FILE = LOG_DIR / "backend.log"


def configurar_logging() -> Path:
    LOG_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    root = logging.getLogger()

    ja_configurado = any(
        isinstance(
            handler,
            RotatingFileHandler,
        )
        and getattr(
            handler,
            "baseFilename",
            "",
        ) == str(LOG_FILE)
        for handler in root.handlers
    )

    if not ja_configurado:
        handler = RotatingFileHandler(
            LOG_FILE,
            maxBytes=5 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )

        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s | "
                "%(levelname)s | "
                "%(name)s | "
                "%(message)s"
            )
        )

        root.addHandler(
            handler
        )

    if root.level > logging.INFO:
        root.setLevel(
            logging.INFO
        )

    return LOG_FILE
