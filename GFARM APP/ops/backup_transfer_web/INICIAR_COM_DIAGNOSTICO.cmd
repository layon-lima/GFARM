@echo off
chcp 65001 >nul
set "PROJETO=C:\Users\User\Documents\Layon\PROJETOS PYTHON\PROJETO"
set "PYTHON=%PROJETO%\.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=%PROJETO%\backend\.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"
"%PYTHON%" "%~dp0painel_backup.py" "%PROJETO%"
echo.
echo Verifique as mensagens acima se o painel nao abriu.
pause
