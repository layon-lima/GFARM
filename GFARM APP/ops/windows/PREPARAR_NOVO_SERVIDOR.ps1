# Preparar ambiente local de um novo servidor Windows SEM criar/restaurar banco.
param([string]$Projeto = "")
$ErrorActionPreference = "Stop"
if (-not $Projeto) { $Projeto = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }
$Projeto = (Resolve-Path $Projeto).Path
$Backend = Join-Path $Projeto "backend"
if (-not (Test-Path (Join-Path $Backend "run_production.py"))) { throw "Pasta errada: run_production.py não encontrado." }

$PythonGlobal = Get-Command py -ErrorAction SilentlyContinue
if ($PythonGlobal) {
    & py -3.13 -m venv (Join-Path $Backend ".venv")
} else {
    $PythonGlobal = Get-Command python -ErrorAction SilentlyContinue
    if (-not $PythonGlobal) { throw "Instale Python 3.13 antes de continuar." }
    & python -m venv (Join-Path $Backend ".venv")
}
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar venv." }
$VenvPython = Join-Path $Backend ".venv\Scripts\python.exe"
& $VenvPython -m pip install -r (Join-Path $Backend "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar dependências Python." }

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Instale Node.js LTS (com npm)."
}
Push-Location $Projeto
try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci falhou." }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build do frontend falhou." }
} finally { Pop-Location }
Write-Host "APP PREPARADO: Python e frontend instalados sem tocar no banco." -ForegroundColor Green
Write-Host "PRÓXIMO: configure backend/.env (fora do Git), prepare PostgreSQL vazio,"
Write-Host "restaure o backup, valide os dados e só então instale a inicialização."
