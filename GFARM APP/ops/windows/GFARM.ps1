# GFARM - gerenciador unico por PowerShell (Windows 11, PowerShell 5.1+).
# Instala/migra/atualiza a main do GitHub. Nao usa GFARM Control,
# GitHub Actions, executavel instalador ou migracao automatica do banco.
[CmdletBinding()]
param(
    [ValidateSet('Instalar', 'Migrar', 'Atualizar', 'Iniciar', 'Parar', 'Reiniciar', 'Status', 'Logs', 'Backup')]
    [string]$Acao = 'Migrar'
)

$ErrorActionPreference = 'Stop'
$homeDir = Join-Path $env:ProgramData 'GFARM'
$configFile = Join-Path $homeDir 'servidor.json'
$dataDir = Join-Path $homeDir 'data'
$dataEnv = Join-Path $dataDir 'backend.env'
$uploadsDir = Join-Path $dataDir 'uploads'
$canonicalApp = Join-Path $homeDir 'app'
$runtimeDir = Join-Path $homeDir 'gfarm-runtime'
$managerFile = Join-Path $homeDir 'GFARM.ps1'
$serviceFile = Join-Path $homeDir 'GFARM-Servico.py'
$logFile = Join-Path $homeDir 'gfarm-manutencao.log'
$taskName = 'GFARM Servidor'
$oldTaskName = 'GFARM Control'
$repoHttps = 'https://github.com/layon-lima/GFARM.git'
$repoSsh = 'git@github.com:layon-lima/GFARM.git'

function Informar([string]$message) {
    Write-Host $message
    if (Test-Path -LiteralPath $homeDir) {
        try {
            Add-Content -LiteralPath $logFile -Encoding UTF8 -Value (
                (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' | ' + $message
            )
        } catch { }
    }
}

function Exigir-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Abra o PowerShell COMO ADMINISTRADOR. Nenhum arquivo foi alterado.'
    }
}

function Ler-Config {
    if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) { return $null }
    return Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Salvar-Config($config) {
    $temp = $configFile + '.novo'
    $json = $config | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText(
        $temp, $json, (New-Object System.Text.UTF8Encoding($false))
    )
    Move-Item -LiteralPath $temp -Destination $configFile -Force
}

function Encontrar-Exe([string]$name, [string[]]$alternativas) {
    $cmd = Get-Command -Name $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($path in $alternativas) {
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) { return $path }
    }
    return $null
}

function Atualizar-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = $machine + ';' + $user + ';' + $env:Path
}

function Instalar-Dependencia([string]$descricao, [string]$id) {
    $winget = Encontrar-Exe 'winget.exe' @()
    if (-not $winget) { throw "$descricao nao encontrado. Instale $descricao com winget e execute novamente." }
    Informar "Instalando dependencia ausente: $descricao"
    & $winget install --id $id --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw "A instalacao de $descricao falhou. Nenhum servico foi substituido." }
    Atualizar-Path
}

function Obter-Git {
    $path = Encontrar-Exe 'git.exe' @(
        (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
    )
    if (-not $path) {
        Instalar-Dependencia 'Git' 'Git.Git'
        $path = Encontrar-Exe 'git.exe' @(
            (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
        )
    }
    if (-not $path) { throw 'Git nao localizado apos instalacao.' }
    return $path
}

function Obter-Npm {
    $path = Encontrar-Exe 'npm.cmd' @((Join-Path $env:ProgramFiles 'nodejs\npm.cmd'))
    if (-not $path) {
        Instalar-Dependencia 'Node.js LTS' 'OpenJS.NodeJS.LTS'
        $path = Encontrar-Exe 'npm.cmd' @((Join-Path $env:ProgramFiles 'nodejs\npm.cmd'))
    }
    if (-not $path) { throw 'npm.cmd nao encontrado apos instalar Node.js.' }
    return $path
}

function Preparar-Runtime {
    $python = Join-Path $runtimeDir 'Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
        $launcher = Encontrar-Exe 'py.exe' @((Join-Path $env:WINDIR 'py.exe'))
        $python313 = Encontrar-Exe 'python.exe' @(
            (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'),
            (Join-Path $env:ProgramFiles 'Python313\python.exe')
        )
        $validLauncher = $false
        if ($launcher) {
            & $launcher -3.13 --version 2>$null | Out-Null
            $validLauncher = ($LASTEXITCODE -eq 0)
        }
        if (-not $validLauncher -and $python313) {
            $version = (& $python313 --version 2>&1 | Out-String).Trim()
            if ($version -notmatch '^Python 3\.13\.') { $python313 = $null }
        }
        if (-not $validLauncher -and -not $python313) {
            Instalar-Dependencia 'Python 3.13' 'Python.Python.3.13'
            $launcher = Encontrar-Exe 'py.exe' @((Join-Path $env:WINDIR 'py.exe'))
            if ($launcher) {
                & $launcher -3.13 --version 2>$null | Out-Null
                $validLauncher = ($LASTEXITCODE -eq 0)
            }
            if (-not $validLauncher) {
                $python313 = Encontrar-Exe 'python.exe' @(
                    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'),
                    (Join-Path $env:ProgramFiles 'Python313\python.exe')
                )
            }
        }
        if ($validLauncher) {
            & $launcher -3.13 -m venv $runtimeDir
        } elseif ($python313) {
            & $python313 -m venv $runtimeDir
        } else {
            throw 'Python 3.13 indisponivel. O servidor antigo nao foi alterado.'
        }
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar runtime Python do GFARM.' }
    }
    $pythonw = Join-Path $runtimeDir 'Scripts\pythonw.exe'
    if (-not (Test-Path $python) -or -not (Test-Path $pythonw)) {
        throw 'Runtime Python incompleto. Nenhuma troca de servidor foi iniciada.'
    }
    return $python
}

function Obter-Repo {
    $key = Join-Path $homeDir 'secrets\github_deploy'
    if (Test-Path -LiteralPath $key -PathType Leaf) {
        $ssh = Encontrar-Exe 'ssh.exe' @((Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'))
        if (-not $ssh) { throw 'Chave GitHub existente, mas OpenSSH nao foi encontrado.' }
        # Somente esta sessao PowerShell recebe a configuracao SSH.
        $env:GIT_SSH_COMMAND = ('"{0}" -i "{1}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' -f $ssh, $key)
        $env:GIT_TERMINAL_PROMPT = '0'
        return $repoSsh
    }
    $env:GIT_TERMINAL_PROMPT = '1'
    return $repoHttps
}

function Porta-Ocupada([int]$port) {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $async = $null
    try {
        $async = $tcp.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(400)) { return $false }
        $tcp.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        if ($async) { $async.AsyncWaitHandle.Close() }
        $tcp.Dispose()
    }
}

function Aguardar-Porta-Livre([int]$port, [int]$seconds = 30) {
    for ($i = 0; $i -lt $seconds; $i++) {
        if (-not (Porta-Ocupada $port)) { return }
        Start-Sleep -Seconds 1
    }
    throw "Porta $port ocupada por um processo nao identificado. Nao sera encerrado a forca."
}

function Verificar-HTTP([int]$port, [int]$tentativas = 1) {
    for ($i = 0; $i -lt $tentativas; $i++) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 3
            $frontend = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 3
            if ($health.status -eq 'online' -and $frontend.StatusCode -eq 200 -and
                $frontend.Content -match 'id="root"') {
                return $true
            }
        } catch { }
        if ($i -lt ($tentativas - 1)) { Start-Sleep -Seconds 1 }
    }
    return $false
}

function Obter-Porta([string]$path) {
    $port = 8000
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        foreach ($line in Get-Content -LiteralPath $path -Encoding UTF8) {
            if ($line -match '^\s*APP_PORT\s*=\s*(.+?)\s*$') {
                $raw = $Matches[1].Trim().Trim('"').Trim("'")
                $candidate = 0
                if ([int]::TryParse($raw, [ref]$candidate) -and
                    $candidate -ge 1 -and $candidate -le 65535) {
                    $port = $candidate
                }
                break
            }
        }
    }
    return $port
}

function Obter-App-Anterior {
    $current = Ler-Config
    if ($current -and $current.app_path -and (Test-Path -LiteralPath $current.app_path)) {
        return [string]$current.app_path
    }
    $controlConfig = Join-Path $homeDir 'control.json'
    if (Test-Path -LiteralPath $controlConfig -PathType Leaf) {
        $legacy = Get-Content -LiteralPath $controlConfig -Raw | ConvertFrom-Json
        if ($legacy.app_path -and (Test-Path -LiteralPath $legacy.app_path)) {
            return [string]$legacy.app_path
        }
    }
    return $null
}

function Migracoes-Assinatura([string]$app) {
    $folder = Join-Path $app 'backend\alembic'
    $ini = Join-Path $app 'backend\alembic.ini'
    if (-not (Test-Path -LiteralPath $folder -PathType Container) -or
        -not (Test-Path -LiteralPath $ini -PathType Leaf)) {
        throw "Migrations da instalacao ausentes: $app"
    }
    $items = @('alembic.ini=' + (Get-FileHash -LiteralPath $ini -Algorithm SHA256).Hash)
    $files = @(Get-ChildItem -LiteralPath $folder -File -Recurse | Where-Object {
        $_.Extension -eq '.py' -or $_.Name -eq 'README'
    } | Sort-Object FullName)
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($folder.Length).Replace('\', '/')
        $items += $relative + '=' + (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    return ($items -join '|')
}

function Copiar-Uploads-Anteriores([string]$anterior) {
    if (-not $anterior) { return }
    $original = Join-Path $anterior 'backend\uploads'
    if (-not (Test-Path -LiteralPath $original -PathType Container)) { return }
    $item = Get-Item -LiteralPath $original -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return }
    foreach ($arquivo in @(Get-ChildItem -LiteralPath $original -File -Recurse)) {
        $relative = $arquivo.FullName.Substring($original.Length).TrimStart('\')
        $dest = Join-Path $uploadsDir $relative
        $parent = Split-Path -Parent $dest
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        if (Test-Path -LiteralPath $dest) {
            if ((Get-FileHash -LiteralPath $arquivo.FullName -Algorithm SHA256).Hash -ne
                (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash) {
                throw "Uploads com nomes iguais e conteudos diferentes: $relative. Nenhum foi substituido."
            }
        } else {
            Copy-Item -LiteralPath $arquivo.FullName -Destination $dest
        }
    }
}

function Juntar-Uploads([string]$app) {
    $link = Join-Path $app 'backend\uploads'
    if (Test-Path -LiteralPath $link) {
        throw "Novo checkout ja contem backend/uploads. Nao sera sobrescrito: $link"
    }
    $cmd = 'mklink /J "{0}" "{1}"' -f $link, $uploadsDir
    & $env:ComSpec /d /c $cmd | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $link)) {
        throw 'Falha ao vincular uploads persistentes ao novo GFARM.'
    }
}

function Obter-Tarefa([string]$name) {
    return Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
}

function Parar-Tarefa([string]$name) {
    $task = Obter-Tarefa $name
    if ($task -and $task.State -eq 'Running') {
        Stop-ScheduledTask -TaskName $name -ErrorAction Stop
        Start-Sleep -Seconds 2
    }
}

function Registrar-Tarefa {
    $pythonw = Join-Path $runtimeDir 'Scripts\pythonw.exe'
    $action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"{0}"' -f $serviceFile) -WorkingDirectory $homeDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}

function Limpar-Control([string]$anterior) {
    $task = Obter-Tarefa $oldTaskName
    if ($task) {
        Parar-Tarefa $oldTaskName
        Unregister-ScheduledTask -TaskName $oldTaskName -Confirm:$false
    }
    # Nao excluir segredos do GitHub nem qualquer dado persistente.
    foreach ($name in @(
        'control-runtime', 'control_bootstrap.py', 'update_transaction.py',
        'control-auth.json', 'control.json', 'control-version.json',
        'control-startup.log', 'control-reload.log', 'control.log',
        'github-cache.git'
    )) {
        $path = Join-Path $homeDir $name
        if (Test-Path -LiteralPath $path) {
            try { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop }
            catch { Informar "Aviso: arquivo legado requer revisao: $name" }
        }
    }
    if ($anterior -and
        $anterior.StartsWith($homeDir + '\', [StringComparison]::OrdinalIgnoreCase) -and
        $anterior -ne $canonicalApp) {
        $oldSources = Join-Path $anterior 'ops\gfarm_control'
        if (Test-Path -LiteralPath $oldSources) {
            try { Remove-Item -LiteralPath $oldSources -Recurse -Force -ErrorAction Stop }
            catch { Informar 'Aviso: codigo legado em uso; remocao adiada.' }
        }
    }
    foreach ($link in @(
        (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'GFARM Control.lnk'),
        (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'GFARM\GFARM Control.lnk')
    )) {
        if (Test-Path -LiteralPath $link) {
            try { Remove-Item -LiteralPath $link -Force -ErrorAction Stop } catch { }
        }
    }
}

function Mostrar-Status {
    $config = Ler-Config
    $tarefa = Obter-Tarefa $taskName
    if (-not $config) {
        Informar 'GFARM independente ainda nao foi configurado neste PC.'
        return
    }
    Informar ("Versao: " + $config.version)
    Informar ("Pasta ativa: " + $config.app_path)
    Informar ("Tarefa: " + $(if ($tarefa) { $tarefa.State } else { 'Nao registrada' }))
    Informar ("GFARM HTTP: " + $(if (Verificar-HTTP ([int]$config.port)) { 'ONLINE' } else { 'OFFLINE' }))
}

function Acionar-Tarefa([string]$acao) {
    $cfg = Ler-Config
    if (-not $cfg) { throw 'GFARM nao instalado. Execute -Acao Migrar ou Instalar.' }
    $tarefa = Obter-Tarefa $taskName
    if (-not $tarefa) { throw 'Tarefa GFARM Servidor nao encontrada. Execute -Acao Migrar.' }
    $port = [int]$cfg.port
    if ($acao -eq 'Parar' -or $acao -eq 'Reiniciar') {
        Parar-Tarefa $taskName
        Aguardar-Porta-Livre $port 30
    }
    if ($acao -eq 'Iniciar' -or $acao -eq 'Reiniciar') {
        if (Porta-Ocupada $port) {
            if (Verificar-HTTP $port) { Informar 'GFARM ja esta online.'; return }
            throw "A porta $port pertence a outro processo. Nao sera encerrado."
        }
        Start-ScheduledTask -TaskName $taskName
        if (-not (Verificar-HTTP $port 60)) {
            throw "GFARM nao iniciou: leia $homeDir\gfarm-servidor.log"
        }
        Informar "GFARM ONLINE em http://127.0.0.1:$port/"
    } else {
        Informar 'GFARM parado (PostgreSQL preservado).'
    }
}

function Criar-Backup {
    $cfg = Ler-Config
    if (-not $cfg) { throw 'Instalacao independente nao configurada.' }
    $py = Join-Path $runtimeDir 'Scripts\python.exe'
    $backend = Join-Path ([string]$cfg.app_path) 'backend'
    $env:GFARM_BACKUP_DIR = Join-Path $homeDir 'backups'
    $env:GFARM_UPLOAD_DIR = $uploadsDir
    Push-Location $backend
    try {
        # Mesma rotina oficial do ERP, com caminhos persistentes do servidor.
        $script = 'import os; from pathlib import Path; import app.services.backup_erp as b; b.BACKUP_DIR=Path(os.environ["GFARM_BACKUP_DIR"]); b.UPLOAD_DIR=Path(os.environ["GFARM_UPLOAD_DIR"]); print(b.criar_backup(origem="powershell"))'
        & $py -c $script
        if ($LASTEXITCODE -ne 0) { throw 'Falha no backup oficial do GFARM. Nada foi restaurado.' }
    } finally {
        Pop-Location
        Remove-Item Env:\GFARM_BACKUP_DIR -ErrorAction SilentlyContinue
        Remove-Item Env:\GFARM_UPLOAD_DIR -ErrorAction SilentlyContinue
    }
}

function Publicar-Main {
    Exigir-Admin
    New-Item -ItemType Directory -Path $homeDir, $dataDir, $uploadsDir -Force | Out-Null
    $oldApp = Obter-App-Anterior
    if (-not (Test-Path -LiteralPath $dataEnv -PathType Leaf) -and $oldApp) {
        $oldEnv = Join-Path $oldApp 'backend\.env'
        if (Test-Path -LiteralPath $oldEnv -PathType Leaf) {
            Copy-Item -LiteralPath $oldEnv -Destination $dataEnv
            Informar 'Configuracao existente do PostgreSQL preservada no diretorio de dados.'
        }
    }
    if (-not (Test-Path -LiteralPath $dataEnv -PathType Leaf)) {
        throw "Falta $dataEnv. Transfira com seguranca o backend.env da instalacao existente; nao sera criado banco novo."
    }
    $git = Obter-Git
    $repo = Obter-Repo
    $remoteText = (& $git ls-remote $repo 'refs/heads/main' | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $remoteText) {
        throw 'Nao foi possivel acessar a main privada. Verifique deploy key ou login GitHub.'
    }
    $remoteRevision = ($remoteText -split '\s+')[0]
    if ($remoteRevision -notmatch '^[0-9a-f]{40}$') { throw 'A main nao retornou um commit valido.' }
    $cfg = Ler-Config
    if ($Acao -eq 'Atualizar' -and $cfg -and
        $cfg.version -eq $remoteRevision -and (Test-Path -LiteralPath $cfg.app_path)) {
        Informar 'O codigo instalado ja corresponde a main. Nenhuma alteracao necessaria.'
        Mostrar-Status
        return
    }

    # Prepara TODO o codigo e a interface com o servidor atual ainda ativo.
    $stage = Join-Path $homeDir ('gfarm-stage-' + [guid]::NewGuid().ToString('N'))
    $stageApp = Join-Path $stage 'GFARM APP'
    $rollback = Join-Path $homeDir 'gfarm-voltar'
    if (Test-Path -LiteralPath $rollback) {
        throw "Existe restauracao anterior pendente: $rollback. Nao sobrescreva."
    }
    $npm = Obter-Npm
    $py = Preparar-Runtime
    $changed = $false
    $oldControlRunning = $false
    $oldTaskExists = $false
    $newTaskExisted = [bool](Obter-Tarefa $taskName)
    $oldConfigText = $null
    if (Test-Path -LiteralPath $configFile -PathType Leaf) {
        $oldConfigText = [IO.File]::ReadAllText($configFile)
    }
    $oldManagerExists = Test-Path -LiteralPath $managerFile
    $oldServiceExists = Test-Path -LiteralPath $serviceFile
    $previousManager = Join-Path $homeDir 'gfarm-manager-anterior.tmp'
    $previousService = Join-Path $homeDir 'gfarm-service-anterior.tmp'
    $backupMade = $false
    $newInstalled = $false
    $port = Obter-Porta $dataEnv

    try {
        Informar 'Baixando somente GFARM APP da branch main...'
        & $git clone --depth 1 --filter=blob:none --sparse --single-branch --branch main $repo $stage
        if ($LASTEXITCODE -ne 0) { throw 'Clone da main falhou. Nenhum servidor foi modificado.' }
        & $git -C $stage sparse-checkout set --cone 'GFARM APP'
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $stageApp 'backend\app\main.py'))) {
            throw 'Checkout GFARM APP incompleto.'
        }
        $revision = (& $git -C $stage rev-parse HEAD | Out-String).Trim()
        if ($revision -ne $remoteRevision) {
            throw 'A main mudou durante o download. Execute novamente para manter consistencia.'
        }
        foreach ($file in @('GFARM.ps1', 'GFARM-Servico.py')) {
            $source = Join-Path $stageApp ('ops\windows\' + $file)
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
                throw "Gerenciador independente incompleto na main: $file"
            }
        }

        if ($oldApp -and (Test-Path -LiteralPath (Join-Path $oldApp 'backend\alembic.ini'))) {
            if ((Migracoes-Assinatura $oldApp) -ne (Migracoes-Assinatura $stageApp)) {
                throw 'Migrations diferentes do instalado. Atualizacao bloqueada sem modificar PostgreSQL.'
            }
        }

        Copiar-Uploads-Anteriores $oldApp
        Copy-Item -LiteralPath $dataEnv -Destination (Join-Path $stageApp 'backend\.env')
        Informar 'Validando dependencias Python e conexao existente (somente SELECT 1)...'
        & $py -m pip install --no-input --disable-pip-version-check -r (Join-Path $stageApp 'backend\requirements.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Falha nas dependencias Python.' }
        & $py -m pip check
        if ($LASTEXITCODE -ne 0) { throw 'Dependencias Python inconsistentes.' }
        & $py -m compileall -q (Join-Path $stageApp 'backend\app')
        if ($LASTEXITCODE -ne 0) { throw 'Backend Python invalido.' }
        & $py -m py_compile (Join-Path $stageApp 'ops\windows\GFARM-Servico.py')
        if ($LASTEXITCODE -ne 0) { throw 'Servico independente Python invalido.' }
        $psTokens = $null
        $psErrors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile(
            (Join-Path $stageApp 'ops\windows\GFARM.ps1'), [ref]$psTokens, [ref]$psErrors
        )
        if ($psErrors.Count -gt 0) { throw 'Gerenciador PowerShell novo com erro de sintaxe.' }
        Push-Location (Join-Path $stageApp 'backend')
        try {
            $query = 'from sqlalchemy import text; from app.db.database import engine; connection=engine.connect(); assert connection.execute(text("SELECT 1")).scalar()==1; connection.close(); print("PostgreSQL validado")'
            & $py -c $query
            if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL nao respondeu a consulta de leitura. Servidor antigo preservado.' }
        } finally { Pop-Location }

        Informar 'Compilando frontend React antes de desligar o servidor antigo...'
        Push-Location $stageApp
        try {
            & $npm ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Falha no npm ci.' }
            & $npm run build
            if ($LASTEXITCODE -ne 0) { throw 'Falha no build do GFARM.' }
            if (-not (Test-Path -LiteralPath (Join-Path $stageApp 'dist\index.html'))) {
                throw 'Build nao produziu dist/index.html.'
            }
        } finally { Pop-Location }
        # Remover node_modules temporario: nao e necessario para rodar o FastAPI.
        $nodeModules = Join-Path $stageApp 'node_modules'
        if (Test-Path -LiteralPath $nodeModules) {
            Remove-Item -LiteralPath $nodeModules -Recurse -Force
        }

        Informar 'Preparacao concluida. Alternando somente o servico do GFARM...'
        if ($oldManagerExists) { Copy-Item -LiteralPath $managerFile -Destination $previousManager -Force }
        if ($oldServiceExists) { Copy-Item -LiteralPath $serviceFile -Destination $previousService -Force }
        $oldTask = Obter-Tarefa $oldTaskName
        $oldTaskExists = [bool]$oldTask
        $oldControlRunning = [bool]($oldTask -and $oldTask.State -eq 'Running')
        $port = Obter-Porta $dataEnv
        if ($oldTaskExists) { Parar-Tarefa $oldTaskName }
        if ($newTaskExisted) { Parar-Tarefa $taskName }
        Aguardar-Porta-Livre $port 35

        if (Test-Path -LiteralPath $canonicalApp) {
            Move-Item -LiteralPath $canonicalApp -Destination $rollback
            $backupMade = $true
        }
        Move-Item -LiteralPath $stageApp -Destination $canonicalApp
        $newInstalled = $true
        Juntar-Uploads $canonicalApp

        Copy-Item -LiteralPath (Join-Path $canonicalApp 'ops\windows\GFARM.ps1') -Destination $managerFile -Force
        Copy-Item -LiteralPath (Join-Path $canonicalApp 'ops\windows\GFARM-Servico.py') -Destination $serviceFile -Force

        Salvar-Config ([ordered]@{
            version = $revision
            app_path = $canonicalApp
            port = $port
            atualizado_em = (Get-Date).ToString('o')
        })
        Registrar-Tarefa
        Start-ScheduledTask -TaskName $taskName
        if (-not (Verificar-HTTP $port 65)) {
            throw "Novo GFARM nao respondeu na porta $port. A instalacao anterior sera reativada."
        }
        $changed = $true
        Informar "GFARM independente validado ONLINE em http://127.0.0.1:$port/ (commit $($revision.Substring(0,12)))."
        # A substituicao foi confirmada: so agora remover o Control.
        try { Limpar-Control $oldApp }
        catch { Informar 'GFARM esta online; a limpeza de algum componente antigo precisa de revisao.' }

        try {
          if ($backupMade -and (Test-Path -LiteralPath $rollback)) {
            # O rollback foi usado somente durante a troca; dados reais ficam em data/.
            # Antes de apagar, protege qualquer uploads que nao fosse uma junction.
            $oldUploads = Join-Path $rollback 'backend\uploads'
            if (-not (Test-Path -LiteralPath $oldUploads -PathType Container) -or
                ((Get-Item -LiteralPath $oldUploads -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                if (Test-Path -LiteralPath $oldUploads) {
                    & $env:ComSpec /d /c ('rmdir "{0}"' -f $oldUploads) | Out-Null
                    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel remover junction anterior; pasta conservada.' }
                }
                Remove-Item -LiteralPath $rollback -Recurse -Force
            } else {
                Informar "Instalacao anterior mantida para proteger anexos locais: $rollback"
            }
          }
        } catch {
            Informar "Novo GFARM online. Limpeza da pasta anterior adiada: $($_.Exception.Message)"
        }
        Informar 'GFARM Control removido do gerenciamento; Windows inicia GFARM Servidor automaticamente.'
    } catch {
        $errorMessage = $_.Exception.Message
        Informar "Falha na instalacao: $errorMessage"
        if ($newInstalled) {
            try {
                Parar-Tarefa $taskName
                Aguardar-Porta-Livre $port 30
                # Nunca remover app com junction usando Remove-Item -Recurse;
                # remover apenas o link para uploads persistentes.
                $junction = Join-Path $canonicalApp 'backend\uploads'
                if (Test-Path -LiteralPath $junction) {
                    $attr = (Get-Item -LiteralPath $junction -Force).Attributes
                    if (($attr -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                        & $env:ComSpec /d /c ('rmdir "{0}"' -f $junction) | Out-Null
                        if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel desvincular uploads; remocao bloqueada.' }
                    } else {
                        throw 'Uploads no app nao sao junction; remocao bloqueada para preservar dados.'
                    }
                }
                Remove-Item -LiteralPath $canonicalApp -Recurse -Force
                if ($backupMade -and (Test-Path -LiteralPath $rollback)) {
                    Move-Item -LiteralPath $rollback -Destination $canonicalApp
                }
                if ($null -ne $oldConfigText) {
                    [IO.File]::WriteAllText($configFile, $oldConfigText, (New-Object System.Text.UTF8Encoding($false)))
                } elseif (Test-Path -LiteralPath $configFile) {
                    Remove-Item -LiteralPath $configFile -Force
                }
                if ($oldManagerExists) {
                    if (Test-Path -LiteralPath $previousManager) {
                        Copy-Item -LiteralPath $previousManager -Destination $managerFile -Force
                    }
                } elseif (Test-Path -LiteralPath $managerFile) {
                    Remove-Item -LiteralPath $managerFile -Force
                }
                if ($oldServiceExists) {
                    if (Test-Path -LiteralPath $previousService) {
                        Copy-Item -LiteralPath $previousService -Destination $serviceFile -Force
                    }
                } elseif (Test-Path -LiteralPath $serviceFile) {
                    Remove-Item -LiteralPath $serviceFile -Force
                }
                if ($newTaskExisted -and (Ler-Config)) {
                    Registrar-Tarefa
                    Start-ScheduledTask -TaskName $taskName
                } elseif (Obter-Tarefa $taskName) {
                    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
                }
                if ($oldControlRunning -and (Obter-Tarefa $oldTaskName)) {
                    Start-ScheduledTask -TaskName $oldTaskName
                }
                Informar 'Arquivos/configuracao anteriores restaurados. PostgreSQL nao foi alterado.'
            } catch {
                Informar "RECUPERACAO REQUER REVISAO: $($_.Exception.Message). Nao apague nada em $homeDir."
            }
        } else {
            if ($backupMade -and (Test-Path -LiteralPath $rollback) -and
                -not (Test-Path -LiteralPath $canonicalApp)) {
                try { Move-Item -LiteralPath $rollback -Destination $canonicalApp }
                catch { Informar 'FALHA AO RESTAURAR CODIGO ANTERIOR: mantenha as pastas e revise manualmente.' }
            }
            if ($oldControlRunning -and (Obter-Tarefa $oldTaskName)) {
                try { Start-ScheduledTask -TaskName $oldTaskName } catch { }
            }
        }
        throw $errorMessage
    } finally {
        if (Test-Path -LiteralPath $stage) {
            # Somente pasta temporaria de checkout, sem uploads vinculados.
            try { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction Stop }
            catch { Informar "Remova depois apenas o checkout temporario: $stage" }
        }
        foreach ($path in @($previousManager, $previousService)) {
            if (Test-Path -LiteralPath $path) {
                try { Remove-Item -LiteralPath $path -Force } catch { }
            }
        }
    }
}

try {
    if ($Acao -in @('Instalar', 'Migrar', 'Atualizar')) {
        Publicar-Main
    } elseif ($Acao -eq 'Status') {
        Mostrar-Status
    } elseif ($Acao -eq 'Logs') {
        foreach ($name in @('gfarm-servidor.log', 'gfarm-manutencao.log')) {
            $path = Join-Path $homeDir $name
            Write-Host ("---- " + $name + " ----")
            if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path -Tail 40 }
        }
    } elseif ($Acao -eq 'Backup') {
        Exigir-Admin
        Criar-Backup
    } else {
        Exigir-Admin
        Acionar-Tarefa $Acao
    }
} catch {
    Write-Host ("ERRO: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
