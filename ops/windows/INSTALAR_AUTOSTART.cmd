@echo off
setlocal
pushd "%~dp0..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_INICIALIZACAO.ps1"
if errorlevel 1 echo FALHA: leia o erro acima.
popd
pause
