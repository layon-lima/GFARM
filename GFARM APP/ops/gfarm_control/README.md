# GFARM Control — instalador Windows

O `GFARM_Instalador_Definitivo.exe` instala o GFARM e o gerenciador independente GFARM Control. Os fontes atuais são obtidos da branch `main` do GitHub privado.

## Compilar para testar (sem publicar)

Na raiz do repositório Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\GFARM APP\ops\gfarm_control\build_windows.ps1"
```

O EXE é gerado em `build` e copiado para a Área de Trabalho. **A compilação não altera as Releases do GitHub.**

## Publicar exclusivamente uma versão aprovada

Somente após teste e aprovação explícita:

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File ".\GFARM APP\ops\gfarm_control\PUBLICAR_INSTALADOR_GITHUB.ps1" -VersaoAprovada
```

O script usa o GitHub CLI já autenticado e atualiza **somente a Release existente** [GFARM - Instalador Oficial](https://github.com/layon-lima/GFARM/releases/tag/gfarm-instalador-01aab5398bed), substituindo os dois arquivos `.exe` e `.sha256`. **Não cria novas Releases nem novas tags; se houver discrepância, bloqueia a publicação.** Código enviado a `main` não publica EXE automaticamente.

## Dados e servidor

- Iniciadores: `C:\Program Files\GFARM`.
- Código instalado: `C:\ProgramData\GFARM\installed\source\GFARM APP`.
- Configuração e uploads persistentes: `C:\ProgramData\GFARM\data`.
- Control local: `http://127.0.0.1:8787`.
- API local: `http://127.0.0.1:8000`.

O banco PostgreSQL existente não é sobrescrito pelo instalador. O backup histórico privado em `BACKUPS` permanece preservado. Não publique senhas, `.env` nem chaves privadas.
