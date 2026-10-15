#requires -Version 5.1
# Instalador GFARM online. NUNCA apaga ou modifica banco PostgreSQL.
param([Parameter(Mandatory=$true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:ProgramData 'GFARM'
$logFile = Join-Path $root 'instalacao.log'
$publicDir = [Environment]::GetFolderPath('CommonDocuments')
if (-not $publicDir) { $publicDir = Join-Path $env:PUBLIC 'Documents' }
$diagnostic = Join-Path $publicDir 'GFARM-Instalacao.log'
$transcriptStarted = $false

function Log([string]$msg) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
  Write-Host $line
  # Start-Transcript grava a saida do Write-Host neste mesmo arquivo.
  # Nao usar Add-Content nele: transcricao mantem o arquivo bloqueado.
  if (Test-Path -LiteralPath $root) {
    try { Add-Content -LiteralPath $logFile -Encoding UTF8 -Value $line } catch { }
  }
}
function Refresh-Path {
  $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('PATH','User')
}
function Program([string]$cmd, [string]$id) {
  Refresh-Path
  $found = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  $wg = Get-Command 'winget.exe' -ErrorAction SilentlyContinue
  if (-not $wg) { throw "$cmd ausente. Instale $id e execute o instalador novamente." }
  Log "Instalando dependencia: $id"
  & $wg.Source install --id $id --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -ne 0) { throw "Erro $LASTEXITCODE ao instalar $id." }
  Refresh-Path
  $found = Get-Command $cmd -ErrorAction SilentlyContinue
  if (-not $found) { throw "$id instalado, mas $cmd nao foi localizado. Reinicie o Windows." }
  return $found.Source
}

try {
  New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
  Start-Transcript -LiteralPath $diagnostic -Append -ErrorAction Stop | Out-Null
  $transcriptStarted = $true
  Log 'INICIO: instalador online GFARM e GFARM Control.'
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  & icacls.exe $root '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel proteger ProgramData\GFARM.' }
  $installed = Join-Path $root 'installed'
  $source = Join-Path $installed 'source'
  $app = Join-Path $source 'GFARM APP'
  $data = Join-Path $root 'data'
  $uploads = Join-Path $data 'uploads'
  $cfgPath = Join-Path $root 'control.json'
  foreach ($dir in @($installed, $data, $uploads, (Join-Path $data 'xml-inbox'),
                     (Join-Path $root 'backups'), (Join-Path $root 'releases'),
                     (Join-Path $root 'secrets'))) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  Log '[1/3] Obtendo GFARM do GitHub privado.'
  $git = Program 'git.exe' 'Git.Git'
  $env:GCM_INTERACTIVE = 'always'
  $env:GIT_TERMINAL_PROMPT = '1'
  $config = $null
  if (Test-Path -LiteralPath $cfgPath -PathType Leaf) {
    $config = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  }
  if ($config -and $config.app_path) {
    $app = [string]$config.app_path
    if (-not (Test-Path -LiteralPath (Join-Path $app 'backend\run_production.py'))) {
      throw 'Caminho registrado no GFARM Control nao existe. Pare e revise a instalacao anterior.'
    }
    Log 'Instalacao ja registrada. Codigo e dados existentes serao preservados.'
  } elseif (-not (Test-Path -LiteralPath (Join-Path $app 'backend\run_production.py'))) {
    if (Test-Path -LiteralPath $source) {
      throw 'Foi localizada uma pasta source incompleta. Nenhum arquivo sera apagado automaticamente.'
    }
    $stage = Join-Path $installed ('download-' + [Guid]::NewGuid().ToString('N'))
    Log 'Autentique-se no GitHub quando solicitado. Baixando apenas GFARM APP, sem BACKUPS.'
    & $git clone --depth 1 --filter=blob:none --sparse --single-branch --branch main 'https://github.com/layon-lima/GFARM.git' $stage
    if ($LASTEXITCODE -ne 0) { throw 'Git clone falhou. Confirme autenticacao no GitHub e conexao de internet.' }
    & $git -C $stage sparse-checkout set --cone 'GFARM APP'
    if ($LASTEXITCODE -ne 0) { throw 'Git sparse-checkout falhou para GFARM APP.' }
    if (-not (Test-Path -LiteralPath (Join-Path $stage 'GFARM APP\backend\run_production.py'))) {
      throw 'Download da main nao contem a pasta GFARM APP completa.'
    }
    Move-Item -LiteralPath $stage -Destination $source
    Log 'Codigo recebido diretamente do GitHub.'
  } else {
    Log 'Codigo GFARM ja presente. Nenhum codigo existente sera sobrescrito.'
  }

  $uploadsLink = Join-Path $app 'backend\uploads'
  if (-not (Test-Path -LiteralPath $uploadsLink)) {
    New-Item -ItemType Junction -Path $uploadsLink -Target $uploads | Out-Null
  } else {
    $existing = Get-Item -LiteralPath $uploadsLink -Force
    if ($existing.LinkType -ne 'Junction') {
      if ($existing.PSIsContainer -and
          -not (Get-ChildItem -LiteralPath $uploadsLink -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $uploadsLink
        New-Item -ItemType Junction -Path $uploadsLink -Target $uploads | Out-Null
      } else {
        throw 'A pasta de uploads existente nao e um junction vazio. Revisao manual para proteger anexos.'
      }
    }
  }

  $npm = Program 'npm.cmd' 'OpenJS.NodeJS.LTS'
  $py = Get-Command 'py.exe' -ErrorAction SilentlyContinue
  if (-not $py) {
    $null = Program 'python.exe' 'Python.Python.3.13'
    $py = Get-Command 'py.exe' -ErrorAction SilentlyContinue
  }
  $venv = Join-Path $app 'backend\.venv\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $venv)) {
    Log 'Criando ambiente Python isolado.'
    if ($py) { & $py.Source -3.13 -m venv (Join-Path $app 'backend\.venv') }
    else { & python.exe -m venv (Join-Path $app 'backend\.venv') }
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar ambiente Python do GFARM.' }
  }
  Log 'Instalando bibliotecas Python.'
  & $venv -m pip install --disable-pip-version-check -r (Join-Path $app 'backend\requirements.txt')
  if ($LASTEXITCODE -ne 0) { throw 'Falha na instalacao das bibliotecas Python.' }
  Log 'Compilando frontend React.'
  Push-Location $app
  try {
    & $npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Falha no npm ci.' }
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Falha no npm run build.' }
  } finally {
    Pop-Location
  }
  if (-not (Test-Path -LiteralPath (Join-Path $app 'dist\index.html'))) {
    throw 'Frontend dist\index.html nao foi gerado.'
  }

  # Registrar a versao real. A conexao do PostgreSQL sera configurada depois.
  if (-not $config) {
    if (-not (Test-Path -LiteralPath (Join-Path $source '.git'))) {
      throw 'Repositorio Git ausente; nao e possivel verificar versao.'
    }
    $revision = (& $git -C $source rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40}$') {
      throw 'Commit da main nao pode ser validado.'
    }
    $config = @{
      app_path = $app
      version = $revision
      automatic = $true
      desired_running = $false
      remote_host = '127.0.0.1'
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $tmp = $cfgPath + '.tmp'
    [System.IO.File]::WriteAllText($tmp, ($config | ConvertTo-Json -Depth 6), $utf8)
    Move-Item -LiteralPath $tmp -Destination $cfgPath -Force
    Log ('Commit instalado: ' + $revision.Substring(0, 12))
  }

  Log '[2/3] Instalando inicializacao independente do GFARM Control.'
  $controlExe = Join-Path $InstallDir 'GFARM-Control.exe'
  if (-not (Test-Path -LiteralPath $controlExe -PathType Leaf)) {
    throw 'GFARM-Control.exe nao foi encontrado na pasta do instalador.'
  }
  # /TR do schtasks divide caminhos com espacos (C:\Program Files) na tarefa.
  # ScheduledTasks aceita Execute e Arguments separadamente e salva o exe intacto.
  $controlAction = New-ScheduledTaskAction -Execute $controlExe -WorkingDirectory $InstallDir
  $controlTrigger = New-ScheduledTaskTrigger -AtStartup
  $controlPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $controlSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
  Register-ScheduledTask -TaskName 'GFARM Control' -Action $controlAction -Trigger $controlTrigger -Principal $controlPrincipal -Settings $controlSettings -Force | Out-Null
  $registered = (Get-ScheduledTask -TaskName 'GFARM Control').Actions | Select-Object -First 1
  if (-not $registered -or [string]$registered.Execute -ne $controlExe) {
    throw 'A tarefa GFARM Control foi criada com executavel diferente do esperado.'
  }
  Start-ScheduledTask -TaskName 'GFARM Control'
  Log ('Tarefa de inicializacao configurada para: ' + [string]$registered.Execute)

  # schtasks /Run confirma SOMENTE o pedido de inicializacao;
  # ele nao garante que GFARM-Control.exe conseguiu atender a porta 8787.
  Log 'Verificando servidor HTTP do Control (ate 45 segundos).'
  $controlOnline = $false
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try {
      $request = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:8787/')
      $request.Proxy = $null
      $request.Timeout = 1500
      $request.ReadWriteTimeout = 1500
      $response = $request.GetResponse()
      try {
        $serverHeader = [string]$response.Headers['Server']
        if ($serverHeader.StartsWith('GFARMControl/')) { $controlOnline = $true }
      } finally { $response.Close() }
      if ($controlOnline) { break }
    } catch {
      # Aguardando o processo iniciar; diagnosticos sao emitidos no fim.
    }
    Start-Sleep -Seconds 1
  }
  if (-not $controlOnline) {
    Log 'GFARM Control nao respondeu na porta 8787.'
    $taskState = & schtasks.exe /Query /TN 'GFARM Control' /V /FO LIST 2>&1
    Log ('Estado da tarefa: ' + (($taskState | Out-String).Trim()))
    $startupLog = Join-Path $root 'control-startup.log'
    if (Test-Path -LiteralPath $startupLog) {
      Log ('Falha interna Control: ' + ((Get-Content -LiteralPath $startupLog -Tail 12) -join ' | '))
    }
    throw 'GFARM Control nao iniciou. Confira o estado da tarefa e control-startup.log.'
  }
  Log 'GFARM Control ONLINE em http://127.0.0.1:8787/.'

  Log '[3/3] Detectando PostgreSQL sem modificar banco.'
  $pgDir = Join-Path $env:ProgramFiles 'PostgreSQL'
  $pg = Get-ChildItem -Path $pgDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'bin\pg_dump.exe') } |
    Sort-Object { if ($_.Name -match '^\d+$') { [int]$_.Name } else { 0 } } -Descending |
    Select-Object -First 1
  if ($pg) { Log ('PostgreSQL detectado em ' + $pg.FullName) }
  else { Log 'PostgreSQL nao detectado automaticamente; configure pelo Control.' }
  Log 'INSTALACAO CONCLUIDA. Configure a conexao em GFARM Control > Servidor.'
} catch {
  $reason = $_.Exception.Message
  Log ('FALHA: ' + $reason)
  Write-Host ('Detalhes: ' + $_.ScriptStackTrace) -ForegroundColor Red
  throw
} finally {
  if ($transcriptStarted) { Stop-Transcript | Out-Null }
}
