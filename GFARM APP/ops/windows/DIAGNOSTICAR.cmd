@echo off
setlocal
pushd "%~dp0..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0DIAGNOSTICAR_INICIALIZACAO.ps1"
popd
pause
