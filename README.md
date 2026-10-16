# GFARM — ESTOQUE NOVO HORIZONTE

Repositório do sistema em uso: frontend React/Vite, backend FastAPI, PostgreSQL, **GFARM Control** e instalador Windows definitivo.

- [GFARM APP](GFARM%20APP/) — frontend, backend, migrations e testes.
- [GFARM Control e instalador](GFARM%20APP/ops/gfarm_control/) — inicialização, atualizações e backups.
- [Releases](https://github.com/layon-lima/GFARM/releases) — download do instalador compilado.
- [BACKUPS](BACKUPS/) — backup histórico com dados reais, mantido para recuperação.

### Publicar o instalador e limpar Releases antigas

No terminal PowerShell, na raiz do repositório:

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File ".\GFARM APP\ops\gfarm_control\PUBLICAR_INSTALADOR_GITHUB.ps1"
```

Esse script compila o instalador, publica `GFARM_Instalador_Definitivo.exe` na área Releases, verifica o upload e **só então** remove as Releases legadas `painel-estq-*`.

O código do painel ESTQ antigo, iniciadores Windows antigos e workflow que os recompilava foram removidos. As migrations PostgreSQL, código atual e backup de dados reais são preservados. A pasta BACKUPS não é incluída no instalador.
