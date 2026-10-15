# Ativa/desativa pausa do monitor SEM parar banco, backend ou Cloudflare.
param(
    [switch]$Ativar,
    [switch]$Desativar
)
$ErrorActionPreference = "Stop"
if ($Ativar -eq $Desativar) {
    throw "Use -Ativar OU -Desativar."
}
$Dir = Join-Path $env:LOCALAPPDATA "ESTQ-Inicializacao"
$Arquivo = Join-Path $Dir "maintenance.flag"
if ($Ativar) {
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    New-Item -ItemType File -Force -Path $Arquivo | Out-Null
    Write-Host "MONITOR PAUSADO. Agora pare o backend pelo painel antes de exportar." -ForegroundColor Yellow
    Write-Host "O PostgreSQL deve continuar LIGADO durante o backup."
} else {
    if (Test-Path $Arquivo) { Remove-Item -LiteralPath $Arquivo -Force }
    Write-Host "MONITOR REATIVADO. O backend voltara a ser supervisionado." -ForegroundColor Green
}
