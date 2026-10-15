# Diagnostico SEM MUDAR estado do Windows, PostgreSQL ou Cloudflare.
param([string]$Projeto = "")
$ErrorActionPreference = "Continue"
if (-not $Projeto) { $Projeto = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }
Write-Host "ESTQ - DIAGNOSTICO DE INICIALIZACAO" -ForegroundColor Cyan
Write-Host "Projeto: $Projeto"
$startup = [Environment]::GetFolderPath("Startup")
$shortcut = Join-Path $startup "ESTQ - Inicializacao GitHub.lnk"
Write-Host "Atalho presente: $(Test-Path $shortcut)"
Write-Host "Env presente: $(Test-Path (Join-Path $Projeto 'backend\.env'))"
Write-Host "Dist presente: $(Test-Path (Join-Path $Projeto 'dist\index.html'))"
Write-Host "Python presente: $(Test-Path (Join-Path $Projeto 'backend\.venv\Scripts\python.exe'))"

try {
    $response = Invoke-RestMethod "http://127.0.0.1:8000/api/health" -TimeoutSec 5
    Write-Host "API: $($response.status)" -ForegroundColor Green
} catch {
    Write-Host "API: INDISPONIVEL — $($_.Exception.Message)" -ForegroundColor Yellow
}
$logroot = Join-Path $env:LOCALAPPDATA "ESTQ-Inicializacao"
foreach ($name in @("monitor.log", "backend-startup.log")) {
    $path = Join-Path $logroot $name
    Write-Host ""
    Write-Host "ULTIMAS LINHAS: $path"
    if (Test-Path $path) {
        Get-Content -LiteralPath $path -Tail 35
    } else {
        Write-Host "Log ainda nao existe: monitor nao iniciou ou nao gravou."
    }
}
try {
    $svc = Get-Service -Name "cloudflared" -ErrorAction Stop
    Write-Host "Cloudflare Tunnel service: $($svc.Status)"
} catch {
    Write-Host "Cloudflare Tunnel: nenhum servico cloudflared com esse nome."
}
Write-Host "Este diagnostico nao inicia nem altera processos."
