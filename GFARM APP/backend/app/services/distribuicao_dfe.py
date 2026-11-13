"""Central fiscal silenciosa de NF-e (distNSU) -- sem UI e SEM teste na SEFAZ.

Somente com GFARM_DFE_ENABLED=1 e certificado A1 (.pfx) privado disponivel
no container. Nao envia Ciencia da Operacao, manifestacao, ou entradas de
estoque. Mantem NSU separado por CPF/CNPJ, cache completo/resumo e cooldown.
"""
from __future__ import annotations

import base64
import binascii
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import ssl
import tempfile
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET
import zlib

from sqlalchemy import text

from app.db.database import SessionLocal, engine
from app.services.custo_nfe import (
    DadosFiscaisIncompativeis,
    extrair_custo_xml,
)

logger = logging.getLogger(__name__)

URL_PRODUCAO = (
    "https://www1.nfe.fazenda.gov.br/"
    "NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx"
)
NS_NFE = "http://www.portalfiscal.inf.br/nfe"
NS_WS = NS_NFE + "/wsdl/NFeDistribuicaoDFe"
NS_SOAP = "http://www.w3.org/2003/05/soap-envelope"
MAX_RESPOSTA = 10 * 1024 * 1024
MAX_DOCUMENTO = 3 * 1024 * 1024
INTERVALO_SEM_NOTAS = timedelta(minutes=65)
INTERVALO_BLOQUEIO = timedelta(minutes=125)
INTERVALO_PROXIMO_LOTE = timedelta(minutes=3)
INTERVALO_ERRO = timedelta(minutes=35)


def habilitada() -> bool:
    return os.getenv("GFARM_DFE_ENABLED", "").strip() == "1"


def _configuracoes():
    """Suporta varios titulares CPF/CNPJ sem senha ou certificado no Git.

    Perfil unico GFARM_DFE_CPF ou GFARM_DFE_CNPJ.
    Multiplos via GFARM_DFE_PROFILES, cada qual com cpf OU cnpj,
    cuf, cert_path e password_file.
    """
    profiles_raw = os.getenv("GFARM_DFE_PROFILES", "").strip()
    if profiles_raw:
        try:
            profiles = json.loads(profiles_raw)
        except (TypeError, ValueError):
            logger.error("Central fiscal: perfis invalidos; sincronizacao desativada.")
            return []
        if not isinstance(profiles, list):
            return []
    else:
        profiles = [{
            "cnpj": os.getenv("GFARM_DFE_CNPJ", ""),
            "cpf": os.getenv("GFARM_DFE_CPF", ""),
            "cuf": os.getenv("GFARM_DFE_CUF", ""),
            "cert_path": os.getenv("GFARM_DFE_CERT_PFX", ""),
            "password_env": "GFARM_DFE_CERT_PASSWORD",
            "password_file": os.getenv("GFARM_DFE_CERT_PASSWORD_FILE", ""),
        }]
    result = []
    seen = set()
    for p in profiles:
        if not isinstance(p, dict):
            continue
        cnpj = str(p.get("cnpj", "")).strip()
        cpf = str(p.get("cpf", "")).strip()
        # Exatamente um interessado por perfil; nunca compartilhar NSU.
        identificador_valido = (
            bool(re.fullmatch(r"\d{14}", cnpj)) != bool(re.fullmatch(r"\d{11}", cpf))
            and not (cnpj and cpf)
        )
        interessado = cpf or cnpj
        cuf = str(p.get("cuf", "")).strip()
        path = str(p.get("cert_path", "")).strip()
        key = str(p.get("password_env", "")).strip()
        password_file = str(p.get("password_file", "")).strip()
        tem_senha = (
            bool(password_file and Path(password_file).is_file())
            or bool(key and key in os.environ)
        )
        if (not identificador_valido
                or not re.fullmatch(r"\d{2}", cuf)
                or not path or not Path(path).is_file()
                or not tem_senha
                or interessado in seen):
            logger.warning(
                "Central fiscal: perfil incompleto; nao sera consultado."
            )
            continue
        seen.add(interessado)
        result.append({
            "cnpj": cnpj, "cpf": cpf, "interessado": interessado,
            "cuf": cuf, "cert_path": path, "password_env": key,
            "password_file": password_file,
        })
    return result


def garantir_tabelas_dfe(*, forcar=False):
    """Somente tabelas NOVAS; nunca altera o legado de estoque/recebimentos."""
    if not forcar and not habilitada():
        return
    with engine.begin() as db:
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS gfarm_dfe_cursores (
                cnpj VARCHAR(14) PRIMARY KEY,
                ult_nsu BIGINT NOT NULL DEFAULT 0,
                max_nsu BIGINT NOT NULL DEFAULT 0,
                proxima_consulta TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ultimo_status VARCHAR(10),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS gfarm_dfe_documentos (
                cnpj VARCHAR(14) NOT NULL,
                nsu BIGINT NOT NULL,
                chave VARCHAR(44),
                tipo VARCHAR(16) NOT NULL,
                schema_xml VARCHAR(120),
                conteudo_xml BYTEA NOT NULL,
                sha256 VARCHAR(64) NOT NULL,
                recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (cnpj, nsu)
            )
        """))
        db.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_gfarm_dfe_documentos_chave
            ON gfarm_dfe_documentos (chave, tipo)
        """))
        # Tabelas isoladas dos CPFs: sem migrar/regravar documentos ou
        # cursores CNPJ existentes e sem tocar nas tabelas do estoque.
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS gfarm_dfe_cursores_pf (
                cpf VARCHAR(11) PRIMARY KEY,
                ult_nsu BIGINT NOT NULL DEFAULT 0,
                max_nsu BIGINT NOT NULL DEFAULT 0,
                proxima_consulta TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ultimo_status VARCHAR(10),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS gfarm_dfe_documentos_pf (
                cpf VARCHAR(11) NOT NULL,
                nsu BIGINT NOT NULL,
                chave VARCHAR(44),
                tipo VARCHAR(16) NOT NULL,
                schema_xml VARCHAR(120),
                conteudo_xml BYTEA NOT NULL,
                sha256 VARCHAR(64) NOT NULL,
                recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (cpf, nsu)
            )
        """))
        db.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_gfarm_dfe_documentos_pf_chave
            ON gfarm_dfe_documentos_pf (chave, tipo)
        """))


@contextmanager
def _ssl_contexto_a1(perfil):
    """Decodifica PFX so em memoria e apaga PEM temporario apos load_cert_chain."""
    from cryptography.hazmat.primitives.serialization import (
        Encoding, NoEncryption, PrivateFormat, pkcs12,
    )
    cert_pfx = Path(perfil["cert_path"])
    data = cert_pfx.read_bytes()
    if len(data) > 1024 * 1024:
        raise ValueError("Certificado A1 excede tamanho esperado.")
    password_file = perfil.get("password_file")
    if password_file:
        # Senha em volume privado (0600), nao no Docker inspect nem no Git.
        password = Path(password_file).read_bytes()
        if len(password) > 4096:
            raise ValueError("Arquivo de senha A1 invalido.")
    else:
        password = os.environ[perfil["password_env"]].encode("utf-8")
    private, cert, intermediarios = pkcs12.load_key_and_certificates(
        data, password if password else None
    )
    if private is None or cert is None:
        raise ValueError("Certificado A1 sem chave privada e certificado.")
    agora = datetime.now(timezone.utc)
    if cert.not_valid_after_utc <= agora or cert.not_valid_before_utc > agora:
        raise ValueError("Certificado A1 expirado ou ainda nao valido.")

    contexto = ssl.create_default_context()
    with tempfile.TemporaryDirectory(prefix="gfarm-dfe-") as diretorio:
        chave = Path(diretorio) / "chave.pem"
        certificado = Path(diretorio) / "certificado.pem"
        for destino, conteudo in (
            (chave, private.private_bytes(
                Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()
            )),
            (certificado, cert.public_bytes(Encoding.PEM) + b"".join(
                item.public_bytes(Encoding.PEM) for item in intermediarios or []
            )),
        ):
            fd = os.open(str(destino), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as arquivo:
                arquivo.write(conteudo)
        contexto.load_cert_chain(str(certificado), str(chave))
    yield contexto


def _envelope(interessado: str, cuf: str, ult_nsu: int) -> bytes:
    if not re.fullmatch(r"\d{11}|\d{14}", interessado):
        raise ValueError("Identificador fiscal deve conter 11 ou 14 digitos.")
    # A versao do schema distDFeInt continua 1.01; NT 2014.002 pode
    # atualizar as regras sem alterar essa versao de mensagem.
    soap = ET.Element(f"{{{NS_SOAP}}}Envelope")
    body = ET.SubElement(soap, f"{{{NS_SOAP}}}Body")
    method = ET.SubElement(body, f"{{{NS_WS}}}nfeDistDFeInteresse")
    msg = ET.SubElement(method, f"{{{NS_WS}}}nfeDadosMsg")
    dist = ET.SubElement(msg, f"{{{NS_NFE}}}distDFeInt", versao="1.01")
    ET.SubElement(dist, f"{{{NS_NFE}}}tpAmb").text = "1"
    ET.SubElement(dist, f"{{{NS_NFE}}}cUFAutor").text = cuf
    campo = "CPF" if len(interessado) == 11 else "CNPJ"
    ET.SubElement(dist, f"{{{NS_NFE}}}{campo}").text = interessado
    dn = ET.SubElement(dist, f"{{{NS_NFE}}}distNSU")
    ET.SubElement(dn, f"{{{NS_NFE}}}ultNSU").text = f"{ult_nsu:015d}"
    return ET.tostring(soap, encoding="utf-8", xml_declaration=True)


def _xml_seguro(dados: bytes):
    if not dados or len(dados) > MAX_RESPOSTA:
        raise ValueError("XML vazio ou grande demais.")
    if b"<!DOCTYPE" in dados.upper() or b"<!ENTITY" in dados.upper():
        raise ValueError("XML com entidade externa proibida.")
    return ET.fromstring(dados)


def _texto(parent, name):
    node = parent.find(f"{{{NS_NFE}}}{name}")
    return node.text.strip() if node is not None and node.text else ""


def _descompactar(base64_gzip: str) -> bytes:
    pacote = base64.b64decode(base64_gzip.encode("ascii"), validate=True)
    if len(pacote) > MAX_DOCUMENTO:
        raise ValueError("docZip comprimido acima do limite.")
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
    data = decoder.decompress(pacote, MAX_DOCUMENTO + 1)
    if len(data) > MAX_DOCUMENTO or decoder.unconsumed_tail:
        raise ValueError("docZip descompactado acima do limite.")
    data += decoder.flush(MAX_DOCUMENTO + 1 - len(data))
    if not decoder.eof or len(data) > MAX_DOCUMENTO:
        raise ValueError("docZip corrompido ou acima do limite.")
    _xml_seguro(data)
    return data


def _chave_nfe(xml: bytes) -> tuple[str, str]:
    """Retorna (chave, tipo); apenas NF-e completa contem itens fiscais."""
    root = _xml_seguro(xml)
    nome = root.tag.rsplit("}", 1)[-1]
    if nome == "resNFe":
        chave = _texto(root, "chNFe")
        tipo = "resumo"
    elif nome in ("nfeProc", "NFe"):
        info = root.find(f".//{{{NS_NFE}}}infNFe")
        chave = (info.attrib.get("Id", "")[3:] if info is not None
                 else "")
        tipo = "completo"
    else:
        return "", "outro"  # eventos e outros documentos sao arquivados
    return (chave if re.fullmatch(r"\d{44}", chave) else ""), tipo


def _destinatario_valido(xml: bytes, interessado: str) -> bool:
    root = _xml_seguro(xml)
    dest = root.find(f".//{{{NS_NFE}}}dest")
    if dest is None:
        return False
    campo = "CPF" if len(interessado) == 11 else "CNPJ"
    return _texto(dest, campo) == interessado


def _consultar_sefaz(perfil, nsu: int):
    payload = _envelope(perfil["interessado"], perfil["cuf"], nsu)
    with _ssl_contexto_a1(perfil) as contexto:
        req = Request(
            URL_PRODUCAO, data=payload,
            headers={
                "Content-Type": (
                    'application/soap+xml; charset=utf-8; action="'
                    f'{NS_WS}/nfeDistDFeInteresse"'
                ),
                "User-Agent": "GFARM-DistribuicaoDFe/1.0",
            }, method="POST",
        )
        with urlopen(req, context=contexto, timeout=25) as resposta:
            corpo = resposta.read(MAX_RESPOSTA + 1)
    root = _xml_seguro(corpo)
    ret = root.find(f".//{{{NS_NFE}}}retDistDFeInt")
    if ret is None:
        raise ValueError("Retorno sem retDistDFeInt.")
    status = _texto(ret, "cStat")
    novo_nsu = _texto(ret, "ultNSU")
    max_nsu = _texto(ret, "maxNSU")
    if status in ("137", "138"):
        if not (novo_nsu.isdigit() and max_nsu.isdigit()):
            raise ValueError("Resposta sem ultNSU/maxNSU validos.")
        novo_num = int(novo_nsu)
        max_num = int(max_nsu)
        if novo_num < nsu or max_num < novo_num:
            raise ValueError("Retorno de NSU regressivo/inconsistente.")
    else:
        novo_num, max_num = nsu, nsu
    doczips = []
    if status == "138":
        for doc in ret.findall(f".//{{{NS_NFE}}}docZip"):
            valor = (doc.text or "").strip()
            if not valor:
                continue
            n = doc.attrib.get("NSU", "")
            if not n.isdigit():
                raise ValueError("docZip sem NSU valido.")
            xml = _descompactar(valor)
            chave, tipo = _chave_nfe(xml)
            doczips.append({
                "nsu": int(n),
                "chave": chave,
                "tipo": tipo,
                "schema": doc.attrib.get("schema", "")[:120],
                "xml": xml,
            })
    return status, novo_num, max_num, doczips


def _preencher_pendencias(db, chave: str, xml: bytes):
    """Associa dados fiscais ao recebimento, NUNCA aprova ou movimenta saldo."""
    if not chave:
        return 0
    # Importacao local de helper para evitar dependencia circular no startup.
    from app.api.integracao_recebimentos import _chave_quantidade_fiscal
    rows = db.execute(text("""
        SELECT origem_id, dados
          FROM integracao_recebimentos_pendentes
         WHERE status='PENDENTE' AND dados->>'chave_acesso'=:chave
         FOR UPDATE
    """), {"chave": chave}).mappings().all()
    if not rows:
        return 0
    quantidades = Counter(
        k for row in rows
        if (k := _chave_quantidade_fiscal(row["dados"])) is not None
    )
    xml_b64 = base64.b64encode(xml).decode("ascii")
    atualizados = 0
    for row in rows:
        try:
            k = _chave_quantidade_fiscal(row["dados"])
            fiscal = extrair_custo_xml(
                xml_b64, row["dados"],
                permitir_correspondencia_quantidade=bool(
                    k and quantidades[k] == 1
                ),
                permitir_item_unico=len(rows) == 1,
            )
        except DadosFiscaisIncompativeis:
            continue  # produto ambiguo: mantem pendente, sem inventar valor
        payload = {**row["dados"], **fiscal}
        db.execute(text("""
            UPDATE integracao_recebimentos_pendentes
               SET dados=CAST(:dados AS JSONB), atualizado_em=NOW()
             WHERE origem_id=:origem AND status='PENDENTE'
        """), {
            "origem": row["origem_id"],
            "dados": json.dumps(payload, ensure_ascii=False),
        })
        atualizados += 1
    return atualizados


def aplicar_cache_a_nota_pendente(db, chave: str) -> int:
    """Chamado apos chegada de pendencia do Controles, sem chamar a SEFAZ."""
    if not re.fullmatch(r"\d{44}", chave or ""):
        return 0
    # O modo manual cria as tabelas na primeira sincronizacao; em
    # instalacoes antigas sem cache, nao consulta tabelas inexistentes.
    if not habilitada() and not db.scalar(text(
        "SELECT to_regclass('gfarm_dfe_documentos_pf') IS NOT NULL"
    )):
        return 0
    rows = db.execute(text("""
        SELECT conteudo_xml, cnpj AS interessado, recebido_em
          FROM gfarm_dfe_documentos
         WHERE chave=:chave AND tipo='completo'
        UNION ALL
        SELECT conteudo_xml, cpf AS interessado, recebido_em
          FROM gfarm_dfe_documentos_pf
         WHERE chave=:chave AND tipo='completo'
         ORDER BY recebido_em DESC LIMIT 20
    """), {"chave": chave}).mappings().all()
    for row in rows:
        xml = bytes(row["conteudo_xml"])
        if _destinatario_valido(xml, row["interessado"]):
            return _preencher_pendencias(db, chave, xml)
    return 0


def _executar_perfil(db, perfil):
    """Uma consulta por ciclo/interessado; NSU independente por CPF/CNPJ."""
    interessado = perfil["interessado"]
    pf = bool(perfil["cpf"])
    tabela_cursor = "gfarm_dfe_cursores_pf" if pf else "gfarm_dfe_cursores"
    tabela_documentos = "gfarm_dfe_documentos_pf" if pf else "gfarm_dfe_documentos"
    coluna = "cpf" if pf else "cnpj"
    # Identificadores SQL acima sao constantes internas, nao entradas HTTP.
    db.execute(text(f"""
        INSERT INTO {tabela_cursor} ({coluna})
        VALUES (:interessado) ON CONFLICT ({coluna}) DO NOTHING
    """), {"interessado": interessado})
    estado = db.execute(text(f"""
        SELECT ult_nsu, max_nsu
          FROM {tabela_cursor}
         WHERE {coluna}=:interessado AND proxima_consulta <= NOW()
         FOR UPDATE SKIP LOCKED
    """), {"interessado": interessado}).mappings().first()
    if estado is None:
        return 0  # aguardando cooldown ou consulta concorrente
    atual_nsu = int(estado["ult_nsu"])
    agora = datetime.now(timezone.utc)
    try:
        status, ult_nsu, max_nsu, documentos = _consultar_sefaz(
            perfil, atual_nsu
        )
    except Exception as exc:
        # Nunca expor certificado, senha, resposta SOAP nem XML nos logs.
        logger.warning("Central fiscal: falha na consulta do titular final %s: %s",
                       interessado[-4:], type(exc).__name__)
        status, ult_nsu, max_nsu, documentos = (
            "ERRO", atual_nsu, int(estado["max_nsu"]), []
        )

    if status == "138":
        proxima = (
            INTERVALO_SEM_NOTAS if ult_nsu >= max_nsu
            else INTERVALO_PROXIMO_LOTE
        )
    elif status == "656":
        proxima = INTERVALO_BLOQUEIO
    elif status == "137":
        proxima = INTERVALO_SEM_NOTAS
    else:
        proxima = INTERVALO_ERRO

    preenchidos = 0
    if status == "138":
        for doc in documentos:
            # Dados fiscalmente sensiveis ficam apenas no PostgreSQL privado.
            db.execute(text(f"""
                INSERT INTO {tabela_documentos}
                    ({coluna}, nsu, chave, tipo, schema_xml, conteudo_xml, sha256)
                VALUES
                    (:interessado, :nsu, :chave, :tipo, :schema, :conteudo, :hash)
                ON CONFLICT ({coluna}, nsu) DO NOTHING
            """), {
                "interessado": interessado,
                "nsu": doc["nsu"],
                "chave": doc["chave"] or None,
                "tipo": doc["tipo"],
                "schema": doc["schema"],
                "conteudo": doc["xml"],
                "hash": hashlib.sha256(doc["xml"]).hexdigest(),
            })
            if (doc["tipo"] == "completo" and doc["chave"]
                    and _destinatario_valido(doc["xml"], interessado)):
                preenchidos += _preencher_pendencias(
                    db, doc["chave"], doc["xml"]
                )

    db.execute(text(f"""
        UPDATE {tabela_cursor}
           SET ult_nsu=:ult, max_nsu=:max, ultimo_status=:status,
               proxima_consulta=:proxima, atualizado_em=NOW()
         WHERE {coluna}=:interessado
    """), {
        "interessado": interessado, "ult": ult_nsu, "max": max_nsu,
        "status": status, "proxima": agora + proxima,
    })
    logger.info(
        "Central fiscal %s: status %s; %s documentos cacheados; "
        "%s pendencias preenchidas; proximo ciclo apos intervalo.",
        interessado[-4:], status, len(documentos), preenchidos,
    )
    return len(documentos)


def executar_sincronizacao_silenciosa():
    """Agendador passivo: NUNCA roda sem habilitacao + A1 legivel."""
    if not habilitada():
        return
    try:
        perfis = _configuracoes()
        if not perfis:
            return
        for perfil in perfis:
            with SessionLocal() as db:
                try:
                    with db.begin():
                        _executar_perfil(db, perfil)
                except Exception:
                    # Falha de uma empresa nao interfere nas demais.
                    db.rollback()
                    logger.exception(
                        "Central fiscal: erro interno no titular final %s",
                        perfil["interessado"][-4:],
                    )
    except Exception:
        logger.exception("Central fiscal: agendamento indisponivel.")
