@echo off
setlocal EnableExtensions
title GFARM - Copiar codigo e compilar na Area de Trabalho
set "PATH=%SystemRoot%\System32;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
echo.
echo =====================================================
echo  GFARM - Compilacao no seu PC, sem GitHub Actions
echo =====================================================
echo.

set "GFARM_DESKTOP="
for /f "usebackq delims=" %%D in (`powershell.exe -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "GFARM_DESKTOP=%%D"
if not defined GFARM_DESKTOP goto :fail
if not exist "%GFARM_DESKTOP%" goto :fail

call :findgit
if defined GFARM_GIT goto :gitready
echo Instalando Git no Windows...
winget install --id Git.Git --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto :fail
call :findgit
if not defined GFARM_GIT goto :fail

:gitready
for %%G in ("%GFARM_GIT%") do set "PATH=%%~dpG;%PATH%"
set "GFARM_BUILD_DIR=%GFARM_DESKTOP%\GFARM-CODIGO"
:choosefolder
if not exist "%GFARM_BUILD_DIR%" goto :download
set "GFARM_BUILD_DIR=%GFARM_DESKTOP%\GFARM-CODIGO-%RANDOM%"
goto :choosefolder

:download
echo [1/2] Copiando todo o codigo atual para a Area de Trabalho...
echo Se o GitHub abrir o navegador, entre na sua conta para baixar o repositorio privado.
"%GFARM_GIT%" clone --depth 1 --single-branch --branch main https://github.com/layon-lima/GFARM.git "%GFARM_BUILD_DIR%"
if errorlevel 1 goto :fail
set "GFARM_BUILD_LOG=%GFARM_DESKTOP%\GFARM-COMPILACAO.log"
echo.
echo [2/2] Compilando dentro da pasta copiada...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Start-Transcript -LiteralPath $env:GFARM_BUILD_LOG -Append | Out-Null; try { & (Join-Path $env:GFARM_BUILD_DIR 'GFARM APP\ops\gfarm_control\build_windows.ps1') } finally { Stop-Transcript | Out-Null }"
if errorlevel 1 goto :fail
echo.
echo PRONTO: GFARM_Instalador_Definitivo.exe esta na sua Area de Trabalho.
echo Abra esse arquivo para instalar os programas neste PC.
echo Nenhum credito do GitHub Actions foi utilizado.
pause
exit /b 0

:findgit
set "GFARM_GIT="
for /f "delims=" %%G in ('where git.exe 2^>nul') do if not defined GFARM_GIT set "GFARM_GIT=%%G"
if defined GFARM_GIT exit /b 0
if exist "%ProgramFiles%\Git\cmd\git.exe" set "GFARM_GIT=%ProgramFiles%\Git\cmd\git.exe"
if defined GFARM_GIT exit /b 0
if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "GFARM_GIT=%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
exit /b 0

:fail
echo.
echo A compilacao parou. O erro esta escrito acima.
echo Se o log foi criado, ele esta na Area de Trabalho: GFARM-COMPILACAO.log
pause
exit /b 1
