#requires -Version 5.1
# Preparacao segura antes de substituir os executaveis.
# NAO altera PostgreSQL, control.json, credenciais, fotos, XMLs ou backups.
param([Parameter(Mandatory=$true)][string]$InstallDir)

$ErrorActionPreference = 'Stop'
$root = Join-Path $env:ProgramData 'GFARM'
$diagnostic = Join-Path $root 'preinstall-last-error.txt'
$log = Join-Path $root 'preinstall.log'
$controlExe = Join-Path $InstallDir 'GFARM-Control.exe'
$taskName = 'GFARM Control'
$port = 8000

function Note([string]$message) {
    $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message)
    Write-Host $line
    Add-Content -LiteralPath $log -Encoding UTF8 -Value $line
}
function Get-ListeningPids([int]$listenPort) {
    # Identificar o dono REAL da porta, sem procurar todos os processos Python.
    $connections = @(Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue)
    return @($connections | ForEach-Object { [int]$_.OwningProcess } |
        Where-Object { $_ -gt 0 } | Sort-Object -Unique)
}
function Wait-NoListeners([int]$listenPort, [int]$seconds) {
    for ($i=0; $i -lt $seconds; $i++) {
        if (@(Get-ListeningPids $listenPort).Count -eq 0) { return $true }
        Start-Sleep -Seconds 1
    }
    return (@(Get-ListeningPids $listenPort).Count -eq 0)
}
function Get-ControlProcesses {
    if (-not (Test-Path -LiteralPath $controlExe -PathType Leaf)) { return @() }
    $wanted = [IO.Path]::GetFullPath($controlExe)
    return @(Get-CimInstance Win32_Process -Filter "Name='GFARM-Control.exe'" -ErrorAction Stop |
        Where-Object { $_.ExecutablePath -and
            ([IO.Path]::GetFullPath([string]$_.ExecutablePath) -ieq $wanted) })
}
function Wait-ControlStopped([int]$seconds) {
    for ($i=0; $i -lt $seconds; $i++) {
        if (@(Get-ControlProcesses).Count -eq 0) { return $true }
        Start-Sleep -Seconds 1
    }
    return (@(Get-ControlProcesses).Count -eq 0)
}

try {
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    Set-Content -LiteralPath $diagnostic -Encoding UTF8 -Value 'Preparacao iniciada.'
    Note 'Iniciando preparacao de reparo/reinstalacao do GFARM.'
    $app = Join-Path $root 'installed\source\GFARM APP'
    $cfg = Join-Path $root 'control.json'
    if (Test-Path -LiteralPath $cfg -PathType Leaf) {
        $config = Get-Content -LiteralPath $cfg -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($config.app_path) { $app = [string]$config.app_path }
    }
    $backend = [IO.Path]::GetFullPath((Join-Path $app 'backend\run_production.py'))
    $expectedPython = [IO.Path]::GetFullPath((Join-Path $app 'backend\.venv\Scripts\python.exe'))

    $envFile = Join-Path $root 'data\backend.env'
    if (Test-Path -LiteralPath $envFile -PathType Leaf) {
        $portLine = Get-Content -LiteralPath $envFile |
            Where-Object { $_ -match '^\s*APP_PORT\s*=' } | Select-Object -Last 1
        if ($portLine -match '^\s*APP_PORT\s*=\s*["'']?(\d+)') {
            $port = [int]$Matches[1]
        }
    }

    $owners = @(Get-ListeningPids $port)
    if ($owners.Count -gt 0) {
        Note ("API porta $port: PID(s) " + ($owners -join ', ') + ".")
        # Unicamente o dono da porta pode ser parado. O processo PRECISA ser
        # o run_production.py da instalacao configurada em control.json.
        foreach ($ownerPid in $owners) {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction Stop
            $cmd = [string]$process.CommandLine
            $exe = [string]$process.ExecutablePath
            $pythonValid = ($process.Name -match '^pythonw?\.exe$')
            $scriptValid = $cmd -match '(?i)run_production\.py'
            $pathValid = (($cmd.IndexOf($backend, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
                ($exe -and [IO.Path]::GetFullPath($exe) -ieq $expectedPython))
            if (-not ($pythonValid -and $scriptValid -and $pathValid)) {
                throw ("Porta $port pertence ao processo PID $ownerPid, nao confirmado como GFARM. " +
                    'Abra GFARM Control > Servidor > Desligar GFARM e tente novamente. ' +
                    'Nao encerraremos outros processos automaticamente.')
            }
            Note ("Encerrando somente backend GFARM confirmado, PID $ownerPid.")
            Stop-Process -Id $ownerPid -Force -ErrorAction Stop
        }
        if (-not (Wait-NoListeners $port 15)) {
            throw "API na porta $port ainda esta ativa. Pare o GFARM pelo Control antes de reinstalar."
        }
        Note 'Backend GFARM encerrado; PostgreSQL nao foi interrompido.'
    } else {
        Note "Nenhum processo ouvindo na porta GFARM $port."
    }

    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        # Nunca parar uma tarefa alterada para apontar a outro executavel.
        $action = @($task.Actions | Select-Object -First 1)[0]
        if ($action -and $action.Execute) {
            $taskExe = [Environment]::ExpandEnvironmentVariables(
                [string]$action.Execute.Trim('"'))
            $expectedExe = [IO.Path]::GetFullPath($controlExe)
            if ([IO.Path]::GetFullPath($taskExe) -ine $expectedExe) {
                throw 'A tarefa GFARM Control aponta para executavel diferente. Instalacao bloqueada por seguranca.'
            }
        }
        Note 'Solicitando parada da tarefa oficial GFARM Control...'
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    }
    if (-not (Wait-ControlStopped 8)) {
        foreach ($instance in @(Get-ControlProcesses)) {
            $controlPid = [int]$instance.ProcessId
            Note ("Encerrando somente Control oficial confirmado, PID $controlPid.")
            Stop-Process -Id $controlPid -Force -ErrorAction Stop
        }
        if (-not (Wait-ControlStopped 15)) {
            throw 'GFARM-Control.exe continua aberto. Nao e seguro substituir seu arquivo.'
        }
    }
    Note 'Preparacao concluida: GFARM e Control encerrados. Banco e backups intocados.'
    Set-Content -LiteralPath $diagnostic -Encoding UTF8 -Value 'OK'
    exit 0
}
catch {
    $detail = $_.Exception.Message
    $line = 'Falha de preparacao: ' + $detail
    try {
        Set-Content -LiteralPath $diagnostic -Encoding UTF8 -Value $line
        Note $line
    } catch {}
    Write-Host $line -ForegroundColor Red
    exit 1
}
