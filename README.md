# GFARM — ESTOQUE NOVO HORIZONTE

Repositório do sistema atual: frontend React/Vite, backend FastAPI, PostgreSQL e **GFARM Control**.

- [GFARM APP](GFARM%20APP/) — frontend, backend, migrations e testes.
- [GFARM Control e instalador](GFARM%20APP/ops/gfarm_control/) — inicialização, atualizações e backups.
- [**Única Release oficial**](https://github.com/layon-lima/GFARM/releases/tag/gfarm-instalador-01aab5398bed) — download do instalador Windows.
- [BACKUPS](BACKUPS/) — backup histórico com dados reais, preservado para recuperação.

## Política de publicação — somente versões aprovadas

Atualizações de código são enviadas para `main` **sem criar Releases**. O workflow de instaladores antigos foi removido.

Após a versão ser **testada e explicitamente aprovada**, no Windows o responsável pode executar:

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File ".\GFARM APP\ops\gfarm_control\PUBLICAR_INSTALADOR_GITHUB.ps1" -VersaoAprovada
```

O script **não cria nova Release**, nem novas tags; ele recompila e **substitui o `GFARM_Instalador_Definitivo.exe` e o `.sha256` da Release existente**. Se a Release oficial estiver ausente ou houver mais de uma, o envio é bloqueado para revisão. Não há publicação automática por push no GitHub.

O PostgreSQL, as migrations e os backups não são apagados pelo processo.
