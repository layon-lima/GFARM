# GFARM — Painel web temporário para backup do servidor atual

Ferramenta temporária para extrair os dados do GFARM em C:\Users\User\Documents\Layon\PROJETOS PYTHON\PROJETO e enviá-los ao repositório privado layon-lima/GFARM, na pasta BACKUPS.

Não modifica o banco, não instala outro servidor, não aplica migrations e não atualiza o sistema antigo.

## Como usar

1. Coloque painel_backup.py e INICIAR_BACKUP.vbs na mesma pasta fora do sistema antigo; ou baixe o pacote ZIP completo fornecido nesta conversa.
2. No painel antigo, clique em Parar API. Deixe o PostgreSQL ligado. Não use Desligar tudo.
3. Dê dois cliques em INICIAR_BACKUP.vbs. O painel abre no navegador.
4. Gere o backup completo. ZIP e SHA-256 ficam em Documentos\GFARM_BACKUP_TRANSFERENCIA.
5. Envie ao GitHub. Requer Git for Windows autenticado (pode abrir login no navegador).
6. Confira o link em GFARM/BACKUPS e guarde também o ZIP local.
7. Só apague a pasta antiga após uma restauração testada e conferida no computador novo.

Se o VBS não abrir, use INICIAR_COM_DIAGNOSTICO.cmd.

## Conteúdo e limites

O ZIP inclui database.dump, uploads, xml_inbox (XMLs pendentes) e manifest.json. Os uploads não são apagados. SHA-256 verifica integridade; não criptografa o backup, conforme solicitado.

O envio divide o backup em partes de 48 MiB, com um importacao.json contendo a ordem e os hashes das partes. Limite de 2 GiB por pacote nesta ferramenta.

Senhas e backend/.env ficam fora dos arquivos de backup. O banco PostgreSQL permanece ligado e não é alterado. A ferramenta NÃO executa restaurações; o instalador futuro deverá restaurar em banco novo/vazio e validar os dados.
