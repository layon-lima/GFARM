# Entrypoint limitado para o par de chaves SSH do PAINEL_ESTQ.
# OpenSSH force-command: jamais executar comandos recebidos livremente.
param([Parameter(Mandatory=$true)][string]$Projeto)
$ErrorActionPreference = "Stop"
$action = $env:SSH_ORIGINAL_COMMAND
if ($action -cne "status" -and $action -cne "update") {
    Write-Error "Comando remoto não autorizado."
    exit 43
}
$python = Join-Path $Projeto "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $python = Join-Path $Projeto ".venv\Scripts\python.exe"
}
$script = Join-Path $Projeto "ops\remote_update.py"
if (-not (Test-Path $python) -or -not (Test-Path $script)) {
    Write-Error "Servidor não preparado. Verifique o projeto local."
    exit 44
}
& $python $script --project-dir $Projeto $action
exit $LASTEXITCODE
