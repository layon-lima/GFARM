#requires -Version 5.1
# Compila o instalador GFARM mais recente e publica seu EXE em GitHub Releases.
# O repositorio deve estar clonado com Git e autenticado pelo usuario do GitHub.
# Nao acessa banco PostgreSQL e nao executa instalacao no Windows.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = (Resolve-Path (Join-Path $here '..\..\..')).Path
$repoId = 'layon-lima/GFARM'
$builder = Join-Path $here 'build_windows.ps1'
$exe = Join-Path $here 'build\GFARM_Instalador_Definitivo.exe'
$hashFile = "$exe.sha256"

function Refresh-Path {
  $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('PATH','User')
}
function Find-GitHubCli {
  Refresh-Path
  $found = Get-Command 'gh.exe' -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  $paths = @(
    (Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\GitHub CLI\gh.exe')
  )
  foreach ($p in $paths) {
    if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
  }
  return $null
}
function Fail-OnExit([string]$message) {
  if ($LASTEXITCODE -ne 0) { throw "$message (codigo $LASTEXITCODE)." }
}

Push-Location $root
try {
  $git = (Get-Command 'git.exe' -ErrorAction Stop).Source
  $origin = (& $git remote get-url origin).Trim()
  Fail-OnExit 'Repositorio Git sem origem configurada'
  if ($origin -notmatch 'github\.com[:/]layon-lima/GFARM(\.git)?$') {
    throw "O diretorio aberto nao e o repositorio oficial: $origin"
  }
  Write-Host '[1/5] Conferindo versao main do GitHub...'
  & $git fetch origin main
  Fail-OnExit 'Falha ao consultar main'
  $remote = (& $git rev-parse refs/remotes/origin/main).Trim()
  Fail-OnExit 'Nao foi possivel verificar origin/main'
  $current = (& $git rev-parse HEAD).Trim()
  Fail-OnExit 'Nao foi possivel ler o commit atual'
  if ($current -ne $remote) {
    throw 'Seu clone esta desatualizado. Execute: git pull --ff-only origin main'
  }
  $modified = @(& $git status --porcelain --untracked-files=no)
  Fail-OnExit 'Falha ao consultar alteracoes locais'
  if ($modified.Count -gt 0 -and ($modified -join '').Trim()) {
    throw 'Existem arquivos versionados alterados no VS Code. Salve/guarde suas alteracoes antes de publicar.'
  }
  $short = $current.Substring(0,12)
  $tag = "gfarm-instalador-$short"

  Write-Host '[2/5] Gerando o instalador Windows atualizado...'
  $buildStarted = Get-Date
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $builder
  Fail-OnExit 'Falha ao compilar GFARM_Instalador_Definitivo.exe'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw 'Arquivo de instalacao nao foi gerado.'
  }
  if ((Get-Item -LiteralPath $exe).LastWriteTime -lt $buildStarted.AddSeconds(-5)) {
    throw 'O instalador nao foi atualizado nesta compilacao. Publicacao bloqueada.'
  }
  $hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
  Set-Content -LiteralPath $hashFile -Encoding Ascii -Value ($hash + '  GFARM_Instalador_Definitivo.exe')

  Write-Host '[3/5] Preparando GitHub CLI...'
  $gh = Find-GitHubCli
  if (-not $gh) {
    $wg = Get-Command 'winget.exe' -ErrorAction SilentlyContinue
    if (-not $wg) { throw 'Instale GitHub CLI (gh) ou habilite winget no Windows.' }
    & $wg.Source install --id GitHub.cli --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    Fail-OnExit 'Nao foi possivel instalar GitHub CLI'
    $gh = Find-GitHubCli
  }
  if (-not $gh) { throw 'GitHub CLI nao localizado apos a instalacao. Reabra VS Code e execute novamente.' }
  & $gh auth status --hostname github.com 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Autorize o GitHub CLI no navegador. Use a conta proprietaria do repositorio GFARM.'
    & $gh auth login --hostname github.com --git-protocol https --web
    Fail-OnExit 'Nao foi possivel autenticar no GitHub'
  }
  Write-Host '[4/6] Enviando o EXE e o SHA256 para GitHub Releases...'
  $existingJson = & $gh release list --repo $repoId --json tagName --limit 100
  Fail-OnExit 'Nao foi possivel listar Releases'
  $releases = @($existingJson | ConvertFrom-Json)
  $exists = @($releases | Where-Object { $_.tagName -eq $tag }).Count -gt 0
  if ($exists) {
    & $gh release upload $tag $exe $hashFile --repo $repoId --clobber
    Fail-OnExit 'Falha ao atualizar arquivos da Release existente'
  } else {
    $notes = 'Instalador online do GFARM e GFARM Control. Obtem o GFARM diretamente da main privada no momento da instalacao. PostgreSQL existente nao e apagado. Compilado no Windows a partir do commit ' + $current + '.'
    & $gh release create $tag $exe $hashFile --repo $repoId --target $current --title "GFARM - Instalador Windows ($short)" --notes $notes
    Fail-OnExit 'Falha ao publicar Release'
  }
  Write-Host '[5/6] Conferindo arquivos publicados...'
  $publishedJson = & $gh release view $tag --repo $repoId --json assets,url
  Fail-OnExit 'Nao foi possivel verificar a Release'
  $published = $publishedJson | ConvertFrom-Json
  $asset = @($published.assets | Where-Object { $_.name -eq 'GFARM_Instalador_Definitivo.exe' })
  if ($asset.Count -ne 1) { throw 'A Release nao confirmou a presenca do instalador EXE.' }

  # Somente APOS confirmar que o novo EXE esta publicado:
  # remover antigos GFARM_Instalador.exe, preservando PAINEL_ESTQ.exe,
  # arquivos dos painéis e as próprias Releases históricas.
  Write-Host '[6/6] Removendo instaladores GFARM antigos das Releases painel-estq...'
  $legacyJson = & $gh api "repos/$repoId/releases?per_page=100"
  Fail-OnExit 'Falha ao buscar as Releases antigas; nenhuma exclusao iniciada'
  $legacyReleases = @($legacyJson | ConvertFrom-Json)
  $removed = 0
  foreach ($oldRelease in $legacyReleases) {
    if ([string]$oldRelease.tag_name -notmatch '^painel-estq-\d+
  Write-Host ('LINK: ' + $published.url)
  Write-Host ('SHA-256: ' + $hash)
} finally {
  Pop-Location
}
) { continue }
    foreach ($oldAsset in @($oldRelease.assets)) {
      $fileName = [string]$oldAsset.name
      if ($fileName -ne 'GFARM_Instalador.exe' -and
          $fileName -ne 'GFARM_Instalador.exe.sha256') { continue }
      Write-Host ("Removendo antigo: " + $oldRelease.tag_name + " / " + $fileName)
      & $gh api --method DELETE ("repos/$repoId/releases/assets/" + [string]$oldAsset.id)
      Fail-OnExit ("Falha ao remover $fileName da Release " + $oldRelease.tag_name)
      $removed++
    }
  }
  Write-Host "Arquivos antigos de instaladores removidos: $removed"

  Write-Host ''
  Write-Host 'INSTALADOR PUBLICADO NO GITHUB COM SUCESSO!' -ForegroundColor Green
  Write-Host ('LINK: ' + $published.url)
  Write-Host ('SHA-256: ' + $hash)
} finally {
  Pop-Location
}
