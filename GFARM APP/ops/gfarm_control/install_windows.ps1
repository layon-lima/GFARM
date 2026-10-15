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
  try { Add-Content -LiteralPath $diagnostic -Encoding UTF8 -Value $line } catch { }
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
  $taskCommand = '"' + $controlExe + '"'
  & schtasks.exe /Create /F /TN 'GFARM Control' /TR $taskCommand /SC ONSTART /RU SYSTEM /RL HIGHEST
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao cadastrar tarefa GFARM Control.' }
  & schtasks.exe /Run /TN 'GFARM Control' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao iniciar tarefa GFARM Control.' }

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
