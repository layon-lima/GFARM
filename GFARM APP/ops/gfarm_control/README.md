# GFARM e GFARM Control

O unico executavel proprio distribuido e **GFARM_Instalador_Definitivo.exe**.
O GFARM e uma aplicacao React/FastAPI na porta 8000. O Control e um painel web
independente na porta 8787, executado por Python/pythonw na tarefa SYSTEM do
Windows. Os atalhos abrem as URLs; nao precisam ler arquivos protegidos nem
executar GFARM.exe ou GFARM-Control.exe.

## Atualizar GitHub: mesma pasta, somente arquivos alterados

O botao **Atualizar GitHub** mantem `control.json.app_path` e o diretorio instalado.
Nao clona uma copia completa nem cria uma pasta de aplicativo a cada versao.

1. Consulta a main e compara seu commit com o instalado.
2. Reutiliza `github-cache.git`, um cache bare com partial clone/blob:none. Busca
   metadados Git e baixa apenas os blobs de programa alterados. BACKUPS/ do
   repositorio nao e baixado pelo atualizador.
3. Confere hash Git dos downloads, caminhos protegidos, sintaxe Python e
   conflitos com arquivos locais. Mudancas em migrations/configuracao Alembic
   bloqueiam a operacao antes de substituir programas.
4. Preserva os arquivos que serao substituidos/removidos em `update/history/`.
   Se o banco estiver configurado, cria tambem o backup completo validado antes
   de alterar programas. Para somente a API pertencente ao proprio Control.
5. Substitui/adiciona/remove os arquivos do diff **na mesma instalacao**.
   Arquivos sem alteracao conservam seu conteudo e data. Reutiliza a venv;
   instala requisitos Python e pacotes npm apenas quando necessario.
6. Compila/verifica o backend e executa os testes isolados existentes. Quando o
   frontend muda, compila em diretorio temporario, valida o index.html e aplica
   somente os artefatos dist diferentes, removendo os artefatos obsoletos.
7. Reinicia o GFARM se ele estava ligado. O inicio verifica, somente por leitura,
   o schema e a revisao Alembic do banco existente; **nao executa migrations**.
   Verifica a resposta da API e a pagina React.
8. Se o codigo em uso do Control mudou, um helper independente aguarda seu PID
   encerrar e reabre a tarefa Python. Confere o fingerprint do codigo realmente
   carregado e, se aplicavel, a API e a interface do GFARM.
9. Em caso de falha, restaura os arquivos/dependencias anteriores. O journal
   persistente permite recuperar uma substituicao interrompida antes de importar
   novamente o servidor. O rollback nao restaura nem altera o PostgreSQL.

Os arquivos temporarios e o backup de arquivos alterados nao sao uma segunda
instalacao. O cache Git nao e um checkout executavel. Arquivos persistentes
(.env, uploads, XMLs, chaves, senha, dados e backups) ficam fora do diff permitido.
Links/junctions, alteracoes locais conflitantes e processos desconhecidos sao
bloqueados. No Windows, um Job Object vincula apenas o backend filho ao Control,
impedindo que um crash/reinicio deixe uma API orfa ocupando a porta.

A primeira passagem de uma instalacao que ainda executa o atualizador antigo
continua sujeita ao comportamento desse codigo antigo. A regra incremental
entra em vigor quando o novo Control estiver instalado. A publicacao no GitHub
nao modifica automaticamente o computador do usuario.

## Instalacao e reparo

- **Primeira instalacao:** instala/identifica dependencias, baixa o codigo privado,
  prepara runtimes Python, frontend, atalhos e tarefa web. Configura a senha do
  painel e abre a conexao segura com o PostgreSQL existente. Nao cria banco real.
- **Reparar / instalar por cima:** conserva a versao do codigo, dados e senha;
  revalida dependencias, atalhos e tarefa. O preflight reconhece tanto a tarefa
  Python atual como o EXE legado e so encerra processos identificados.
- **Reinstalar os programas:** operacao explicita de recuperacao, diferente da
  atualizacao normal: permite preparar codigo/ambientes limpos e validar antes
  da ativacao, preservando os dados e a possibilidade de voltar a configuracao
  anterior. Migrations diferentes continuam bloqueadas.

O instalador so remove iniciadores EXE legados depois de verificar o Control
web. Os antigos scripts de compilacao/troca de GFARM-Control.exe foram retirados;
o fluxo normal e o botao GitHub, e a migracao/reparacao e feita pelo instalador.

## Dados e autenticacao

- Codigo instalado: caminho existente indicado por `control.json.app_path`.
- Configuracao: ProgramData/GFARM/control.json.
- Conexao oficial e chave da aplicacao: ProgramData/GFARM/data/backend.env,
  disponibilizada ao backend/.env instalado.
- Uploads: ProgramData/GFARM/data/uploads, vinculado ao backend/uploads.
- XMLs: configuracao ESTQ_XML_TICKET_DIR ou ProgramData/GFARM/data/xml-inbox;
  o processo da API recebe o mesmo caminho utilizado pelo backup.
- Senha do painel: ProgramData/GFARM/control-auth.json.
- Deploy key privada: ProgramData/GFARM/secrets/github_deploy.
- Backups: ProgramData/GFARM/backups.
- Journal/backup de programas: ProgramData/GFARM/update/history.

O instalador aceita autenticacao GitHub do administrador no primeiro uso.
Reutiliza a deploy key existente em reparos/reinstalacoes. O Control SYSTEM usa
uma deploy key de leitura autorizada em [Deploy keys](https://github.com/layon-lima/GFARM/settings/keys).
Nunca compartilhar arquivos de credenciais, senha, .env ou chaves privadas.

Em **Backups > Recuperar fotos e documentos**, o ZIP e enviado pelo navegador e
somente uploads/XMLs sao importados. O banco e os anexos existentes nao sao
sobrescritos. PC e mobile usam o mesmo servidor e os caminhos /uploads.

## Validacao e compilacao sem publicacao

O CI executa os testes Python do Control em Linux e Windows, incluindo os casos
incrementais com Git local real, rollback, caminhos protegidos, o Job Object e
junctions Windows. Valida scripts PowerShell e compila somente o instalador
Inno Setup, sem publicar Release. O teste HTTP do Control exercita pagina, JS,
login e status sem banco/API do estoque.

Para o responsavel Windows gerar o instalador aprovado, executar o gerador
versionado GERAR_INSTALADOR.cmd. O build valida PowerShell, Python e testes;
qualquer falha interrompe a geracao. A publicacao continua exigindo o parametro
VersaoAprovada do PUBLICAR_INSTALADOR_GITHUB.ps1: substitui os arquivos da unica
Release oficial, preservando seu link, e nao cria Releases novas.

Ainda e obrigatorio testar numa maquina Windows 11: instalacao nova, reparo,
reinstalacao e migracao do EXE antigo, reinicializacao do Windows, autoatualizacao
real do Control, recuperacao apos interrupcao, permissoes SYSTEM/usuario comum e
imagens em PC/mobile. Simulacoes e compilacao do instalador nao comprovam esses
comportamentos de ponta a ponta.
