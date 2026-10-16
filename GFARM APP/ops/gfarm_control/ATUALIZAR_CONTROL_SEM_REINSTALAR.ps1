#requires -Version 5.1
#requires -RunAsAdministrator
# Atualiza APENAS o GFARM-Control.exe instalado, sem gerar instalador.
# Preserva PostgreSQL, arquivos GFARM, credenciais, tarefas e backups.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $here '..\..\..')).Path
$target = Join-Path $env:ProgramFiles 'GFARM\GFARM-Control.exe'
$taskName = 'GFARM Control'
$build = Join-Path $here 'build'
$output = Join-Path $build 'control-only'
$exe = Join-Path $output 'GFARM-Control.exe'
$backupDir = Join-Path $env:ProgramData 'GFARM\control-previous'
$backup = Join-Path $backupDir ('GFARM-Control-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.exe')

function Check-Exit([string]$step) {
    if ($LASTEXITCODE -ne 0) { throw "$step falhou (codigo $LASTEXITCODE)." }
}
function Wait-ControlStopped {
    for ($i = 0; $i -lt 45; $i++) {
        $active = @(Get-CimInstance Win32_Process -Filter "Name='GFARM-Control.exe'" |
            Where-Object { $_.ExecutablePath -ieq $target })
        if ($active.Count -eq 0) { return }
        Start-Sleep -Seconds 1
    }
    throw 'O GFARM Control nao encerrou com seguranca. Nada sera sobrescrito.'
}
function Check-Health {
    for ($i = 0; $i -lt 40; $i++) {
        try {
            $answer = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/bootstrap' -TimeoutSec 2
            if ($answer.StatusCode -eq 200 -and
                    [string]$answer.Headers['Server'] -like 'GFARMControl/*') { return }
        } catch {}
        Start-Sleep -Seconds 1
    }
    throw 'Control nao respondeu na porta 8787 depois da atualizacao.'
}

if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "Control instalado nao encontrado em $target"
}
# Nao deixar a API antiga orfa ao trocar o Control: o gerenciador novo
# precisa possuir o processo da API para conseguir ligar/desligar com seguranca.
$dbEnv = Join-Path $env:ProgramData 'GFARM\data\backend.env'
$apiPort = 8000
if (Test-Path -LiteralPath $dbEnv) {
    $portLine = Get-Content -LiteralPath $dbEnv | Where-Object { $_ -match '^APP_PORT\s*=' } | Select-Object -Last 1
    if ($portLine -match '^APP_PORT\s*=\s*["'']?([0-9]+)') {
        $apiPort = [int]$Matches[1]
    }
}
$tcp = New-Object System.Net.Sockets.TcpClient
try {
    $wait = $tcp.BeginConnect('127.0.0.1', $apiPort, $null, $null)
    if ($wait.AsyncWaitHandle.WaitOne(1000)) {
        try { $tcp.EndConnect($wait) } catch {}
    }
    if ($tcp.Connected) {
        throw "Primeiro abra GFARM Control > Servidor > Desligar GFARM, aguarde e execute novamente. API ativa na porta $apiPort. Nada foi modificado."
    }
} finally {
    $tcp.Close()
}
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$action = @($task.Actions)[0]
if (-not $action -or $action.Execute.Trim('"') -ine $target) {
    throw 'A tarefa do GFARM Control aponta para outro programa. Atualizacao bloqueada.'
}
$git = (Get-Command git.exe -ErrorAction Stop).Source
Push-Location $repo
try {
    $origin = (& $git remote get-url origin).Trim()
    Check-Exit 'Conferencia do GitHub'
    if ($origin -notmatch 'github\.com[:/]layon-lima/GFARM(\.git)?$') {
        throw 'Repositorio Git inesperado.'
    }
    $changes = (& $git status --porcelain --untracked-files=no | Out-String).Trim()
    if ($changes) { throw 'Ha alteracoes locais ainda nao publicadas. Nao atualize antes de guarda-las.' }
    & $git pull --ff-only origin main
    Check-Exit 'Atualizacao do codigo GFARM main'
} finally { Pop-Location }

Push-Location $here
try {
    Write-Host '[1/4] Validando codigo do GFARM Control...'
    & py -3.13 -m py_compile server.py engine.py
    Check-Exit 'Validacao Python'
    & py -3.13 test_control.py
    Check-Exit 'Testes isolados do Control'

    Write-Host '[2/4] Compilando somente o Control, sem instalador...'
    & py -3.13 -m pip install --disable-pip-version-check pyinstaller pillow
    Check-Exit 'Dependencias de compilacao'
    & py -3.13 create_icons.py
    Check-Exit 'Geracao de icones'
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    $args = @(
        '-3.13', '-m', 'PyInstaller', '--noconfirm', '--onefile', '--windowed', '--clean',
        '--paths', $here, '--hidden-import', 'engine',
        '--add-data', "$here\ui.html;.", '--add-data', "$here\app.js;.",
        '--icon', "$build\GFARM-Control.ico",
        '--distpath', $output,
        '--workpath', "$build\work-control-only",
        '--specpath', "$build\spec",
        '--name', 'GFARM-Control', 'server.py'
    )
    & py @args
    Check-Exit 'Compilacao GFARM-Control.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -or
        (Get-Item -LiteralPath $exe).Length -lt 1000000) {
        throw 'GFARM-Control.exe nao foi gerado corretamente.'
    }
} finally { Pop-Location }

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backedUp = $false
try {
    Write-Host '[3/4] Parando APENAS o Control e preservando seu EXE anterior...'
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Wait-ControlStopped
    Copy-Item -LiteralPath $target -Destination $backup -ErrorAction Stop
    $backedUp = $true
    Copy-Item -LiteralPath $exe -Destination $target -Force -ErrorAction Stop

    Write-Host '[4/4] Reiniciando Control e validando a porta 8787...'
    Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
    Check-Health
    Write-Host 'GFARM CONTROL ATUALIZADO COM SUCESSO!' -ForegroundColor Green
    Write-Host 'Abra http://127.0.0.1:8787, entre em Backups e escolha seu arquivo ZIP.'
    Write-Host "Copia de seguranca do EXE anterior: $backup"
} catch {
    $errorMessage = $_.Exception.Message
    if ($backedUp) {
        Write-Host "Falha: $errorMessage. Restaurando EXE anterior..." -ForegroundColor Yellow
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Wait-ControlStopped
        Copy-Item -LiteralPath $backup -Destination $target -Force
        Start-ScheduledTask -TaskName $taskName
        Write-Host 'EXE anterior restaurado e tarefa reiniciada.'
    }
    throw $errorMessage
}
