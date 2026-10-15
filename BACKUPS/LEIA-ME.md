# BACKUPS DO GFARM

Pasta reservada para os pacotes completos de backup do sistema GFARM.

## Padrão aprovado

- **Sem criptografia do arquivo**, conforme decisão do proprietário. Por isso, todo arquivo de backup colocado aqui pode ser lido por quem tiver acesso ao repositório, e o histórico do Git preserva versões mesmo após remoção de arquivos.
- **Backup completo:** dump do PostgreSQL, imagens/documentos em `backend/uploads`, XMLs pendentes do ERP, e manifesto para conferência.
- **Importação simples:** o futuro GFARM Control deve permitir selecionar e restaurar um pacote pelo painel, sem comandos manuais.
- **Integridade:** armazenar `INDEX_ERP_AAAAMMDD_HHMMSS.zip` e seu `INDEX_ERP_AAAAMMDD_HHMMSS.zip.sha256`. O SHA-256 não é criptografia.
- **Restauração segura:** verificar SHA-256 e estrutura do pacote antes de restaurar; nunca restaurar por cima de banco existente com dados; exigir confirmação expressa.
- **Credenciais:** não incluir `backend/.env`, senhas do PostgreSQL, tokens Cloudflare nem chaves privadas nos backups do GitHub. São configuradas novamente no PC de destino.

## Estado atual

**Nenhum backup real foi gerado ou enviado aqui.** O PostgreSQL de produção está em outro computador e não é acessível diretamente por esta conexão GitHub. O código de exportação existente deve ser executado no PC que hospeda o banco e os uploads; o resultado deve ser verificado antes do envio.

## Atenção aos limites

O repositório GitHub comum não aceita arquivos maiores que 100 MB pelo Git normal. Se o ZIP superar esse limite, não fragmentar às cegas nem omitir imagens ou tabelas: usar um local privado compatível com arquivos grandes e vinculá-lo à interface de importação, mantendo o backup completo.

Não excluir a única cópia do backup do PC original. Conservar pelo menos uma cópia adicional, independente do GitHub.
