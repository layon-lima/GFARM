## NOVO: GFARM + GFARM Control — instalador Windows em 3 etapas

**[Código do instalador, painel, testes e instruções de compilação](GFARM%20APP/ops/gfarm_control/)**

Os três passos são: (1) GFARM completo e atalho, (2) aplicativo independente GFARM Control com painel responsivo e (3) configurar o servidor PostgreSQL existente. O Control permite ligar/parar/reiniciar, atualizar pela main do GitHub (deploy key SSH de leitura), backups completos, restauração APENAS em banco vazio, logs e gerenciamento remoto privado Tailscale.

**O instalador EXE definitivo ainda NÃO está compilado nem validado em Windows.** O GitHub Actions estava bloqueado pela conta antes do runner inicializar. A compilação manual no Windows usa build_windows.ps1 e Inno Setup 6. Nunca execute sobre dados reais sem validação previa. O repositório contém os fontes para o instalador, não um EXE pronto.

---

# GFARM

- **[GFARM APP](GFARM%20APP/)** — aplicativo completo: frontend, backend, painel, instalador, bibliotecas, scripts e testes.
- **[BACKUPS](BACKUPS/)** — área separada para cópias completas do banco de dados e arquivos do GFARM.

As automações de build ficam em `.github/workflows/` por exigência do GitHub e compilam o código em `GFARM APP/`.

**Importante:** o servidor atual continua intacto. A nova organização altera os caminhos no GitHub e não deve ser publicada automaticamente sobre uma instalação antiga sem migração planejada e backup verificado. Nenhum dado real foi movido nesta mudança.


## Backup temporário da instalação antiga

Antes de desativar o antigo servidor Windows, use o [GFARM Backup Web temporário](GFARM%20APP/ops/backup_transfer_web/). O painel, executado apenas em localhost, exporta PostgreSQL, uploads e XMLs pendentes e envia o ZIP dividido em partes para [BACKUPS](BACKUPS/). O servidor atual não é atualizado, e o banco não é modificado. O backup deve ser testado em um PC novo antes de excluir o sistema antigo.
