# GFARM SEM CONTROL — WINDOWS

O único sistema executado é o GFARM (FastAPI + React na porta 8000).
Um script PowerShell administra a instalação, e a tarefa **GFARM Servidor**
executa diretamente pythonw.exe com GFARM-Servico.py (SYSTEM), sem processo
pai GFARM Control e sem porta 8787.

## Primeira migração do PC atual

1. Entre no GitHub privado pelo navegador e baixe **GFARM.ps1** deste diretório.
   Não use o instalador EXE antigo e não clique em Atualizar no Control.
2. Abra **PowerShell como administrador** e execute o script baixado:

        powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\CAMINHO\GFARM.ps1" -Acao Migrar

3. O script encontra a instalação anterior por ProgramData/GFARM/control.json,
   preserva ProgramData/GFARM/data/backend.env, uploads, XMLs e PostgreSQL;
   baixa apenas GFARM APP da branch main (o acesso privado requer deploy key
   existente ou autenticação GitHub), instala os runtimes necessários e compila
   React **antes de parar** o servidor anterior.
4. Só então encerra a tarefa legada, inicia a tarefa **GFARM Servidor** e confere
   /api/health e a interface. Se falhar, tenta restaurar a execução anterior;
   não faz DELETE, DROP nem migrations no banco.
5. Depois de confirmação HTTP, remove a tarefa e os arquivos do Control
   (sem tocar nas chaves de acesso GitHub e sem remover dados do GFARM).

A instalação ativa fica em ProgramData/GFARM/app.
O comando central fica em ProgramData/GFARM/GFARM.ps1.
A configuração do servidor fica em ProgramData/GFARM/servidor.json.
A pasta oficial de dados continua ProgramData/GFARM/data.

## Comandos após a migração

Abra PowerShell como administrador:

    & "$env:ProgramData\GFARM\GFARM.ps1" -Acao Atualizar
    & "$env:ProgramData\GFARM\GFARM.ps1" -Acao Status
    & "$env:ProgramData\GFARM\GFARM.ps1" -Acao Iniciar
    & "$env:ProgramData\GFARM\GFARM.ps1" -Acao Parar
    & "$env:ProgramData\GFARM\GFARM.ps1" -Acao Reiniciar
    & "$env:ProgramData\GFARM\GFARM.ps1" -Acao Logs
    & "$env:ProgramData\GFARM\GFARM.ps1" -Acao Backup

**Atualizar** baixa e valida a main antes da troca. Compara as migrations com
as instaladas; se houver diferença, bloqueia sem modificar o PostgreSQL.
O código anterior é mantido apenas durante a troca para permitir rollback.
Uploads persistentes ficam ligados por junction e não são apagados com o app.
As dependências são instaladas fora do app no runtime persistente.

**Backup** chama a rotina oficial do backend, com os arquivos em
ProgramData/GFARM/backups. Confira o resultado e mantenha cópias externas;
a rotina atual do ERP aplica retenção de backups. A exportação final para
outro PC usa ops/migrar_servidor.py, e a restauração exige destino vazio.

**Instalação em outro PC:** antes do primeiro comando -Acao Instalar, coloque
o backend.env transferido por canal privado em
ProgramData/GFARM/data/backend.env. Sem ele, o script **se recusa a abrir
ou criar banco**. Configuração de PostgreSQL existente, uploads e chaves não
fazem parte do GitHub.

## Garantias e limites

- Nenhum GitHub Actions, branch extra, PR ou instalador EXE é necessário.
- O programa não roda quando o PC está desligado; o Windows inicia a tarefa
  ao ligar. Tunnel/Cloudflare existente não é alterado pelo script.
- A atualização não executa alembic upgrade, não toca em saldo/motor nem
  cria banco paralelo. Diferentes schemas exigem intervenção supervisionada.
- A tarefa velha só é desativada após validar que o novo GFARM abre.
- Nunca apague manualmente ProgramData/GFARM/data, PostgreSQL nem uploads.
- O desinstalador antigo do Windows, se estiver registrado em Aplicativos,
  pode continuar listado: não o execute durante a migração. Os serviços e o
  código do Control não são usados após a migração.
- Erros e diagnósticos: ProgramData/GFARM/gfarm-manutencao.log e
  ProgramData/GFARM/gfarm-servidor.log.

## Desenvolvimento

Sempre na branch main, conforme AGENTS.md. Alterações de PowerShell devem
ser validadas com o parser do Windows; testar migrar/atualizar no PC real e
conferir o status antes de declarar implantação concluída.
