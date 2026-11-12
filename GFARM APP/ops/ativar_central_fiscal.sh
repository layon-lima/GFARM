#!/usr/bin/env bash
# Ativacao A1 da Central Fiscal do GFARM. Sem consultas SEFAZ de teste.
set -Eeuo pipefail
umask 077
if [[ "$(id -u)" != "0" ]]; then echo "Execute como root." >&2; exit 1; fi
ROOT="/opt/apps/gfarm/source"
APP="$ROOT/GFARM APP"
ENV="$APP/backend/.env"
COMPOSE="$APP/deploy/cloud/compose.yml"
CONTAINER="gfarm-app-1"
ENTRADA="/root/gfarm-dfe-a1.pfx"
if [[ $# -ge 1 ]]; then ENTRADA="$1"; fi
DESTINO_DIR="/home/estq/Documents/INDEX ERP DATA/certificados"
compose() {
  docker compose -p gfarm --env-file backend/.env -f deploy/cloud/compose.yml "$@"
}

if [[ ! -f "$ENV" || ! -f "$COMPOSE" ]]; then
  echo "Nao encontrei o GFARM em $ROOT." >&2; exit 1
fi
if [[ ! -f "$ENTRADA" || -L "$ENTRADA" || ! -s "$ENTRADA" ]]; then
  echo "Nao encontrei arquivo A1 valido em $ENTRADA." >&2
  echo "Envie .pfx/.p12 do Windows por SCP antes de executar." >&2
  exit 1
fi
if ! command -v openssl >/dev/null; then
  echo "openssl indisponivel na VPS: ativacao cancelada." >&2; exit 1
fi
if ! docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "O container do GFARM nao foi encontrado. Atualize o app antes." >&2; exit 1
fi

echo "=== ATIVAR CENTRAL FISCAL SILENCIOSA GFARM ==="
read -r -p "CNPJ destinatario (14 digitos): " CNPJ
if [[ ! "$CNPJ" =~ ^[0-9]{14}$ ]]; then
  echo "CNPJ invalido: informe 14 digitos." >&2; exit 1
fi
read -r -p "UF (codigo IBGE, por exemplo MA=21): " CUF
if [[ ! "$CUF" =~ ^[0-9]{2}$ ]]; then
  echo "UF invalida: informe dois digitos." >&2; exit 1
fi
read -r -s -p "Senha do certificado A1 (oculta): " PASSWORD
echo
# Verificacao LOCAL do PFX, sem acessar a SEFAZ.
if ! ( openssl pkcs12 -in "$ENTRADA" -nocerts -nodes \
          -passin fd:3 3<<<"$PASSWORD" 2>/dev/null | grep "PRIVATE KEY" >/dev/null ); then
  echo "A1 sem chave privada exportavel ou senha incorreta." >&2
  exit 1
fi
if ! ( openssl pkcs12 -in "$ENTRADA" -clcerts -nokeys \
          -passin fd:3 3<<<"$PASSWORD" 2>/dev/null |
       openssl x509 -noout -checkend 0 >/dev/null 2>&1 ); then
  echo "Certificado A1 invalido ou expirado." >&2
  exit 1
fi

PFX_CONTAINER="$DESTINO_DIR/$CNPJ.pfx"
PASS_CONTAINER="$DESTINO_DIR/$CNPJ.pass"
echo "[1/4] Copiando A1 e senha para volume privado do GFARM..."
docker exec -u root "$CONTAINER" mkdir -p "$DESTINO_DIR"
docker exec -u root "$CONTAINER" chown estq:estq "$DESTINO_DIR"
docker exec -u root "$CONTAINER" chmod 700 "$DESTINO_DIR"
docker cp "$ENTRADA" "$CONTAINER:$PFX_CONTAINER"
docker exec -u root "$CONTAINER" chown estq:estq "$PFX_CONTAINER"
docker exec -u root "$CONTAINER" chmod 600 "$PFX_CONTAINER"
# A senha trafega por STDIN, nunca argumento, Docker inspect ou .env.
printf '%s' "$PASSWORD" |
  docker exec -i -u estq "$CONTAINER" sh -c \
    'umask 077; cat > "$1"' sh "$PASS_CONTAINER"
unset PASSWORD
docker exec -u estq "$CONTAINER" test -r "$PFX_CONTAINER"
docker exec -u estq "$CONTAINER" test -r "$PASS_CONTAINER"

echo "[2/4] Salvando configuracao no .env privado..."
BACKUP="/root/gfarm-env-before-dfe-$(date +%Y%m%d-%H%M%S).bak"
cp -p "$ENV" "$BACKUP"
chmod 600 "$BACKUP"
python3 - "$ENV" "$CNPJ" "$CUF" "$PFX_CONTAINER" "$PASS_CONTAINER" <<'PY'
import re
import sys
import json
from pathlib import Path
target = Path(sys.argv[1])
cnpj, cuf, cert, senha = sys.argv[2:]
original = target.read_text(encoding="utf-8-sig")
# Preserva todos os CNPJs ja instalados. Reexecutar adiciona outro A1.
config = {}
for linha in original.splitlines():
    achou = re.match(r"^\s*(GFARM_DFE_[A-Z_]+)\s*=\s*(.*)$", linha)
    if achou:
        valor = achou.group(2).strip()
        config[achou.group(1)] = valor[1:-1] if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in ("'", '"') else valor
perfis = []
if config.get("GFARM_DFE_PROFILES"):
    try:
        perfis = json.loads(config["GFARM_DFE_PROFILES"])
        if not isinstance(perfis, list):
            raise ValueError("A lista de certificados nao e valida.")
    except ValueError as exc:
        raise SystemExit("Erro lendo perfis existentes; .env foi preservado.") from exc
elif config.get("GFARM_DFE_CNPJ"):
    velho = {
        "cnpj": config["GFARM_DFE_CNPJ"],
        "cuf": config.get("GFARM_DFE_CUF", ""),
        "cert_path": config.get("GFARM_DFE_CERT_PFX", ""),
        "password_file": config.get("GFARM_DFE_CERT_PASSWORD_FILE", ""),
    }
    if velho["password_file"] and velho["cert_path"]:
        perfis.append(velho)
novo = {"cnpj": cnpj, "cuf": cuf, "cert_path": cert, "password_file": senha}
perfis = [p for p in perfis if p.get("cnpj") != cnpj] + [novo]
profile_json = json.dumps(perfis, ensure_ascii=False, separators=(",", ":"))
chaves = {
    "GFARM_DFE_ENABLED": "1",
    "GFARM_DFE_PROFILES": "'" + profile_json + "'",
}
linhas = [
    linha for linha in original.splitlines()
    if not re.match(r"^\s*GFARM_DFE_(?:ENABLED|PROFILES|CNPJ|CUF|CERT_PFX|CERT_PASSWORD_FILE|CERT_PASSWORD)\s*=", linha)
]
linhas.extend(f"{key}={value}" for key, value in chaves.items())
target.write_text("\n".join(linhas) + "\n", encoding="utf-8")
target.chmod(0o600)
PY

cd "$APP"
echo "[3/4] Validando configuracao local, sem SEFAZ..."
if ! compose config --quiet; then
  cp -p "$BACKUP" "$ENV"
  echo "Configuracao invalida; .env anterior restaurado." >&2
  exit 1
fi

echo "[4/4] Atualizando somente app e ativando sincronizacao silenciosa..."
if ! compose up -d --no-deps --build --wait app; then
  cp -p "$BACKUP" "$ENV"
  compose up -d --no-deps --wait app || true
  echo "Falha na atualizacao; .env anterior restaurado." >&2
  exit 1
fi

echo "CENTRAL FISCAL ATIVADA com certificado do CNPJ informado."
echo "Sincronizacao de XML por NSU em segundo plano, sem formulario."
echo "Notas PENDENTES serao preenchidas se XML completo for liberado."
echo "Resumo NF-e nao contem itens; sem XML completo nao ha preco a preencher."
echo "Nao houve consulta SEFAZ de teste neste instalador."
echo "Para outro CNPJ A1: envie outro PFX e execute este instalador novamente."
echo "Acompanhar (logs locais):"
echo "  docker logs --since 30m gfarm-app-1 2>&1 | grep 'Central fiscal'"
echo "Backup privado da configuracao anterior: $BACKUP"
