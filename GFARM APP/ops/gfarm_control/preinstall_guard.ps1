#requires -Version 5.1
# Executado pelo instalador elevado ANTES de copiar qualquer EXE.
# Interrompe apenas GFARM e GFARM Control identificados na instalacao oficial.
# Nunca encerra PostgreSQL, outros Python ou processos nao identificados.
param([Parameter(Mandatory=$true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:ProgramData 'GFARM'
$configPath = Join-Path $root 'control.json'
$controlExe = Join-Path $InstallDir 'GFARM-Control.exe'
$taskName = 'GFARM Control'
$app = Join-Path $root 'installed\source\GFARM APP'
if (Test-Path -LiteralPath $configPath) {
    $configuration = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($configuration.app_path) { $app = [string]$configuration.app_path }
}
$backend = [IO.Path]::GetFullPath((Join-Path $app 'backend\run_production.py'))
$port = 8000
$envFile = Join-Path $root 'data\backend.env'
if (Test-Path -LiteralPath $envFile) {
    $portLine = Get-Content -LiteralPath $envFile |
        Where-Object { $_ -match '^\s*APP_PORT\s*=' } | Select-Object -Last 1
    if ($portLine -match '^\s*APP_PORT\s*=\s*["'']?(\d+)') {
        $port = [int]$Matches[1]
    }
}
function Busy([int]$checkPort) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect('127.0.0.1', $checkPort, $null, $null)
        if ($result.AsyncWaitHandle.WaitOne(700)) {
            try { $client.EndConnect($result) } catch {}
        }
        return $client.Connected
    } finally { $client.Close() }
}
function Find-Control {
    if (-not (Test-Path -LiteralPath $controlExe)) { return @() }
    $wanted = [IO.Path]::GetFullPath($controlExe)
    return @(Get-CimInstance Win32_Process -Filter "Name='GFARM-Control.exe'" |
        Where-Object { $_.ExecutablePath -and
            ([IO.Path]::GetFullPath([string]$_.ExecutablePath) -ieq $wanted) })
}
Write-Host 'Preparando instalacao sobre GFARM existente (banco preservado)...'
# Somente o backend da instalacao correspondente pode ser encerrado.
if (Busy $port) {
    $found = @(Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -match '^pythonw?\.exe$' -and
            $_.CommandLine -and
            $_.CommandLine.Contains($backend)
        })
    if ($found.Count -ne 1) {
        throw "API na porta $port nao foi identificada com seguranca. Feche o GFARM pelo Control, depois execute novamente o instalador. Nenhum dado foi alterado."
    }
    $apiPid = [int]$found[0].ProcessId
    Write-Host "Encerrando somente a API local do GFARM, PID $apiPid..."
    Stop-Process -Id $apiPid -Force -ErrorAction Stop
    Start-Sleep -Seconds 2
    if (Busy $port) {
        throw "API do GFARM nao encerrou na porta $port. Instalacao bloqueada."
    }
}
# Somente depois de parar a API, encerrar o Control e a tarefa.
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
for ($i=0; $i -lt 10; $i++) {
    if (@(Find-Control).Count -eq 0) { break }
    Start-Sleep -Seconds 1
}
foreach ($process in @(Find-Control)) {
    Write-Host ("Encerrando somente GFARM-Control.exe instalado, PID " + $process.ProcessId)
    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
}
Start-Sleep -Seconds 1
if (@(Find-Control).Count -gt 0) {
    throw "GFARM Control ainda esta em uso. Instalacao cancelada antes de substituir o EXE."
}
Write-Host 'Instalacao segura: backend e Control parados; PostgreSQL preservado.'
