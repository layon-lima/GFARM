# GFARM — Instalador Definitivo e GFARM Control

**Fonte da implementação.** Um instalador Windows com três etapas: GFARM completo, GFARM Control independente e configuração do servidor. Não são três modalidades do aplicativo.

## Estado

Os fontes estão implementados. O executável Windows ainda precisa ser compilado e testado no Windows 11. O GitHub Actions da conta estava bloqueado antes de iniciar executores por configuração de faturamento, portanto NÃO foi possível gerar ou validar um EXE pelo Actions. Não instalar em produção antes de testar atualização/backup com banco descartável.

## Gerar e instalar com um clique

O pacote `GFARM_INSTALADOR_UM_CLIQUE.zip`, entregue na conversa, contem `ABRIR_INSTALADOR_GFARM.vbs` e `PREPARAR_GFARM.ps1`. Extraia o ZIP e execute o VBS: ele verifica ferramentas, instala as de compilacao que estiverem faltando, solicita login do GitHub privado, clona a main, gera o EXE do instalador, copia para a Area de Trabalho e abre o assistente Windows. Uma janela de preparacao mostra o andamento ate o instalador ficar pronto. O preparador NAO apaga bancos PostgreSQL.

Uma versao alternativa do preparador tambem esta versionada no repositorio como `PREPARAR_GFARM_UM_CLIQUE.ps1`.

## Como gerar o instalador no Windows

Requer Windows 11, Git, Python 3.13, Inno Setup 6 e internet. No diretório GFARM APP/ops/gfarm_control execute:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\build_windows.ps1

Gera:

    build\GFARM_Instalador_Definitivo.exe
    build\GFARM_Instalador_Definitivo.exe.sha256

O script verifica sintaxe Python, usa PyInstaller e Pillow para gerar os dois programas e ícones, empacota somente código rastreado do Git, e compila o instalador Inno Setup. Nenhuma credencial nem backup é incluído no instalador.

## Três etapas

1. GFARM — aplicativo convencional Windows com atalho, ícone, desinstalador, backend FastAPI e frontend React.
2. GFARM Control — aplicativo de gerenciamento independente em http://127.0.0.1:8787, senha administrativa e inicialização pelo Agendador de Tarefas como SYSTEM no boot, sem abrir terminal.
3. Servidor — identificar PostgreSQL instalado e cadastrar banco já existente no GFARM Control > Servidor. Não apaga nem cria automaticamente bancos, tabelas, usuários ou registros.

## Persistência

- Executáveis: C:\Program Files\GFARM
- Versão inicial: C:\ProgramData\GFARM\installed\GFARM APP
- Versões novas: C:\ProgramData\GFARM\releases
- Arquivos enviados: C:\ProgramData\GFARM\data\uploads, ligados ao backend por junction
- Configuração local: C:\ProgramData\GFARM\data\backend.env
- XMLs: C:\ProgramData\GFARM\data\xml-inbox, ou pasta configurada
- Backups: C:\ProgramData\GFARM\backups
- Logs: C:\ProgramData\GFARM\control.log, backend.log, instalacao.log
- PostgreSQL: serviço e armazenamento próprios do PostgreSQL, fora do instalador GFARM.

Somente SYSTEM e Administradores têm permissões diretas no diretório de dados. O uninstall do GFARM remove seus executáveis e a tarefa de início, mas preserva dados PostgreSQL e ProgramData.

## Funções do GFARM Control

- Visão geral: GFARM online/offline, banco configurado, versão e backups.
- Servidor: ligar, parar, reiniciar API; monitor de recuperação respeita desligamento manual. Não encerra processos de outros inicializadores.
- Atualizações: lê branch main do GitHub privado por Deploy Key SSH somente leitura; prepara novo release separado, compila dependências, faz backup antes de publicar, publica e valida API. A versão anterior permanece preservada. Atualizações que alterem migrations são BLOQUEADAS para revisão supervisionada.
- Backup: pg_dump custom, cópia de uploads/XMLs, validação ZIP/pg_restore, arquivo SHA-256; suspende a API gerenciada durante a captura.
- Restauração: aceita apenas pacote local validado, exige confirmação explícita e banco SEM tabelas, com pastas de uploads/XMLs vazias. Nunca sobrescreve o banco atual.
- Recuperar anexos sem restaurar banco: na tela Backups, informe o caminho do ZIP original (por exemplo, Documentos\\GFARM_BACKUP_TRANSFERENCIA\\GFARM_COMPLETO_....zip), desligue a API e use o botao de importacao de fotos, documentos e XMLs. Anexos existentes nao sao sobrescritos; o banco existente nao e consultado ou alterado.
- Remoto: por IP Tailscale na faixa 100.64.0.0/10; senha e autenticação obrigatórias, sem abrir porta administrativa na internet pública.
- Manutenção: logs e estado das operações.

## Atualização do GitHub privado

No GFARM Control, Acesso remoto > Mostrar chave pública. Cadastre essa chave em GitHub > GFARM > Settings > Deploy keys SEM liberar escrita. A chave privada não deve ser compartilhada. O computador servidor precisa estar online para baixar código. Alterações nas migrations são bloqueadas por segurança porque run_production.py executa migrations no início da API.

## Limitações e validação

- PostgreSQL existente precisa de credenciais corretas, informadas uma vez na configuração. A instalação não restaura o banco por conta própria.
- Backups novos ficam em armazenamento local; ainda NÃO são enviados automaticamente ao GitHub. Mantenha cópia em outro disco ou destino confiável.
- Reiniciar servidor não desliga nem reinicia PostgreSQL.
- Acesso remoto ao Control NÃO substitui endereço HTTPS do GFARM; a API na porta 8000 segue local.
- Se Python/Node/Git instalados pelo winget exigirem reinicialização, reinicie e tente o reparo.
- Não foi possível compilar/testar o EXE em Windows via GitHub Actions. Necessários testes reais do Inno, atalhos, serviço SYSTEM, Tailscale, GitHub SSH, instalação com PostgreSQL existente e rollback.

### Testes de código sem acessar o banco

    py -3.13 -m py_compile server.py engine.py launcher.py create_icons.py
    py -3.13 test_control.py

## Arquivos

- engine.py: operações seguras do servidor e banco
- server.py: servidor independente e autenticado
- ui.html e app.js: interface responsiva
- launcher.py: aplicativo GFARM de atalho
- create_icons.py: ícones ICO para os dois aplicativos
- install_windows.ps1: instalação local em três etapas
- GFARM_Definitivo.iss: assistente Inno Setup
- build_windows.ps1: empacotamento EXE
- test_control.py: testes isolados
