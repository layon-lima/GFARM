# GFARM — INSTALADOR E PAINEL DE CONTROLE DO ESTOQUE

## INSTALADOR DO **PROGRAMA COMPLETO** GFARM PARA WINDOWS

O arquivo **GFARM_Instalador.exe** instala o GFARM e inclui o painel de controle
que executa o assistente de instalação do sistema, não somente um painel solto.

Baixe em https://github.com/layon-lima/gest-o-de-estoque-novo-horizonte/releases/latest.

1. Execute o GFARM_Instalador.exe como instalador Windows e escolha a pasta.
   Por padrão: **C:\Programas\GFARM** (ou outra escolhida por você).
2. O instalador cria o programa/atalhos e registra o caminho real no
   **gfarm-install.ini** da instalação.
3. Ao concluir o instalador, é oferecida a opção **"Instalar e configurar o
   programa GFARM agora"**. O painel é aberto automaticamente no assistente
   **INSTALAR GFARM COMPLETO**.
4. Em **C:\Programas\GFARM\Servidor**, o assistente baixa o sistema oficial da
   branch main no GitHub, instala Git, Python 3.13, Node.js e PostgreSQL 17,
   prepara o backend (.venv), instala bibliotecas e compila o frontend (dist).
   **Necessário internet e autorização de Administrador do Windows.**
   Programas instalados podem exigir sua confirmação/reinicialização.
5. O assistente solicita a senha escolhida ao instalar o PostgreSQL e prepara
   um banco NOVO. Se houver banco ou .env anterior, ele não os altera.
6. O assistente solicita o ZIP do backup do servidor anterior e o respectivo
   ZIP.sha256. Confere a integridade, restaura banco, uploads e XMLs, e oferece
   iniciar o GFARM após a restauração.
7. Depois de conferir tudo, clique **Instalar início automático do Windows** e
   valide o acesso externo. O túnel Cloudflare é configurado separadamente
   e o antigo servidor deve parar de aceitar gravações antes da troca.

**No computador que JÁ executa o estoque:** o instalador não substitui, não
move, não desliga e não reinicia o servidor. Detecta a API ativa (inclusive
instalações antigas) e recusa criar outra instância/banco. Use
**Localizar instalação em uso** no painel para apontar o caminho real.
Instalações já existentes sem .git requerem reconciliação segura com GitHub
antes da função Atualizar ser habilitada.

**Separação de dados e segurança:** a pasta do sistema inclui código, .venv,
dist e uploads; o banco continua gerenciado pelo PostgreSQL. O instalador
NÃO leva dados reais do servidor anterior dentro do EXE. O projeto é obtido
pelo GitHub e os dados somente pelo backup local verificado. Durante a
instalação sob C:\Programas, o Windows pode exigir privilégios de
Administrador para criar/atualizar os arquivos. Não concedemos permissões
de escrita de credenciais a todos os usuários locais.

**Desinstalar** o GFARM pelo Windows remove o lançador registrado, mas
não destrói o PostgreSQL nem os arquivos do banco, nem limpa uploads do servidor.
Antes de qualquer transferência ou limpeza de máquina, faça backup seguro.


---

O painel oficial é compilado na branch main e distribuído como **um único arquivo PAINEL_ESTQ.exe** no GitHub: https://github.com/layon-lima/gest-o-de-estoque-novo-horizonte/releases/latest

O arquivo não contém banco, credenciais ou arquivos privados. Baixa todo o código do GitHub pelo Git Credential Manager, instala dependências oficiais pelo Winget e oferece o fluxo completo de backup, restauração e teste. Exige internet, Windows 11 e permissões administrativas para PostgreSQL/Cloudflare. A origem continua sendo o único servidor que aceita gravações até o corte.

## NO PC ATUAL — GERAR A CÓPIA REAL DOS DADOS

1. Baixe o EXE oficial e selecione a pasta que contém o projeto atual (backend e ops).
2. Interrompa o uso do estoque e escolha "Criar pacote completo de transferência". O monitor é pausado. Se o backend foi iniciado por outro painel, pare-o por aquele painel antes de tentar novamente. O PostgreSQL precisa continuar ligado.
3. Salve no pendrive protegido. O pacote contém dump PostgreSQL, imagens/documentos enviados e XMLs pendentes. Serão criados INDEX_ERP_...zip e INDEX_ERP_...zip.sha256. Transfira os DOIS arquivos. O ZIP contém dados privados sem criptografia: use pendrive criptografado ou canal seguro, nunca GitHub.
4. Não ligue o backend antigo para novas movimentações enquanto a migração estiver em andamento. Não formate o antigo até conferir o novo.

## NO PC NOVO — ABRIR SOMENTE O PAINEL_ESTQ.exe

1. Instale o GFARM pelo GFARM_Instalador.exe. O código do sistema será colocado pelo assistente em C:\\Programas\\GFARM\\Servidor (se não escolher outra pasta).
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
