#requires -Version 5.1
# Publicacao MANUAL de versao APROVADA, substituindo os arquivos da MESMA Release.
# NUNCA cria outra Release ou tag, NUNCA apaga outras Releases automaticamente.
param([switch]$VersaoAprovada)
$ErrorActionPreference = 'Stop'
if (-not $VersaoAprovada) {
  throw 'Publicacao bloqueada. Use -VersaoAprovada SOMENTE apos aprovacao explicita da versao testada.'
}

$repo = 'layon-lima/GFARM'
$tagOficial = 'gfarm-instalador-01aab5398bed'
$pasta = $PSScriptRoot
$raiz = (Resolve-Path (Join-Path $pasta '..\..\..')).Path
$exe = Join-Path $pasta 'build\GFARM_Instalador_Definitivo.exe'
$checksum = "$exe.sha256"

function Conferir([string]$passo) {
  if ($LASTEXITCODE -ne 0) { throw "$passo falhou (codigo $LASTEXITCODE)." }
}
function Achar-GitHubCLI {
  $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('PATH','User')
  $comando = Get-Command gh.exe -ErrorAction SilentlyContinue
  if ($comando) { return $comando.Source }
  foreach ($candidate in @(
    (Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\GitHub CLI\gh.exe')
  )) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  throw 'GitHub CLI nao encontrado. Instale gh e autentique na sua conta GitHub.'
}

Push-Location $raiz
try {
  $git = (Get-Command git.exe -ErrorAction Stop).Source
  $origin = (& $git remote get-url origin).Trim()
  Conferir 'Consulta ao repositorio'
  if ($origin -notmatch 'github\.com[:/]layon-lima/GFARM(\.git)?$') {
    throw 'Voce nao esta no repositorio oficial GFARM.'
  }
  $branch = (& $git branch --show-current).Trim()
  if ($branch -ne 'main') { throw 'Use a branch main.' }
  & $git fetch origin main
  Conferir 'Sincronizacao com GitHub'
  $local = (& $git rev-parse HEAD).Trim()
  $remoto = (& $git rev-parse origin/main).Trim()
  if ($local -ne $remoto) {
    throw 'Versao local diferente da main. Execute git pull --ff-only origin main.'
  }
  $alteracoes = (& $git status --porcelain --untracked-files=no | Out-String).Trim()
  if ($alteracoes) { throw 'Ha alteracoes locais nao publicadas. Resolva antes do envio.' }

  Write-Host '[1/5] Conferindo que existe apenas UMA Release oficial...'
  $gh = Achar-GitHubCLI
  & $gh auth status --hostname github.com
  Conferir 'Autenticacao GitHub CLI'
  $tags = @(& $gh release list --repo $repo --limit 200 --json tagName --jq '.[].tagName')
  Conferir 'Leitura das Releases'
  if ($tags.Count -ne 1 -or $tags[0] -ne $tagOficial) {
    throw "A lista de Releases mudou. Esperado apenas: $tagOficial. Nenhum upload realizado."
  }
  $antes = & $gh release view $tagOficial --repo $repo --json assets,url
  Conferir 'Conferencia da Release oficial'
  $release = $antes | ConvertFrom-Json
  if (@($release.assets | Where-Object { $_.name -eq 'GFARM_Instalador_Definitivo.exe' }).Count -ne 1) {
    throw 'A Release oficial existente nao contem o EXE esperado. Nenhum upload realizado.'
  }

  Write-Host '[2/5] Gerando instalador da versao aprovada...'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pasta 'build_windows.ps1')
  Conferir 'Compilacao'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Instalador nao encontrado.' }
  # O instalador web e leve. Validar o formato PE em vez de exigir 1 MB.
  $bytes = [IO.File]::ReadAllBytes($exe)
  if ($bytes.Length -lt 64 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
    throw 'O compilador nao produziu um executavel Windows valido.'
  }
  $pe = [BitConverter]::ToInt32($bytes, 0x3C)
  if ($pe -lt 0 -or $pe -gt ($bytes.Length - 4) -or
      $bytes[$pe] -ne 0x50 -or $bytes[$pe + 1] -ne 0x45 -or
      $bytes[$pe + 2] -ne 0 -or $bytes[$pe + 3] -ne 0) {
    throw 'Cabecalho PE do instalador invalido.'
  }
  $sha = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
  Set-Content -LiteralPath $checksum -Encoding ASCII -Value ($sha + '  GFARM_Instalador_Definitivo.exe')

  Write-Host '[3/5] Substituindo arquivos SOMENTE na Release oficial...'
  & $gh release upload $tagOficial $exe $checksum --repo $repo --clobber
  Conferir 'Substituicao dos arquivos da Release'

  Write-Host '[4/5] Atualizando descricao da versao publicada...'
  $notes = 'Unica Release oficial GFARM + GFARM Control. Instalador aprovado e compilado da main em ' +
           (Get-Date -Format 'yyyy-MM-dd HH:mm') + '. Commit de codigo: ' + $local +
           '. Baixa GFARM diretamente do repositorio privado e preserva o PostgreSQL existente.'
  & $gh release edit $tagOficial --repo $repo --title 'GFARM - Instalador Oficial' --notes $notes
  Conferir 'Atualizacao das notas da Release'

  Write-Host '[5/5] Verificando que nao surgiu outra Release...'
  $finalTags = @(& $gh release list --repo $repo --limit 200 --json tagName --jq '.[].tagName')
  Conferir 'Verificacao final'
  $depois = & $gh release view $tagOficial --repo $repo --json assets,url
  Conferir 'Verificacao final do instalador'
  $confirmada = $depois | ConvertFrom-Json
  $nomes = @($confirmada.assets | ForEach-Object { $_.name })
  if ($finalTags.Count -ne 1 -or $finalTags[0] -ne $tagOficial -or
      $nomes -notcontains 'GFARM_Instalador_Definitivo.exe' -or
      $nomes -notcontains 'GFARM_Instalador_Definitivo.exe.sha256') {
    throw 'A publicacao exige revisao. Confira manualmente a Release no GitHub.'
  }
  Write-Host 'SUCESSO: instalador substituido na unica Release oficial.' -ForegroundColor Green
  Write-Host ('Link: ' + $confirmada.url)
  Write-Host ('SHA-256: ' + $sha)
} finally {
  Pop-Location
}
