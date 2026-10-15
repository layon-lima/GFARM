#requires -Version 5.1
# Compilar instalador GFARM em Windows com Git e Inno Setup 6.
param([string]$Python = 'py')
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $here '..\..\..')).Path
$build = Join-Path $here 'build'
New-Item -ItemType Directory -Path $build -Force | Out-Null
foreach ($file in @('server.py','engine.py','launcher.py','app.js','ui.html','GFARM_Definitivo.iss','install_windows.ps1')) {
  if (-not (Test-Path (Join-Path $here $file))) { throw "Arquivo obrigatorio ausente: $file" }
}
$git = Get-Command git.exe -ErrorAction Stop
$rev = (& $git.Source -C $repo rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Compilar dentro do repositorio GFARM.' }
Write-Host "GFARM, commit $rev"
Push-Location $here
try {
  Write-Host '[1/5] Validando PowerShell do instalador e sintaxe Python...'
  $installerTokens = $null
  $installerErrors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $here 'install_windows.ps1'),
    [ref]$installerTokens,
    [ref]$installerErrors
  )
  if ($installerErrors -and $installerErrors.Count -gt 0) {
    foreach ($parseError in $installerErrors) {
      Write-Host ("ERRO POWERSHELL: " + $parseError.ToString()) -ForegroundColor Red
    }
    throw 'O instalador tem erro de sintaxe PowerShell. EXE NAO sera gerado.'
  }
  Write-Host 'Script de instalacao PowerShell validado.'
  & $Python -3.13 -m py_compile server.py engine.py launcher.py create_icons.py
  if ($LASTEXITCODE -ne 0) { throw 'Erro de sintaxe Python.' }
  Write-Host '[2/5] Instalando utilitarios de build...'
  & $Python -3.13 -m pip install pyinstaller pillow
  if ($LASTEXITCODE -ne 0) { throw 'Instale PyInstaller e Pillow.' }
  Write-Host '[3/5] Criando icones e executaveis...'
  & $Python -3.13 create_icons.py
  if ($LASTEXITCODE -ne 0) { throw 'Falha nos icones.' }
  $controlArgs = @('-3.13','-m','PyInstaller','--noconfirm','--onefile','--windowed',
    '--clean','--paths',$here,'--hidden-import','engine',
    '--add-data',"$here\ui.html;.",'--add-data',"$here\app.js;.",
    '--icon',"$build\GFARM-Control.ico",'--distpath',$build,
    '--workpath',"$build\pyi-control",'--specpath',"$build\spec",
    '--name','GFARM-Control','server.py')
  & $Python @controlArgs
  if ($LASTEXITCODE -ne 0) { throw 'Falha no GFARM-Control.exe.' }
  $appArgs = @('-3.13','-m','PyInstaller','--noconfirm','--onefile',
    '--windowed','--clean','--icon',"$build\GFARM.ico",
    '--distpath',$build,'--workpath',"$build\pyi-gfarm",
    '--specpath',"$build\spec",'--name','GFARM','launcher.py')
  & $Python @appArgs
  if ($LASTEXITCODE -ne 0) { throw 'Falha no GFARM.exe.' }
  Write-Host '[4/5] Instalador online: sem empacotar o repositorio.'
  # Remover pacote legado apenas na pasta temporaria de build.
  # O instalador final passa a baixar GFARM APP do GitHub na instalacao.
  $oldZip = Join-Path $build 'GFARM_APP.zip'
  if (Test-Path -LiteralPath $oldZip -PathType Leaf) {
    Remove-Item -LiteralPath $oldZip -Force
  }
  if (!(Test-Path (Join-Path $build 'GFARM.exe')) -or
      !(Test-Path (Join-Path $build 'GFARM-Control.exe'))) {
    throw 'Executaveis GFARM e GFARM-Control ausentes.'
  }
  Write-Host '[5/5] Localizando Inno Setup 6 e compilando...'
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
