# GFARM + GFARM Control — instalador e atualizacoes

## Arquitetura definitiva

O `GFARM_Instalador_Definitivo.exe` serve **somente para instalar/reparar as duas aplicacoes WEB locais** e configurar os atalhos/tarefa do Windows.

- **GFARM:** interface web React/FastAPI, servida no PC em `http://127.0.0.1:8000`.
- **GFARM Control:** interface web do painel em `http://127.0.0.1:8787`.
- **GFARM-Control.exe:** bootstrap fixo para iniciar o Control. Depois da instalacao, carrega `server.py`, `engine.py`, `ui.html` e `app.js` diretamente do codigo instalado via GitHub. Nao precisa ser recompilado a cada alteracao.
- **Atualizar pelo GitHub:** baixa `main` em pasta nova; valida migrations, compila frontend/backend, executa backup e troca versao com rollback. Se o codigo web do Control mudou, reinicia somente o bootstrap para carregar a nova versao. **Nao atualiza o instalador nem cria Releases.**
- O `GFARM.exe` tambem apenas abre o sistema web; o servidor real e mantido pelo Control.

## Instalador: tres caminhos

**Primeira instalacao:** baixa o GFARM da `main`, configura dependencias e a tarefa que inicia o painel. Abre o GFARM Control para configurar a conexao com o PostgreSQL existente.

**Reparar / instalar por cima (padrao):** reinstala os iniciadores e revalida o codigo local **sem trocar a versao do estoque**. Mantem banco, fotos, configuracao, senha do Control e backups. O Control novo inclui uma versao de recuperacao embutida se o codigo web local for legado; depois basta clicar em **Atualizar pelo GitHub**.

**Reinstalar os programas:** baixa um checkout novo do GFARM da `main` em pasta separada, verifica que migrations permanecem compativeis, reaproveita `backend.env` e os mesmos `uploads`, compila e **so entao** altera `control.json` para a nova versao. A versao anterior permanece disponivel. Nao apaga nem restaura o banco e nem substitui os dados persistentes. Se houver mudanca nas migrations, bloqueia a troca para revisao supervisionada.

O instalador interrompe somente os processos **verificados** do GFARM e do GFARM Control existentes antes de substituir os arquivos, sem interromper o servico do PostgreSQL. Se detectar API nao identificada, cancela antes de trocar o executavel.

## Onde ficam os dados

- Programas e atalhos: `C:\Program Files\GFARM`.
- Codigo e versoes: `C:\ProgramData\GFARM\installed` e `C:\ProgramData\GFARM\releases`.
- Dados persistentes: `C:\ProgramData\GFARM\data`.
- Configuracao: `C:\ProgramData\GFARM\control.json`.
- Senha do painel: `C:\ProgramData\GFARM\control-auth.json`.
- Chave privada GitHub: `C:\ProgramData\GFARM\secrets\github_deploy`.
- Backups: `C:\ProgramData\GFARM\backups`.

Nao compartilhar senhas, `backend.env`, `control-auth.json` ou chaves privadas.

## Primeiro acesso ao GitHub privado

O instalador aceita autenticacao GitHub do administrador no primeiro uso. Em maquinas que **ja possuem deploy key** de leitura, a reinstalacao a reutiliza automaticamente. Para o Control funcionar como servico SYSTEM, autorize uma unica vez a chave publica pelo painel **Acesso remoto → Mostrar chave publica** em [Deploy keys do GFARM](https://github.com/layon-lima/GFARM/settings/keys), sem acesso de escrita. Depois, atualizacoes futuras nao precisam da conta pessoal.

## Backup e fotos

Em **Backups → Recuperar fotos e documentos**, escolher o ZIP completo pelo seletor de arquivo, enviar e recuperar apenas `uploads/` e `xml_inbox/`. O PostgreSQL nao e restaurado nesse fluxo. O mobile carrega imagens do mesmo servidor local por `/uploads/`.

## Validar instalador Windows sem publicar

Para compilar com dois cliques, atualize o clone pelo GitHub e execute `GFARM APP/ops/gfarm_control/GERAR_INSTALADOR.cmd`. O gerador valida o codigo e coloca o EXE na Area de Trabalho, **sem publicar Release**.

Alternativa no PowerShell, na raiz do clone:

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File ".\GFARM APP\ops\gfarm_control\build_windows.ps1"
```

O script verifica sintaxe dos PowerShell, testes Python, compila o bootstrap, cria o instalador Inno Setup e imprime o SHA-256; **nao publica Release**.

Depois de testar o EXE numa maquina Windows, a publicacao **somente com aprovacao explicita** utiliza:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\GFARM APP\ops\gfarm_control\PUBLICAR_INSTALADOR_GITHUB.ps1" -VersaoAprovada
```

Esse comando **substitui os arquivos da unica Release** [GFARM Instalador Oficial](https://github.com/layon-lima/GFARM/releases/tag/gfarm-instalador-01aab5398bed), usando `gh release upload --clobber`. Nenhuma Release nova e criada.

### Confiabilidade

A compilacao e o teste funcional do EXE devem ser executados no Windows. Nao considerar o instalador validado ate verificar: primeira instalacao, reparo sobre dois programas rodando, reinstalacao preservando dados e uso do botao GitHub para atualizar ambas as interfaces web.
