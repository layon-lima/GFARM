from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
)

from app.api.auth import get_current_user
from app.models import User


router = APIRouter(
    prefix="/api/files",
    tags=["Arquivos"],
)


UPLOAD_DIR = (
    Path(__file__).resolve()
    .parents[2]
    / "uploads"
)

UPLOAD_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


MAX_UPLOAD_BYTES = (
    50 * 1024 * 1024
)

CHUNK_SIZE = (
    1024 * 1024
)


ALLOWED_TYPES = {
    ".jpg": {
        "image/jpeg",
        "image/pjpeg",
    },
    ".jpeg": {
        "image/jpeg",
        "image/pjpeg",
    },
    ".png": {
        "image/png",
    },
    ".webp": {
        "image/webp",
    },
    ".gif": {
        "image/gif",
    },
    ".heic": {
        "image/heic",
        "image/heif",
        "application/octet-stream",
    },
    ".heif": {
        "image/heic",
        "image/heif",
        "application/octet-stream",
    },
    ".pdf": {
        "application/pdf",
    },
    ".xls": {
        "application/vnd.ms-excel",
        "application/octet-stream",
    },
    ".xlsx": {
        (
            "application/vnd.openxmlformats-"
            "officedocument.spreadsheetml.sheet"
        ),
        "application/octet-stream",
    },
    ".csv": {
        "text/csv",
        "application/csv",
        "text/plain",
        "application/vnd.ms-excel",
    },
}


def _validar_tipo(
    file: UploadFile,
) -> str:
    extensao = Path(
        file.filename or ""
    ).suffix.lower()

    if (
        extensao
        not in ALLOWED_TYPES
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Tipo de arquivo não permitido. "
                "Use imagem, PDF, XLS/XLSX ou CSV."
            ),
        )

    content_type = (
        file.content_type or ""
    ).lower().strip()

    if (
        content_type
        and content_type
        not in ALLOWED_TYPES[
            extensao
        ]
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "O conteúdo informado não "
                "corresponde ao tipo de "
                "arquivo permitido."
            ),
        )

    return extensao


def _assinatura_valida(
    extensao: str,
    inicio: bytes,
) -> bool:
    if extensao in {
        ".jpg",
        ".jpeg",
    }:
        return inicio.startswith(
            b"\xff\xd8\xff"
        )

    if extensao == ".png":
        return inicio.startswith(
            b"\x89PNG\r\n\x1a\n"
        )

    if extensao == ".gif":
        return (
            inicio.startswith(
                b"GIF87a"
            )
            or inicio.startswith(
                b"GIF89a"
            )
        )

    if extensao == ".webp":
        return (
            len(inicio) >= 12
            and inicio[:4] == b"RIFF"
            and inicio[8:12]
            == b"WEBP"
        )

    if extensao == ".pdf":
        return inicio.startswith(
            b"%PDF-"
        )

    # HEIC/HEIF e planilhas podem ter
    # estruturas variadas. Para elas,
    # extensão + MIME já foram validados.
    return True


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    _: User = Depends(
        get_current_user
    ),
):
    extensao = _validar_tipo(
        file
    )

    nome_arquivo = (
        f"{uuid4()}{extensao}"
    )

    destino = (
        UPLOAD_DIR
        / nome_arquivo
    )

    total = 0
    inicio = b""

    try:
        with destino.open("wb") as out:
            while True:
                chunk = await file.read(
                    CHUNK_SIZE
                )

                if not chunk:
                    break

                if not inicio:
                    inicio = (
                        chunk[:32]
                    )

                total += len(chunk)

                if (
                    total
                    > MAX_UPLOAD_BYTES
                ):
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            "Arquivo muito grande. "
                            "Limite: 50 MB."
                        ),
                    )

                out.write(chunk)

        if total <= 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Arquivo vazio."
                ),
            )

        if not _assinatura_valida(
            extensao,
            inicio,
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Conteúdo do arquivo "
                    "inválido para a extensão "
                    "informada."
                ),
            )

    except Exception:
        destino.unlink(
            missing_ok=True
        )
        raise

    finally:
        await file.close()

    # URL relativa funciona tanto no computador quanto em celulares na rede.
    # Uma URL absoluta gravaria o host usado no upload (muitas vezes
    # localhost), tornando a imagem inacessível nos outros dispositivos.
    file_url = f"/uploads/{nome_arquivo}"

    return {
        "file_url": file_url,
        "filename": nome_arquivo,
        "size_bytes": total,
    }
