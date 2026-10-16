# GFARM APP

Código atual do estoque Novo Horizonte.

- `src/`, `public/`, `package*.json`: frontend React/Vite.
- `backend/app/`, `backend/alembic/`: FastAPI, motor de estoque, autenticação e migrations do banco.
- `ops/gfarm_control/`: gerenciador e instalador oficial Windows.
- `ops/migrar_servidor.py`, `deploy/cloud/`: utilitários atuais para migração controlada e hospedagem alternativa.
- `tests/`: testes atuais.

## Instalação Windows

Utilize `GFARM_Instalador_Definitivo.exe` na [área Releases](https://github.com/layon-lima/GFARM/releases). Ele instala GFARM + Control no Windows e baixa o sistema do GitHub privado.

O banco PostgreSQL existente **não é excluído**. Configure-o no Control; não execute restaurações sobre bancos com dados.

## Desenvolvimento

```powershell
npm ci
npm run build
npm run lint
```
