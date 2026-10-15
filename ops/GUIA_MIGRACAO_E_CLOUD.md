# ESTQ — MIGRACAO DE SERVIDOR E HOSPEDAGEM ONLINE

Fonte de codigo: GitHub (main). Fonte de dados: PostgreSQL + motor de estoque. Arquivos: backend/uploads. XMLs pendentes: pasta XML ERP, configuravel por ESTQ_XML_TICKET_DIR. Credenciais: backend/.env (NUNCA enviar ao GitHub).

Nenhum destes scripts move seu banco automaticamente, troca o dominio ou modifica o servidor de origem. Primeiro teste o destino; depois faca a virada final. Nunca deixe dois bancos de estoque aceitando movimentacoes simultaneas.

## A — TRANSFERIR PARA OUTRO WINDOWS

Requisitos no NOVO PC: Git, Python 3.13, Node.js LTS, PostgreSQL com pg_dump/pg_restore compativeis (destino mesma versao major ou posterior), backup externo criptografado. O computador continua precisando estar ligado.

1. No PC atual, obtenha um backup independente e agende uma janela sem operacoes. Interrompa o backend pelo painel e impeça movimentacoes, mas deixe o PostgreSQL ligado para a exportacao.
2. Na pasta do projeto, com codigo atualizado do GitHub, rode no PowerShell:

       .\backend\.venv\Scripts\python.exe .\ops\migrar_servidor.py exportar --destino "E:\ESTQ_TRANSFERENCIA" --operacoes-pausadas

   Use a venv correta se estiver em outra localizacao. O processo empacota um dump custom PostgreSQL, uploads e XMLs pendentes; cria ZIP e arquivo ZIP.sha256. Nao inclui backend/.env, tokens, chaves ou senhas.
3. O ZIP CONTEM DADOS PRIVADOS SEM CRIPTOGRAFIA. Transfira os dois arquivos usando unidade criptografada (BitLocker) ou SFTP privado, nunca via GitHub ou mensagens de chat.
4. No NOVO PC clone o mesmo repositorio, instale requisitos e rode:

       powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\PREPARAR_NOVO_SERVIDOR.ps1

   Isso cria venv e compila frontend, mas NAO cria nem altera PostgreSQL.
5. Crie backend/.env local seguindo backend/.env.example. Preencha banco destino, usuario e senha fortes. SECRET_KEY original so deve ser transportada por canal secreto se necessaria. O destino deve ser NOVO, vazio e isolado. Instale PostgreSQL e crie banco vazio pelo pgAdmin. NAO inicie a aplicacao antes de restaurar (a inicializacao cria tabelas).
6. Com backup na unidade segura e aplicacao desligada, rode:

       .\backend\.venv\Scripts\python.exe .\ops\migrar_servidor.py verificar --arquivo "E:\ESTQ_TRANSFERENCIA\INDEX_ERP_...zip"
       .\backend\.venv\Scripts\python.exe .\ops\migrar_servidor.py restaurar --arquivo "E:\ESTQ_TRANSFERENCIA\INDEX_ERP_...zip" --destino-vazio-confirmado

   O programa verifica SHA, ZIP e banco vazio. O pg_restore usa uma unica transacao, sem sobrescrever tabelas existentes. Pasta backend/uploads e inbox XML precisam estar vazias.
7. Inicie o backend do destino, confirme /api/health, login, fotos, relatorios, tickets e SALDOS OFICIAIS do motor. Configure inicializacao GitHub:

       powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\INSTALAR_INICIALIZACAO.ps1

   O instalador move inicializadores velhos para backup, cria atalho .lnk e inicia monitor versionado que tenta recuperar backend quando /api/health parar. Logs em %LOCALAPPDATA%\ESTQ-Inicializacao. O atalho funciona DEPOIS DO LOGIN do usuario no Windows; nao durante PC desligado.
8. Migre o servico Cloudflare Tunnel para o destino, com credenciais guardadas FORA do GitHub. Mantenha o endereco publico apontando para origem ate confirmar testes. Interrompa gravacoes na origem antes de liberar destino. Nao retome escrita nos dois servidores.

## B — HOSPEDAR EM VPS LINUX (PC PODE FICAR DESLIGADO)

Requer conta num provedor VPS, Docker Engine + Docker Compose, disco persistente, SSH com chave, atualizacoes de seguranca, firewall, Cloudflare Tunnel/DNS e backup EXTERNO. Nao existe garantia absoluta de 100% uptime; VPS remove dependencia do computador local.

1. Configure uma VPS Linux segura e clone o repositorio. Nao exponha PostgreSQL nem a porta da aplicacao publicamente.
2. Crie backend/.env (nao versionado), com DB_NAME, DB_USER, DB_PASSWORD fortes e SECRET_KEY secreto. Use chmod 600 backend/.env. Compose configura DB_HOST=db, APP_HOST=0.0.0.0 internamente e publica 8000 apenas no loopback 127.0.0.1 do VPS.
3. O deploy/cloud/compose.yml tem app (FastAPI + frontend), PostgreSQL com volume persistente, uploads, logs/backups, healthchecks, restart automatico e ferramenta de restore opt-in. O banco usa Postgres 17 e pg_dump/pg_restore 17. Confirme versao do banco original ANTES da migracao: destino deve ser compativel.
4. Para importar os dados existentes, gere backup final com a aplicacao antiga PARADA seguindo a opcao A. Transfira ZIP e ZIP.sha256 por canal privado para pasta transfer/ do VPS, fora do Git (tambem excluida do build Docker).
5. Inicie SOMENTE o banco vazio:

       docker compose --env-file backend/.env -f deploy/cloud/compose.yml up -d db

6. Restaure e verifique a integridade, substituindo INDEX_ERP_...zip pelo nome real:

       docker compose --env-file backend/.env -f deploy/cloud/compose.yml run --rm restore verificar --arquivo /transfer/INDEX_ERP_...zip
       docker compose --env-file backend/.env -f deploy/cloud/compose.yml run --rm restore restaurar --arquivo /transfer/INDEX_ERP_...zip --destino-vazio-confirmado

7. Somente apos finalizar restaure e inicie a API:

       docker compose --env-file backend/.env -f deploy/cloud/compose.yml up -d --build app
       curl --fail http://127.0.0.1:8000/api/health

8. Instale e configure o CLOUDFLARE TUNNEL COMO SERVICO NO VPS, apontando seu hostname HTTPS para http://127.0.0.1:8000. Token fora do repositorio. Teste login, imagens, saldos, pesagem e permissoes antes de trocar DNS/trafego e permitir escrita. No corte, somente um servidor recebe novas movimentacoes.
9. Configure backups criptografados PARA FORA DO VPS com retencao e testes periodicos de restauracao. Os backups locais automaticos existentes no volume de logs NAO protegem contra perda total do VPS. Monitore saúde do Postgres, app, Tunnel, memoria e disco.

## LIMITACOES IMPORTANTES

- Balanca USB/Web Serial: a balanca permanece conectada ao PC do operador. O navegador compativel com Web Serial acessa o USB local quando abre o site HTTPS do VPS; requer teste fisico e permissao do navegador.
- XML automatico da pesagem: o VPS NAO consegue observar uma pasta do Windows automaticamente. No VPS, ESTQ_XML_TICKET_DIR aponta para um volume persistente. E preciso configurar envio seguro de XMLs do PC para a caixa XML remota (essa sincronizacao NAO e criada pelo Compose).
- Outros dispositivos ou aplicativos dependentes de recursos locais requerem validacao antes do corte.
- Sem acesso a sua conta de hospedagem/Cloudflare, este repositorio entrega a estrutura e as verificacoes, mas NAO contrata VPS, nao liga conta externa nem muda DNS automaticamente.
- Se a origem continuar recebendo movimentacoes apos o backup final, elas NAO serao copiadas para o destino. Interrompa operacoes no corte.

## FALHA OU ROLLBACK

Nao rode restore em banco com tabelas nem apague dados do servidor atual. Se a migracao do novo banco falhar, preserve o backup e investigue: somente um novo banco de TESTE pode ser descartado com aprovacao, nunca o banco original. Nao altere DNS antes de validar todos os saldos do motor, arquivos e historicos.
