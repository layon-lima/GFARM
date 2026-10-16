#requires -Version 5.1
# Instalador GFARM online. NUNCA apaga ou modifica banco PostgreSQL.
param(
  [Parameter(Mandatory=$true)][string]$InstallDir,
  [ValidateSet('Repair','Reinstall')][string]$Mode = 'Repair'
)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:ProgramData 'GFARM'
$logFile = Join-Path $root 'instalacao.log'
$publicDir = [Environment]::GetFolderPath('CommonDocuments')
if (-not $publicDir) { $publicDir = Join-Path $env:PUBLIC 'Documents' }
$diagnostic = Join-Path $publicDir 'GFARM-Instalacao.log'
$transcriptStarted = $false
$configWasChanged = $false
$previousConfigBytes = $null
$hasPreviousControl = $false

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
function Locate-Installed([string]$cmd) {
  Refresh-Path
  $found = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  $bases = @($env:ProgramFiles,
             [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'),
             $env:LOCALAPPDATA)
  foreach ($base in $bases) {
    if (-not $base) { continue }
    $candidates = @(
      (Join-Path $base (Join-Path 'Git\cmd' $cmd)),
      (Join-Path $base (Join-Path 'Git\bin' $cmd)),
      (Join-Path $base (Join-Path 'nodejs' $cmd)),
      (Join-Path $base (Join-Path 'Programs\Git\cmd' $cmd)),
      (Join-Path $base (Join-Path 'Programs\nodejs' $cmd)),
      (Join-Path $base (Join-Path 'Programs\Python\Python313' $cmd)),
      (Join-Path $base (Join-Path 'Programs\Python\Python314' $cmd))
    )
    foreach ($candidate in $candidates) {
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
  }
  return $null
}
function Program([string]$cmd, [string]$id) {
  $found = Locate-Installed $cmd
  if ($found) { return $found }
  $wg = Get-Command 'winget.exe' -ErrorAction SilentlyContinue
  if (-not $wg) { throw "$cmd ausente. Instale $id e execute o instalador novamente." }
  Log "Instalando dependencia: $id"
  & $wg.Source install --id $id --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -ne 0) { throw "Erro $LASTEXITCODE ao instalar $id." }
  $found = Locate-Installed $cmd
  if (-not $found) { throw "$id instalado, mas $cmd nao foi localizado. Verifique a instalacao antes de continuar." }
  return $found
}

try {
  New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
  Start-Transcript -LiteralPath $diagnostic -Append -ErrorAction Stop | Out-Null
  $transcriptStarted = $true
  Log ('INICIO: instalador online GFARM e GFARM Control. Modo: ' + $Mode)
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  & icacls.exe $root '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel proteger ProgramData\GFARM.' }
  $installed = Join-Path $root 'installed'
  $source = Join-Path $installed 'source'
  $app = Join-Path $source 'GFARM APP'
  $data = Join-Path $root 'data'
  $uploads = Join-Path $data 'uploads'
  $cfgPath = Join-Path $root 'control.json'
  if (Test-Path -LiteralPath $cfgPath -PathType Leaf) {
    $previousConfigBytes = [IO.File]::ReadAllBytes($cfgPath)
  }
  $hasPreviousControl = [bool](Get-ScheduledTask -TaskName 'GFARM Control' -ErrorAction SilentlyContinue)
  foreach ($dir in @($installed, $data, $uploads, (Join-Path $data 'xml-inbox'),
                     (Join-Path $root 'backups'), (Join-Path $root 'releases'),
                     (Join-Path $root 'secrets'))) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  Log '[1/3] Obtendo GFARM do GitHub privado.'
  $git = Program 'git.exe' 'Git.Git'
  $env:GCM_INTERACTIVE = 'always'
  $env:GIT_TERMINAL_PROMPT = '1'
  # Nas maquinas ja autorizadas, preferir deploy key de leitura: reinstalar
  # nao precisa autenticar novamente com conta pessoal no GitHub.
  $repoUrl = 'https://github.com/layon-lima/GFARM.git'
  $deployKey = Join-Path $root 'secrets\github_deploy'
  if (Test-Path -LiteralPath $deployKey -PathType Leaf) {
    $ssh = Locate-Installed 'ssh.exe'
    if (-not $ssh) {
      $gitRoot = Split-Path (Split-Path $git -Parent) -Parent
      $candidate = Join-Path $gitRoot 'usr\bin\ssh.exe'
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { $ssh = $candidate }
    }
    if ($ssh) {
      $env:GIT_SSH_COMMAND = '"' + $ssh + '" -i "' + $deployKey +
        '" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new'
      $env:GIT_TERMINAL_PROMPT = '0'
      $repoUrl = 'git@github.com:layon-lima/GFARM.git'
      Log 'Deploy key ja configurada: usando acesso de leitura ao GitHub.'
    }
  }
  $config = $null
  $previousApp = $null
  $source = Join-Path $installed 'source'
  if (Test-Path -LiteralPath $cfgPath -PathType Leaf) {
    $config = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($config.app_path) {
      $previousApp = [string]$config.app_path
    }
  }
  $newCheckout = ($Mode -eq 'Reinstall' -or -not $previousApp)
  if ($previousApp -and -not $newCheckout) {
    $app = $previousApp
    if (-not (Test-Path -LiteralPath (Join-Path $app 'backend\run_production.py'))) {
      throw 'Instalacao anterior incompleta. Escolha REINSTALAR OS PROGRAMAS para baixar codigo novo sem apagar seus dados.'
    }
    Log 'REPARAR: usando codigo local existente; PostgreSQL, anexos e configuracao intocados.'
  } else {
    # Reinstalar NAO e desinstalar o banco! Gerar copia nova em pasta separada,
    # validar e compilar antes de trocar o app_path em control.json.
    $staged = Join-Path $installed ('nova-versao-' + [Guid]::NewGuid().ToString('N'))
    Log 'Baixando codigo novo da branch main do GitHub em pasta separada...'
    & $git clone --depth 1 --filter=blob:none --sparse --single-branch --branch main $repoUrl $staged
    if ($LASTEXITCODE -ne 0) {
      throw 'Falha no download do GitHub. O GFARM existente continua preservado.'
    }
    & $git -C $staged sparse-checkout set --cone 'GFARM APP'
    if ($LASTEXITCODE -ne 0) { throw 'Git sparse-checkout falhou. Instalacao anterior preservada.' }
    if (-not (Test-Path -LiteralPath (Join-Path $staged 'GFARM APP\backend\run_production.py'))) {
      throw 'Novo codigo GFARM incompleto. Instalacao anterior preservada.'
    }
    if (-not $previousApp) {
      # Primeira instalacao preserva estrutura historica.
      if (Test-Path -LiteralPath $source) {
        throw 'Pasta source incompleta encontrada. Revisao necessaria para evitar sobrescrever dados.'
      }
      Move-Item -LiteralPath $staged -Destination $source -ErrorAction Stop
      $app = Join-Path $source 'GFARM APP'
    } else {
      $app = Join-Path $staged 'GFARM APP'
    }
    Log ('Nova copia do codigo preparada em ' + $app)
  }

  # Validacao obrigatoria ao REINSTALAR SOBRE banco existente:
  # nao ativar migrations diferentes de forma automatica.
  if ($previousApp -and $newCheckout -and
      (Test-Path -LiteralPath (Join-Path $previousApp 'backend\alembic\versions'))) {
    $oldMigrations = Join-Path $previousApp 'backend\alembic\versions'
    $newMigrations = Join-Path $app 'backend\alembic\versions'
    if (-not (Test-Path -LiteralPath $newMigrations)) {
      throw 'Migrations ausentes na nova versao. Codigo anterior preservado.'
    }
    $a = @(Get-ChildItem -LiteralPath $oldMigrations -Filter '*.py' -File |
      ForEach-Object { $_.Name + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } |
      Sort-Object)
    $b = @(Get-ChildItem -LiteralPath $newMigrations -Filter '*.py' -File |
      ForEach-Object { $_.Name + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } |
      Sort-Object)
    if (@(Compare-Object -ReferenceObject $a -DifferenceObject $b).Count -gt 0) {
      throw 'A nova versao exige migrations diferentes. Reinstalacao bloqueada para proteger o PostgreSQL existente. Procure atualizacao supervisionada.'
    }
  }
  # Reutilizar a MESMA configuracao PostgreSQL/SECRET_KEY existente.
  # Um checkout novo nao vem com o backend/.env; sem copia ele nao conecta.
  if ($newCheckout -and (Test-Path -LiteralPath (Join-Path $data 'backend.env'))) {
    Copy-Item -LiteralPath (Join-Path $data 'backend.env') -Destination (Join-Path $app 'backend\.env') -Force
    Log 'Conexao PostgreSQL existente vinculada a nova copia, sem alterar o banco.'
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

  # Registrar SOMENTE depois que frontend, venv e arquivos foram validados.
  # Reinstalar nao substitui backend.env, PostgreSQL, uploads ou os backups.
  if ($newCheckout) {
    $repositoryRoot = Split-Path -Parent $app
    $revision = (& $git -C $repositoryRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40}$') {
      throw 'Commit da main nao pode ser validado. Configuracao anterior preservada.'
    }
    if (-not $config) {
      $config = @{
        app_path = $app
        version = $revision
        automatic = $true
        desired_running = $false
        remote_host = '127.0.0.1'
      }
    } else {
      # Atualizar apenas as duas chaves abaixo, sem sobrescrever permissoes,
      # senha de acesso, preferencias, tunel ou estado do servidor.
      $config.app_path = $app
      $config.version = $revision
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $tmp = $cfgPath + '.tmp'
    [System.IO.File]::WriteAllText($tmp, ($config | ConvertTo-Json -Depth 6), $utf8)
    Move-Item -LiteralPath $tmp -Destination $cfgPath -Force
    $configWasChanged = $true
    Log ('Versao instalada/atualizada: ' + $revision.Substring(0, 12))
  } else {
    Log 'Reparo: versao atual do GFARM preservada.'
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
  if ($configWasChanged -and $previousConfigBytes) {
    try {
      $cfgRollback = $cfgPath + '.rollback.tmp'
      [IO.File]::WriteAllBytes($cfgRollback, $previousConfigBytes)
      Move-Item -LiteralPath $cfgRollback -Destination $cfgPath -Force
      Log 'Configuracao antiga do GFARM restaurada. PostgreSQL e uploads preservados.'
    } catch {
      Log ('ALERTA: falha ao restaurar control.json: ' + $_.Exception.Message)
    }
  }
  # Se a reinstalacao parou o Control existente e falhou antes do fim,
  # religar a tarefa antiga (o bootstrap tem codigo web embutido de reparo).
  if ($hasPreviousControl) {
    try {
      Start-ScheduledTask -TaskName 'GFARM Control' -ErrorAction Stop
      Log 'GFARM Control reiniciado apos falha do instalador.'
    } catch {
      Log ('ALERTA: GFARM Control precisa ser iniciado manualmente: ' + $_.Exception.Message)
    }
  }
  Write-Host ('Detalhes: ' + $_.ScriptStackTrace) -ForegroundColor Red
  throw
} finally {
  if ($transcriptStarted) { Stop-Transcript | Out-Null }
}
