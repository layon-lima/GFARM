#requires -Version 5.1
# Instala GFARM + GFARM Control. Preserva PostgreSQL, usuarios e anexos.
param(
  [Parameter(Mandatory=$true)][string]$InstallDir
)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:ProgramData 'GFARM'
$logFile = Join-Path $root 'instalacao.log'

function Log([string]$text) {
  Add-Content -LiteralPath $logFile -Value ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text) -Encoding UTF8
}
function Refresh-Path {
  $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')
}
function Program([string]$command, [string]$wingetId) {
  Refresh-Path
  $program = Get-Command $command -ErrorAction SilentlyContinue
  if ($program) { return $program.Source }
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (!$winget) { throw "$command nao encontrado. Instale $wingetId e repita o instalador." }
  Log "Instalando dependencia: $wingetId"
  & $winget.Source install --id $wingetId --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -ne 0) { throw "Instalacao de $wingetId falhou ($LASTEXITCODE)." }
  Refresh-Path
  $program = Get-Command $command -ErrorAction SilentlyContinue
  if ($program) { return $program.Source }
  throw "Reinicie o Windows e repita o instalador para localizar $command."
}
New-Item -ItemType Directory -Force -Path $root | Out-Null
# Proteger as credenciais/SSH em ProgramData para SYSTEM e Administradores.
& icacls.exe $root '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falha ao proteger diretorio de dados.' }

try {
  Log 'Inicio da instalacao de 3 etapas.'
  $installed = Join-Path $root 'installed'
  $source = Join-Path $installed 'source'
  $app = Join-Path $source 'GFARM APP'
  $data = Join-Path $root 'data'
  $uploads = Join-Path $data 'uploads'
  $xml = Join-Path $data 'xml-inbox'
  foreach ($dir in @($installed,$data,$uploads,$xml,(Join-Path $root 'backups'),(Join-Path $root 'releases'),(Join-Path $root 'secrets'))) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  Log '[1/3] Obtendo GFARM atualizado do GitHub privado.'
  $git = Program 'git.exe' 'Git.Git'
  $env:GCM_INTERACTIVE = 'always'
  $env:GIT_TERMINAL_PROMPT = '1'
  $cfgPath = Join-Path $root 'control.json'
  $config = $null
  if (Test-Path -LiteralPath $cfgPath -PathType Leaf) {
    $config = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  }
  if ($config -and $config.app_path -and
      -not (Test-Path (Join-Path ([string]$config.app_path) 'backend\run_production.py'))) {
    throw 'Uma instalacao anterior esta registrada mas a pasta do aplicativo nao foi encontrada. Nenhuma instalacao sera sobrescrita.'
  }
  if ($config -and $config.app_path -and
      (Test-Path (Join-Path ([string]$config.app_path) 'backend\run_production.py'))) {
    $app = [string]$config.app_path
    Log 'Instalacao existente preservada; use Control para futuras atualizacoes.'
  } elseif (-not (Test-Path (Join-Path $app 'backend\run_production.py'))) {
    if (Test-Path -LiteralPath $source) {
      throw 'Download anterior incompleto. Nao sera apagado automaticamente.'
    }
    $stage = Join-Path $installed ('download-' + [Guid]::NewGuid().ToString('N'))
    Log 'O navegador pode solicitar login. Baixando somente GFARM APP, sem BACKUPS.'
    & $git clone --depth 1 --filter=blob:none --sparse --single-branch --branch main 'https://github.com/layon-lima/GFARM.git' $stage
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao baixar repositorio privado. Confira login GitHub.' }
    & $git -C $stage sparse-checkout set --cone 'GFARM APP'
    if ($LASTEXITCODE -ne 0) { throw 'Falha no checkout da pasta GFARM APP.' }
    if (-not (Test-Path (Join-Path $stage 'GFARM APP\backend\run_production.py'))) {
      throw 'Pacote do GitHub nao possui a estrutura esperada.'
    }
    Move-Item -LiteralPath $stage -Destination $source
    Log 'Aplicativo baixado diretamente da main no GitHub.'
  } else {
    Log 'Codigo ja baixado anteriormente; mantido sem sobrescrita.'
  }

  $uploadsLink = Join-Path $app 'backend\uploads'
  if (-not (Test-Path $uploadsLink)) {
    New-Item -ItemType Junction -Path $uploadsLink -Target $uploads | Out-Null
    Log 'Uploads persistentes vinculados fora da pasta do codigo.'
  }

  $npm = Program 'npm.cmd' 'OpenJS.NodeJS.LTS'
  $py = Get-Command 'py.exe' -ErrorAction SilentlyContinue
  if (!$py) { $null = Program 'python.exe' 'Python.Python.3.13' }
  $venv = Join-Path $app 'backend\.venv\Scripts\python.exe'
  if (-not (Test-Path $venv)) {
    if ($py) { & $py.Source -3.13 -m venv (Join-Path $app 'backend\.venv') }
    else { & python.exe -m venv (Join-Path $app 'backend\.venv') }
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar ambiente Python virtual.' }
  }
  Log 'Instalando backend Python.'
  & $venv -m pip install --disable-pip-version-check -r (Join-Path $app 'backend\requirements.txt')
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar bibliotecas do backend.' }
  Log 'Compilando frontend React.'
  Push-Location $app
  try {
    & $npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou.' }
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw 'npm run build falhou.' }
  } finally { Pop-Location }
  if (-not (Test-Path (Join-Path $app 'dist\index.html'))) { throw 'Frontend nao foi compilado.' }

  # Apontar o Control para a versao real, sem inicializar nem migrar o banco.
  if (-not $config) {
    $version = (& $git -C $source rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^[0-9a-f]{40}
  $controlExe = Join-Path $InstallDir 'GFARM-Control.exe'
  if (-not (Test-Path $controlExe)) { throw "GFARM-Control.exe nao encontrado em $InstallDir" }
  $command = '"' + $controlExe + '"'
  & schtasks.exe /Create /F /TN 'GFARM Control' /TR $command /SC ONSTART /RU SYSTEM /RL HIGHEST
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel configurar a inicializacao automatica.' }
  & schtasks.exe /Run /TN 'GFARM Control' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'GFARM Control nao iniciou.' }

  Log '[3/3] Detectando banco PostgreSQL (nenhuma alteracao sera realizada).'
  $pgBase = Join-Path $env:ProgramFiles 'PostgreSQL'
  $pg = Get-ChildItem -Path $pgBase -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'bin\pg_dump.exe') } |
    Sort-Object Name -Descending | Select-Object -First 1
  if ($pg) { Log ("PostgreSQL encontrado: " + $pg.FullName) }
  else { Log 'PostgreSQL nao encontrado. Conclua a configuracao pelo GFARM Control.' }
  Log 'Concluido. Configure o banco existente em GFARM Control > Servidor.'
} catch {
  Log ('FALHA: ' + $_.Exception.Message)
  throw
}
) {
      throw 'Nao foi possivel verificar o commit baixado do GitHub.'
    }
    $config = @{
      app_path = $app
      version = $version
      automatic = $true
      desired_running = $false
      remote_host = '127.0.0.1'
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $tempCfg = $cfgPath + '.tmp'
    [System.IO.File]::WriteAllText($tempCfg, ($config | ConvertTo-Json -Depth 6), $utf8)
    Move-Item -LiteralPath $tempCfg -Destination $cfgPath
    Log ('Commit GFARM instalado: ' + $version.Substring(0,12))
  }

  Log '[2/3] Instalando servico independente do GFARM Control.'
  $controlExe = Join-Path $InstallDir 'GFARM-Control.exe'
  if (-not (Test-Path $controlExe)) { throw "GFARM-Control.exe nao encontrado em $InstallDir" }
  $command = '"' + $controlExe + '"'
  & schtasks.exe /Create /F /TN 'GFARM Control' /TR $command /SC ONSTART /RU SYSTEM /RL HIGHEST
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel configurar a inicializacao automatica.' }
  & schtasks.exe /Run /TN 'GFARM Control' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'GFARM Control nao iniciou.' }

  Log '[3/3] Detectando banco PostgreSQL (nenhuma alteracao sera realizada).'
  $pgBase = Join-Path $env:ProgramFiles 'PostgreSQL'
  $pg = Get-ChildItem -Path $pgBase -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'bin\pg_dump.exe') } |
    Sort-Object Name -Descending | Select-Object -First 1
  if ($pg) { Log ("PostgreSQL encontrado: " + $pg.FullName) }
  else { Log 'PostgreSQL nao encontrado. Conclua a configuracao pelo GFARM Control.' }
  Log 'Concluido. Configure o banco existente em GFARM Control > Servidor.'
} catch {
  Log ('FALHA: ' + $_.Exception.Message)
  throw
}
