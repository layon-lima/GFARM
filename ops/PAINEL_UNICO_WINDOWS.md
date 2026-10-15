# GFARM — INSTALADOR E PAINEL DE CONTROLE DO ESTOQUE

## INSTALADOR OFICIAL PARA WINDOWS

Use **GFARM_Instalador.exe** em https://github.com/layon-lima/gest-o-de-estoque-novo-horizonte/releases/latest.
O instalador Windows oferece assistente de instalação, escolhe por padrão
`C:\\Programas\\GFARM`, permite escolher outro local e adiciona atalhos de
Área de Trabalho e Menu Iniciar e desinstalador padrão do Windows.

**A pasta selecionada no instalador é a do PAINEL, não a dos dados do estoque.**
A pasta padrão do servidor para um PC novo é
`%LOCALAPPDATA%\\GFARM\\Servidor`. O painel escolhe automaticamente esse caminho
nas novas instalações e salva a escolha do usuário se ele selecionar outro.
O código, o `backend/.env`, o frontend compilado, uploads e o ambiente Python
precisam ficar em pasta gravável, não sob `C:\\Programas\\GFARM`.
O banco real permanece no PostgreSQL, protegido separadamente.

**Se o computador já hospeda o estoque:** instalar o GFARM NÃO move nem
substitui o servidor atual. O painel procura a instalação em funcionamento e
pede confirmação do caminho encontrado. Se a instalação antiga não tiver Git,
bloqueia a atualização, sem recriar banco ou clonar por cima.

**Se o computador é novo:** instalar o GFARM não instala automaticamente o
servidor. Abra o painel e execute o assistente de dependências, preparação,
restauração e início automático. A instalação dos binários do painel não ativa
outro backend nem altera a API do estoque.

Ao desinstalar, o instalador remove somente os arquivos do painel e seus
atalhos. Não remove arquivos do servidor, credenciais, uploads ou PostgreSQL.
A versão portátil `PAINEL_ESTQ.exe` continua disponível para contingência.

---

O painel oficial é compilado na branch main e distribuído como **um único arquivo PAINEL_ESTQ.exe** no GitHub: https://github.com/layon-lima/gest-o-de-estoque-novo-horizonte/releases/latest

O arquivo não contém banco, credenciais ou arquivos privados. Baixa todo o código do GitHub pelo Git Credential Manager, instala dependências oficiais pelo Winget e oferece o fluxo completo de backup, restauração e teste. Exige internet, Windows 11 e permissões administrativas para PostgreSQL/Cloudflare. A origem continua sendo o único servidor que aceita gravações até o corte.

## NO PC ATUAL — GERAR A CÓPIA REAL DOS DADOS

1. Baixe o EXE oficial e selecione a pasta que contém o projeto atual (backend e ops).
2. Interrompa o uso do estoque e escolha "Criar pacote completo de transferência". O monitor é pausado. Se o backend foi iniciado por outro painel, pare-o por aquele painel antes de tentar novamente. O PostgreSQL precisa continuar ligado.
3. Salve no pendrive protegido. O pacote contém dump PostgreSQL, imagens/documentos enviados e XMLs pendentes. Serão criados INDEX_ERP_...zip e INDEX_ERP_...zip.sha256. Transfira os DOIS arquivos. O ZIP contém dados privados sem criptografia: use pendrive criptografado ou canal seguro, nunca GitHub.
4. Não ligue o backend antigo para novas movimentações enquanto a migração estiver em andamento. Não formate o antigo até conferir o novo.

## NO PC NOVO — ABRIR SOMENTE O PAINEL_ESTQ.exe

1. Instale o GFARM pelo GFARM_Instalador.exe. A pasta do painel será C:\\Programas\\GFARM (configurável), e a pasta de servidor proposta pelo painel será %LOCALAPPDATA%\\GFARM\\Servidor.
2. Clique "Instalar dependências". Winget instala Git, Node.js LTS, Python 3.13, PostgreSQL 17 e Cloudflare Tunnel. O instalador PostgreSQL pode pedir senha de administrador do banco e reinicialização.
3. Clique "Baixar e preparar app do GitHub". Faça login na conta autorizada se o navegador solicitar. São feitos clone da main, bibliotecas Python, npm ci e build.
4. Clique "Criar PostgreSQL vazio + configurar". Informe no painel a senha do usuário postgres. O programa cria novo banco estq_novo_horizonte e usuário estq_app com senha própria aleatória, guardada apenas em backend/.env. Se usuário/banco ou .env já existir, recusa alterar.
5. Clique "Restaurar dados do computador antigo" e selecione o ZIP acompanhado de .zip.sha256. A restauração só opera em banco vazio e pastas vazias. O painel verifica a integridade antes do pg_restore.
6. Clique "Iniciar servidor", abra http://127.0.0.1:8000 e confira usuários, cadastros, produtos, fotos, saldos oficiais, pedidos, tickets, relatórios, permissões e históricos. Se o banco estiver vazio, a inicialização será recusada.
7. Clique "Instalar início automático do Windows". Reinicie o PC e faça login para testar o monitor do backend. O painel também tem "Diagnosticar servidor".
8. Por último use "Configurar acesso externo (Cloudflare)". Desative o servidor/túnel antigo antes de ativar o novo na mesma rota. No Cloudflare Dashboard, copie o token de um túnel remotamente gerenciado e instale como serviço Windows pelo painel com permissão de administrador. Credenciais nunca são incluídas no GitHub.
9. Se usar balança USB, conceda novamente permissão de acesso ao dispositivo no navegador do PC que está conectado à balança; permissões Web Serial não são transferidas pelo banco. Teste fisicamente a captura.

## GARANTIAS / LIMITES

- O painel evita sobrescrever diretórios ocupados, não faz git reset, não restaura sobre banco com tabelas e não mata processos de outros painéis.
- O banco, imagens e XMLs são transferidos por pacote local; dados reais NUNCA são extraídos do GitHub.
- Não é possível garantir que todos os drivers, periféricos e autorizações de serviço sejam copiados de um Windows para outro automaticamente. O painel guia a instalação e testes.
- O monitor do backend inicia após entrar no Windows. Cloudflare Tunnel roda como serviço próprio. Um PC local desligado continua deixando o site indisponível.
- Nunca permita que o antigo e novo banco sejam usados para gravar estoque ao mesmo tempo.
- Se interromper a migração, guarde o backup e não remova a pausa do monitor antigo sem primeiro parar e despublicar o servidor novo.

Logs: %LOCALAPPDATA%/ESTQ-Painel/painel.log e %LOCALAPPDATA%/ESTQ-Inicializacao/monitor.log.
