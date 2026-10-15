# Executar no PowerShell do PC servidor, após clonar/atualizar o GitHub.
# Não altera PostgreSQL, banco, uploads nem Cloudflare.
param(
    [string]$Projeto = ""
)
$ErrorActionPreference = "Stop"
if (-not $Projeto) {
    $Projeto = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$Projeto = (Resolve-Path $Projeto).Path
$Backend = Join-Path $Projeto "backend"
$Monitor = Join-Path $Projeto "ops\monitor_backend.py"
$Python = @(
    (Join-Path $Backend ".venv\Scripts\pythonw.exe"),
    (Join-Path $Projeto ".venv\Scripts\pythonw.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $Python) { throw "Pythonw da .venv não encontrado. Prepare o ambiente primeiro." }
if (-not (Test-Path (Join-Path $Backend ".env"))) { throw "backend/.env ausente." }
if (-not (Test-Path $Monitor)) { throw "Monitor do GitHub não encontrado." }
if (-not (Test-Path (Join-Path $Projeto "dist\index.html"))) { throw "Frontend ainda não compilado (dist)." }

$Startup = [Environment]::GetFolderPath("Startup")
$BackupDir = Join-Path $env:LOCALAPPDATA "ESTQ-Inicializacao\startup-antigo"
New-Item -Path $BackupDir -ItemType Directory -Force | Out-Null

# Conserva cópias dos inicializadores antigos sem deixá-los em execução dupla.
foreach ($nome in @("INDEX ERP.vbs", "ESTQ - Inicializacao Automatica.lnk", "ESTQ - Inicialização Automática.lnk")) {
    $antigo = Join-Path $Startup $nome
    if (Test-Path $antigo) {
        $destino = Join-Path $BackupDir ("{0}_{1}" -f (Get-Date -Format "yyyyMMdd_HHmmss_fff"), $nome)
        Move-Item -LiteralPath $antigo -Destination $destino -ErrorAction Stop
    }
}

$Lnk = Join-Path $Startup "ESTQ - Inicializacao GitHub.lnk"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($Lnk)
$Shortcut.TargetPath = $Python
$Shortcut.Arguments = ('"{0}" --project-dir "{1}"' -f $Monitor, $Projeto)
$Shortcut.WorkingDirectory = $Projeto
$Shortcut.Description = "Monitor do backend ESTQ (fonte GitHub)"
$Shortcut.Save()
if (-not (Test-Path $Lnk)) { throw "Não foi possível criar o atalho de inicialização." }

# O processo oculto é independente do painel. Sua própria trava impede duplicação.
Start-Process -FilePath $Python -ArgumentList $Shortcut.Arguments -WorkingDirectory $Projeto -WindowStyle Hidden

Write-Host ""
Write-Host "INICIALIZACAO AUTOMATICA CONFIGURADA" -ForegroundColor Green
Write-Host "Projeto: $Projeto"
Write-Host "Atalho: $Lnk"
Write-Host "Log: $env:LOCALAPPDATA\ESTQ-Inicializacao\monitor.log"
Write-Host "O monitor verifica o backend mesmo se o painel não estiver aberto."
Write-Host "Funciona ao ENTRAR no Windows; não mantém o computador desligado online."
Write-Host "Cloudflare Tunnel é independente e requer serviço próprio."
