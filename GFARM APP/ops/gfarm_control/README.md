# GFARM Control — instalador definitivo Windows

O instalador `GFARM_Instalador_Definitivo.exe` instala o GFARM e o gerenciador independente **GFARM Control**. Baixa os arquivos atuais da branch `main` do GitHub privado.

## Compilar

Na raiz do repositório:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\GFARM APP\ops\gfarm_control\build_windows.ps1"
```

O build cria `GFARM_Instalador_Definitivo.exe` em `build/` e copia o executável para a Área de Trabalho.

## Publicar no GitHub e limpar versões antigas

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\GFARM APP\ops\gfarm_control\PUBLICAR_INSTALADOR_GITHUB.ps1"
```

O segundo comando compila e publica a versão atual em GitHub Releases. Depois de validar a presença do EXE novo, exclui as Releases obsoletas `painel-estq-*` e as tags correspondentes. Requer autorização no GitHub CLI (`gh`).

## Dados e servidor

- Iniciadores: `C:\Program Files\GFARM`.
- Código instalado: `C:\ProgramData\GFARM\installed\source\GFARM APP`.
- Versões posteriores: `C:\ProgramData\GFARM\releases`.
- Dados e credenciais locais: `C:\ProgramData\GFARM\data`.
- Control local: `http://127.0.0.1:8787`.
- API local: `http://127.0.0.1:8000`.
- Logs: `C:\ProgramData\GFARM\instalacao.log`, `C:\Users\Public\Documents\GFARM-Instalacao.log`.

O PostgreSQL existente não é sobrescrito pelo instalador. O backup histórico privado em `BACKUPS` permanece preservado. Não publique senhas, `.env` nem chaves privadas.
