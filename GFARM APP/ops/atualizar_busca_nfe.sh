#!/usr/bin/env bash
# Atualizacao verificada da UI de NF-e do GFARM. Volumes e bancos preservados.
set -Eeuo pipefail
if [[ $(id -u) -ne 0 ]]; then echo 'Execute como root' >&2; exit 1; fi
ROOT='/opt/apps/gfarm/source'
cd "$ROOT"
echo '[1/5] Atualizando o codigo...'
git pull --ff-only origin main
APP="$ROOT/GFARM APP"
grep -Fq 'Busca inteligente v2' "$APP/src/pages/RecebimentosPendentes.jsx" || { echo 'Versao nova ausente' >&2; exit 1; }
cd "$APP"
COMPOSE=(docker compose -p gfarm --env-file backend/.env -f deploy/cloud/compose.yml)
echo '[2/5] Validando configuracao sem alterar banco...'
"${COMPOSE[@]}" config --quiet
echo '[3/5] Atualizando somente o app (sem dependencias)...'
"${COMPOSE[@]}" up -d --no-deps --build --wait app
echo '[4/5] Conferindo bundle servido no container...'
docker exec gfarm-app-1 sh -c "grep -Fql 'Busca inteligente v2' /app/dist/assets/*.js" || { echo 'ERRO: interface antiga no container' >&2; exit 1; }
docker exec gfarm-app-1 sh -c "grep -Fql 'Identificado automaticamente' /app/dist/assets/*.js" || { echo 'ERRO: correspondencia nao compilada' >&2; exit 1; }
echo '[5/5] Validando resposta da API e politica anti-cache...'
docker exec gfarm-app-1 python -c '
import urllib.request
base = "http://127.0.0.1:8000"
for url in ("/api/health", "/recebimentos-pendentes", "/sw.js"):
    with urllib.request.urlopen(base + url, timeout=10) as resp:
        assert resp.status == 200, (url, resp.status)
        politica = resp.headers.get("Cache-Control", "")
        if url != "/api/health":
            assert "no-store" in politica, (url, politica)
        print("OK", url, resp.status, politica)
'
echo 'SUCESSO: busca inteligente v2 confirmada no container.'
echo 'No navegador: Ctrl+Shift+R uma vez para trocar a interface antiga.'
