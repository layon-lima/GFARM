@echo off
setlocal
pushd "%~dp0..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0PREPARAR_NOVO_SERVIDOR.ps1"
if errorlevel 1 echo FALHA: confira pré-requisitos e tente novamente.
popd
pause
