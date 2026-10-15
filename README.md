# GFARM

- **[GFARM APP](GFARM%20APP/)** — aplicativo completo: frontend, backend, painel, instalador, bibliotecas, scripts e testes.
- **[BACKUPS](BACKUPS/)** — área separada para cópias completas do banco de dados e arquivos do GFARM.

As automações de build ficam em `.github/workflows/` por exigência do GitHub e compilam o código em `GFARM APP/`.

**Importante:** o servidor atual continua intacto. A nova organização altera os caminhos no GitHub e não deve ser publicada automaticamente sobre uma instalação antiga sem migração planejada e backup verificado. Nenhum dado real foi movido nesta mudança.


## Backup temporário da instalação antiga

Antes de desativar o antigo servidor Windows, use o [GFARM Backup Web temporário](GFARM%20APP/ops/backup_transfer_web/). O painel, executado apenas em localhost, exporta PostgreSQL, uploads e XMLs pendentes e envia o ZIP dividido em partes para [BACKUPS](BACKUPS/). O servidor atual não é atualizado, e o banco não é modificado. O backup deve ser testado em um PC novo antes de excluir o sistema antigo.
