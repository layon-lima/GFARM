# GFARM APP

Código oficial do estoque Novo Horizonte.

- src/, public/, package*.json: frontend React/Vite.
- backend/app/, backend/alembic/: FastAPI, motor oficial, autenticação e schema PostgreSQL.
- ops/windows/GFARM.ps1: único gerenciador de instalação e atualização Windows.
- ops/windows/GFARM-Servico.py: serviço independente iniciado pelo Windows.
- ops/migrar_servidor.py: exportação/restauração supervisionada de dados.
- deploy/cloud/: implantação Linux separada.
- tests/ e backend/tests/: regressões.

**GFARM Control foi removido.** A porta 8787 e o instalador EXE não são mais
necessários. O servidor roda pelo Agendador com a tarefa **GFARM Servidor**.

## Instalação / atualização Windows

Consulte [ops/windows/README.md](ops/windows/README.md). O primeiro acesso a um
PC exige o arquivo privado backend.env do banco já existente, obtido por
transferência segura — o script não cria banco de produção.

As atualizações vêm somente de main e não alteram o PostgreSQL.
