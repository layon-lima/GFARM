# GFARM — ESTOQUE NOVO HORIZONTE

Sistema de estoque privado. Interface React/Vite, API FastAPI e banco PostgreSQL existente.

**O GFARM Control e o instalador EXE foram descontinuados e removidos.** O servidor
Windows é independente: a tarefa **GFARM Servidor** executa o FastAPI na porta
configurada (normalmente 8000). Instalação, atualizações, backup e manutenção são
executados diretamente por um script PowerShell versionado na branch **main**.

- [Aplicativo GFARM](GFARM%20APP/) — frontend, API, banco e testes.
- [Gerenciador PowerShell](GFARM%20APP/ops/windows/GFARM.ps1) — instalação e manutenção.
- [Guia de migração e atualização](GFARM%20APP/ops/windows/README.md).
- [Migração de dados para outro servidor](GFARM%20APP/ops/migrar_servidor.py).

O PostgreSQL, os anexos, XMLs e segredos são dados persistentes **fora do
repositório**. Atualizar o código não recria banco, não executa migrations nem
apaga históricos. Alterações de schema exigem procedimento supervisionado.

O repositório é privado: o download para o PC precisa de login do GitHub ou da
deploy key somente leitura já configurada. Não colocar senhas, arquivos .env,
chaves privadas ou dumps em commits.

Os scripts são executados manualmente no Windows, sem GitHub Actions, PRs,
releases ou instalador compilado.
