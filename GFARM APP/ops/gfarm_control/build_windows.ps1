#requires -Version 5.1
# Compilar instalador GFARM em Windows com Git e Inno Setup 6.
param([string]$Python = 'py')
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $here '..\..\..')).Path
$build = Join-Path $here 'build'
New-Item -ItemType Directory -Path $build -Force | Out-Null
foreach ($file in @('server.py','engine.py','update_transaction.py','control_bootstrap.py','control_reload.py','preinstall_guard.ps1','test_control.py','app.js','ui.html','GFARM_Definitivo.iss','install_windows.ps1')) {
  if (-not (Test-Path (Join-Path $here $file))) { throw "Arquivo obrigatorio ausente: $file" }
}
$git = Get-Command git.exe -ErrorAction Stop
$rev = (& $git.Source -C $repo rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Compilar dentro do repositorio GFARM.' }
Write-Host "GFARM, commit $rev"

function Find-Python313 {
  # Sem aspas internas: funciona tambem no binding nativo do PowerShell 5.1.
  $probe = 'import sys; sys.exit(1) if sys.version_info[:2] != (3, 13) else print(sys.executable)'
  if ($Python -eq 'py') {
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
      try {
        $found = & $launcher.Source -3.13 -c $probe 2>$null
        if ($LASTEXITCODE -eq 0 -and $found -and (Test-Path -LiteralPath "$found")) { return "$found" }
      } catch { }
    }
  }
  $command = Get-Command $(if ($Python -eq 'py') { 'python.exe' } else { $Python }) -ErrorAction SilentlyContinue
  $candidates = @(
    $(if ($command) { $command.Source }),
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'),
    (Join-Path $env:ProgramFiles 'Python313\python.exe')
  )
  foreach ($candidate in $candidates) {
    if (-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Leaf) -or
        $candidate -like '*\WindowsApps\*') { continue }
    try {
      $found = & $candidate -c $probe 2>$null
      if ($LASTEXITCODE -eq 0 -and $found -and (Test-Path -LiteralPath "$found")) { return "$found" }
    } catch { }
  }
  return $null
}
$interpreter = Find-Python313
if (-not $interpreter) {
  Write-Host 'Instalando Python 3.13 para compilar neste PC...'
  $winget = Get-Command winget.exe -ErrorAction Stop
  & $winget.Source install --id Python.Python.3.13 --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Falha instalando Python 3.13.' }
  $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('PATH','User') + ';' + $env:PATH
  $interpreter = Find-Python313
}
if (-not $interpreter) { throw 'Python 3.13 nao foi localizado apos a instalacao.' }
$Python = $interpreter
Push-Location $here
try {
  Write-Host '[1/3] Validando PowerShell do instalador e codigo Python web...'
  foreach ($script in @('install_windows.ps1', 'preinstall_guard.ps1')) {
    $tokens = $null
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile(
      (Join-Path $here $script), [ref]$tokens, [ref]$errors
    )
    if ($errors -and $errors.Count -gt 0) {
      foreach ($parseError in $errors) {
        Write-Host ("ERRO POWERSHELL (" + $script + "): " + $parseError.ToString()) -ForegroundColor Red
      }
      throw "Script $script contem erro de sintaxe. EXE nao sera gerado."
    }
  }
  Write-Host 'Scripts de instalacao e reparo validados.'
  & $Python -m py_compile server.py engine.py update_transaction.py control_bootstrap.py control_reload.py create_icons.py
  if ($LASTEXITCODE -ne 0) { throw 'Erro de sintaxe Python.' }
  & $Python test_control.py
  if ($LASTEXITCODE -ne 0) { throw 'Testes do GFARM Control falharam. Compilacao bloqueada.' }
  Write-Host '[2/3] Gerando somente icones WEB; sem PyInstaller...'
  & $Python -m pip install --disable-pip-version-check pillow
  if ($LASTEXITCODE -ne 0) { throw 'Pillow necessario para gerar os icones do instalador.' }
  & $Python create_icons.py
  if ($LASTEXITCODE -ne 0) { throw 'Falha gerando icones WEB.' }
  if (!(Test-Path (Join-Path $build 'GFARM.ico')) -or
      !(Test-Path (Join-Path $build 'GFARM-Control.ico'))) {
    throw 'Icones do GFARM/Control nao foram gerados.'
  }
  Write-Host '[3/3] Compilando APENAS o instalador Windows...'

  function Find-InnoSetup6 {
    # Inno Setup pode ser instalado em pasta personalizada ou apenas no perfil.
    # Priorizar caminhos descobertos no Registro do Windows.
    $candidates = New-Object 'System.Collections.Generic.List[string]'
    if ($env:INNO_SETUP_ISCC) { $candidates.Add($env:INNO_SETUP_ISCC) }
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates.Add($command.Source) }

    $registryPaths = @(
      'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKCU:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($regPath in $registryPaths) {
      foreach ($appInfo in @(Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue)) {
        if ([string]$appInfo.DisplayName -notmatch '^Inno Setup (6|7)(\s|$)') { continue }
        if ($appInfo.InstallLocation) {
          $candidates.Add((Join-Path ([string]$appInfo.InstallLocation) 'ISCC.exe'))
        }
        $uninstaller = [string]$appInfo.UninstallString
        if ($uninstaller -match '(?i)([a-z]:\\[^"]*?)\\unins\d+\.exe') {
          $candidates.Add((Join-Path $Matches[1] 'ISCC.exe'))
        }
      }
    }
    $bases = @(
      [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'),
      $env:ProgramFiles,
      $env:LOCALAPPDATA,
      (Join-Path $env:LOCALAPPDATA 'Programs')
    )
    foreach ($base in $bases) {
      if (-not $base) { continue }
      foreach ($directory in @('Inno Setup 6', 'Inno Setup 7')) {
        $candidates.Add((Join-Path $base (Join-Path $directory 'ISCC.exe')))
      }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
      if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        return $candidate
      }
    }
    return $null
  }
  $iscc = Find-InnoSetup6
  if (-not $iscc) {
    Write-Host 'Inno Setup 6 ausente. Instalando automaticamente pelo winget...'
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
      throw 'Inno Setup 6 ausente e winget indisponivel. Instale Inno Setup 6 e execute novamente.'
    }
    & $winget.Source install --id JRSoftware.InnoSetup --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
      throw "Instalacao do Inno Setup 6 falhou (codigo $LASTEXITCODE)."
    }
    $iscc = Find-InnoSetup6
  }
  if (-not $iscc) {
    throw 'O Inno Setup esta registrado como instalado, mas ISCC.exe nao foi localizado. Informe seu caminho com $env:INNO_SETUP_ISCC = ''C:\caminho\ISCC.exe'' e execute novamente.'
  }
  Write-Host "Compilador Inno Setup: $iscc"
  & $iscc (Join-Path $here 'GFARM_Definitivo.iss')
  if ($LASTEXITCODE -ne 0) { throw 'Erro Inno Setup.' }
  $exe = Join-Path $build 'GFARM_Instalador_Definitivo.exe'
  if (-not (Test-Path $exe)) { throw 'Instalador nao foi gerado.' }
  $sha = (Get-FileHash $exe -Algorithm SHA256).Hash
  Set-Content "$exe.sha256" "$sha  GFARM_Instalador_Definitivo.exe" -Encoding ascii
  $desktop = [Environment]::GetFolderPath('Desktop')
  if ($desktop -and (Test-Path -LiteralPath $desktop)) {
    $desktopSetup = Join-Path $desktop 'GFARM_Instalador_Definitivo.exe'
    Copy-Item -LiteralPath $exe -Destination $desktopSetup -Force
    Write-Host "INSTALADOR NA AREA DE TRABALHO: $desktopSetup"
  }
  Write-Host "INSTALADOR: $exe"
  Write-Host "SHA-256: $sha"
} finally { Pop-Location }
