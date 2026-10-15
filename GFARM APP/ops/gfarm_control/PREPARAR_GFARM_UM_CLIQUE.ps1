#requires -Version 5.1
# GFARM: preparador do instalador definitivo na propria maquina Windows.
# Le repo privado via Git Credential Manager; nao apaga PostgreSQL.
$ErrorActionPreference = "Stop"
$work = Join-Path $env:LOCALAPPDATA "GFARM-Preparador"
New-Item -ItemType Directory -Force -Path $work | Out-Null
function Refresh-Path {
  $env:PATH=[Environment]::GetEnvironmentVariable("PATH","Machine")+";"+[Environment]::GetEnvironmentVariable("PATH","User")
}
function Find([string]$cmd) {
  Refresh-Path
  $c=Get-Command $cmd -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return $null
}
function Install([string]$id) {
  $wg=Find "winget.exe"
  if (!$wg) { throw "winget nao encontrado. Atualize o App Installer do Windows." }
  Write-Host "Instalando $id..."
  & $wg install --id $id --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -ne 0) { throw "winget falhou instalando $id." }
}
function Inno {
  $pf86=[Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  foreach($candidate in @((Join-Path $pf86 "Inno Setup 6\ISCC.exe"),(Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"),(Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"))) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}
function Python313 {
  $py=Find "py.exe"
  if($py) {
    & $py -3.13 -c "import sys;sys.exit(0 if sys.version_info[:2] == (3,13) else 1)" 2>$null
    if($LASTEXITCODE -eq 0) { return $true }
  }
  return $false
}
try {
  Write-Host "GFARM — preparador do instalador completo"
  $git=Find "git.exe"
  if(!$git) { Install "Git.Git";$git=Find "git.exe" }
  if(!$git) { $git=Join-Path $env:ProgramFiles "Git\cmd\git.exe" }
  if(!(Test-Path $git)) { throw "Git nao encontrado. Reinicie o Windows." }
  if(!(Python313)) {
    Install "Python.Python.3.13"
    if(!(Python313)) { throw "Reinicie Windows para reconhecer Python 3.13." }
  }
  if(!(Inno)) { Install "JRSoftware.InnoSetup" }
  if(!(Inno)) { throw "Inno Setup 6 nao encontrado." }
  $dest=Join-Path $work ("fonte-"+(Get-Date -Format "yyyyMMdd-HHmmss"))
  & $git clone --depth 1 --branch main --single-branch "https://github.com/layon-lima/GFARM.git" $dest
  if($LASTEXITCODE -ne 0) { throw "Login/clone do GitHub privado falhou." }
  $builder=Join-Path $dest "GFARM APP\ops\gfarm_control\build_windows.ps1"
  if(!(Test-Path $builder)) { throw "Build oficial nao encontrado." }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $builder
  if($LASTEXITCODE -ne 0) { throw "Compilacao do instalador falhou." }
  $exe=Join-Path $dest "GFARM APP\ops\gfarm_control\build\GFARM_Instalador_Definitivo.exe"
  if(!(Test-Path $exe)) { throw "Executavel nao foi gerado." }
  $output=Join-Path ([Environment]::GetFolderPath("Desktop")) "GFARM_Instalador_Definitivo.exe"
  Copy-Item -LiteralPath $exe -Destination $output -Force
  Write-Host "Instalador compilado: $output"
  Start-Process -FilePath $output -Verb RunAs -Wait
  Write-Host "Finalizado. Abra GFARM Control no atalho."
} catch {
  Write-Host ("FALHA: "+$_.Exception.Message) -ForegroundColor Red
  Write-Host "Pressione Enter para encerrar."
  [void][Console]::ReadLine()
  exit 1
}
