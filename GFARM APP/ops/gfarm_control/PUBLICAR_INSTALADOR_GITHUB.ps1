#requires -Version 5.1
# Publica GFARM_Instalador_Definitivo.exe e APOS CONFIRMAR remove as releases legadas.
# Nao apaga backups, banco, migrations nem arquivos do GFARM atual.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = (Resolve-Path (Join-Path $here '..\..\..')).Path
$repo = 'layon-lima/GFARM'
$exe = Join-Path $here 'build\GFARM_Instalador_Definitivo.exe'
$hashFile = "$exe.sha256"

function Check-Result([string]$desc) {
  if ($LASTEXITCODE -ne 0) { throw "$desc (codigo $LASTEXITCODE)." }
}
function Locate-Gh {
  $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('PATH','User')
  $g = Get-Command 'gh.exe' -ErrorAction SilentlyContinue
  if ($g) { return $g.Source }
  foreach ($candidate in @(
    (Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\GitHub CLI\gh.exe')
  )) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  return $null
}

Push-Location $root
try {
  $git = (Get-Command 'git.exe' -ErrorAction Stop).Source
  $origin = (& $git remote get-url origin).Trim()
  Check-Result 'Nao foi possivel verificar origin'
  if ($origin -notmatch 'github\.com[:/]layon-lima/GFARM(\.git)?$') {
    throw "Repositorio inesperado: $origin"
  }
  $branch = (& $git branch --show-current).Trim()
  if ($branch -ne 'main') { throw 'Selecione a branch main antes de publicar.' }
  & $git fetch origin main
  Check-Result 'Falha ao sincronizar main'
  $current = (& $git rev-parse HEAD).Trim()
  $remote = (& $git rev-parse origin/main).Trim()
  if ($current -ne $remote) {
    throw 'A pasta local esta desatualizada. Execute git pull --ff-only origin main.'
  }
  $dirty = (& $git status --porcelain --untracked-files=no | Out-String).Trim()
  if ($dirty) { throw 'Existem alteracoes locais nao publicadas. Guarde-as antes de publicar.' }
  $tag = 'gfarm-instalador-' + $current.Substring(0,12)

  Write-Host '[1/5] Compilando instalador atual...'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'build_windows.ps1')
  Check-Result 'Build do GFARM falhou'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Instalador nao foi gerado.' }
  if ((Get-Item -LiteralPath $exe).Length -lt 1000000) {
    throw 'O instalador esta inesperadamente pequeno. Publicacao bloqueada.'
  }
  $hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
  Set-Content -LiteralPath $hashFile -Encoding ASCII -Value ($hash + '  GFARM_Instalador_Definitivo.exe')

  Write-Host '[2/5] Autenticando no GitHub...'
  $gh = Locate-Gh
  if (-not $gh) {
    $winget = Get-Command 'winget.exe' -ErrorAction SilentlyContinue
    if (-not $winget) { throw 'Instale GitHub CLI (gh) para publicar o EXE.' }
    & $winget.Source install --id GitHub.cli --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    Check-Result 'Falha ao instalar GitHub CLI'
    $gh = Locate-Gh
    if (-not $gh) { throw 'GitHub CLI instalado mas nao localizado; reinicie o VS Code.' }
  }
  try { & $gh auth status --hostname github.com 2>$null | Out-Null } catch { }
  if ($LASTEXITCODE -ne 0) {
    & $gh auth login --hostname github.com --git-protocol https --web
    Check-Result 'Falha no login do GitHub'
  }

  Write-Host '[3/5] Publicando EXE definitivo...'
  $json = & $gh release list --repo $repo --limit 200 --json tagName
  Check-Result 'Nao foi possivel consultar Releases'
  $list = @($json | ConvertFrom-Json)
  $exists = @($list | Where-Object { $_.tagName -eq $tag }).Count -gt 0
  if ($exists) {
    & $gh release upload $tag $exe $hashFile --repo $repo --clobber
    Check-Result 'Falha ao atualizar o instalador publicado'
  } else {
    $notes = 'GFARM e GFARM Control Windows: instalador oficial online. Compilado do commit ' + $current +
             '. Baixa os arquivos atuais do GitHub privado e preserva o PostgreSQL existente.'
    & $gh release create $tag $exe $hashFile --repo $repo --target $current --title 'GFARM - Instalador Definitivo' --notes $notes
    Check-Result 'Falha ao criar a Release nova'
  }

  Write-Host '[4/5] Conferindo instalador novo ANTES de apagar os antigos...'
  $infoJson = & $gh release view $tag --repo $repo --json assets,url
  Check-Result 'Falha ao verificar Release nova'
  $info = $infoJson | ConvertFrom-Json
  $matching = @($info.assets | Where-Object { $_.name -eq 'GFARM_Instalador_Definitivo.exe' })
  if ($matching.Count -ne 1) {
    throw 'Arquivo EXE novo nao confirmado: os instaladores antigos NAO foram apagados.'
  }

  Write-Host '[5/5] Excluindo TODAS as Releases do painel legado...'
  $old = @($list | Where-Object { $_.tagName -match '^painel-estq-[0-9]+$' })
  $removed = 0
  foreach ($oldEntry in $old) {
    $oldTag = [string]$oldEntry.tagName
    Write-Host ('Excluindo Release obsoleta: ' + $oldTag)
    & $gh release delete $oldTag --repo $repo --cleanup-tag --yes
    Check-Result ('Falha ao remover Release obsoleta ' + $oldTag)
    $removed++
  }
  $checkJson = & $gh release list --repo $repo --limit 200 --json tagName
  Check-Result 'Falha ao conferir releases'
  $remaining = @($checkJson | ConvertFrom-Json | Where-Object { $_.tagName -match '^painel-estq-[0-9]+$' })
  if ($remaining.Count -gt 0) { throw 'Releases antigas ainda existem; verifique permissao do GitHub.' }
  Write-Host 'GFARM PUBLICADO. RELEASES LEGADAS REMOVIDAS!' -ForegroundColor Green
  Write-Host ('Removidas: ' + $removed)
  Write-Host ('Release atual: ' + $info.url)
  Write-Host ('SHA-256: ' + $hash)
} finally {
  Pop-Location
}
