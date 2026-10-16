@echo off
setlocal EnableExtensions
title GFARM - Gerar instalador para testes
cd /d "%~dp0..\..\.." || goto :fail
echo.
echo =====================================================
echo  GFARM - Gerar instalador Windows (SEM PUBLICAR)
echo =====================================================
echo.
echo [1/2] Obtendo atualizacoes do GitHub...
git pull --ff-only origin main
if errorlevel 1 (
  echo.
  echo ERRO: git pull falhou. Nenhum instalador sera publicado.
  goto :fail
)
echo.
echo [2/2] Validando codigo e compilando o instalador...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\GFARM APP\ops\gfarm_control\build_windows.ps1"
if errorlevel 1 goto :fail
echo.
echo INSTALADOR GERADO COM SUCESSO.
echo Arquivo na Area de Trabalho: GFARM_Instalador_Definitivo.exe
echo Teste o reparo e a reinstalacao preservando os dados.
echo Nenhuma Release do GitHub foi alterada.
pause
exit /b 0

:fail
echo.
echo COMPILACAO INTERROMPIDA. Nenhum dado ou Release foi removido.
pause
exit /b 1
