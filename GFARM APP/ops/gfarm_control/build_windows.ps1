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
  Write-Host '[1/5] Validando Python...'
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
  Write-Host '[4/5] Empacotando apenas arquivos oficiais do Git...'
  $zip = Join-Path $build 'GFARM_APP.zip'
  if (Test-Path $zip) { Remove-Item $zip -Force }
  & $git.Source -C $repo archive --format=zip "--output=$zip" HEAD 'GFARM APP'
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $zip)) { throw 'Falha no pacote do aplicativo.' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $paths = @($archive.Entries | ForEach-Object { $_.FullName })
    if ($paths -notcontains 'GFARM APP/backend/run_production.py') { throw 'Pacote sem backend GFARM.' }
    if ($paths | Where-Object { $_ -like '*backend/.env' -or $_ -like '*node_modules/*' }) {
      throw 'Pacote contem credenciais ou node_modules.'
    }
  } finally { $archive.Dispose() }
  Write-Host '[5/5] Compilando Inno Setup...'
  $pfx86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  if (-not $pfx86) { $pfx86 = $env:ProgramFiles }
  $iscc = Join-Path $pfx86 'Inno Setup 6\ISCC.exe'
  if (-not (Test-Path $iscc)) { $iscc = Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe' }
  if (-not (Test-Path $iscc)) { throw 'Instale Inno Setup 6 para compilar.' }
  & $iscc (Join-Path $here 'GFARM_Definitivo.iss')
  if ($LASTEXITCODE -ne 0) { throw 'Erro Inno Setup.' }
  $exe = Join-Path $build 'GFARM_Instalador_Definitivo.exe'
  if (-not (Test-Path $exe)) { throw 'Instalador nao foi gerado.' }
  $sha = (Get-FileHash $exe -Algorithm SHA256).Hash
  Set-Content "$exe.sha256" "$sha  GFARM_Instalador_Definitivo.exe" -Encoding ascii
  Write-Host "INSTALADOR: $exe"
  Write-Host "SHA-256: $sha"
} finally { Pop-Location }
