#requires -Version 5.1
# Remove exclusivamente Releases legadas painel-estq-N.
# Confirma antes que o GFARM_Instalador_Definitivo.exe esta publicado.
# Nao compila, instala nem altera bancos, backups ou a branch main.
$ErrorActionPreference = 'Stop'
$repo = 'layon-lima/GFARM'
$ghCommand = Get-Command gh.exe -ErrorAction SilentlyContinue
if (-not $ghCommand) {
  $possible = @(
    (Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\GitHub CLI\gh.exe')
  )
  foreach ($p in $possible) {
    if (Test-Path -LiteralPath $p -PathType Leaf) {
      $ghCommand = @{ Source = $p }
      break
    }
  }
}
if (-not $ghCommand) { throw 'GitHub CLI (gh) nao foi encontrado.' }
$gh = [string]$ghCommand.Source

Write-Host '[1/3] Conferindo instalador definitivo publicado no GitHub...'
# --jq retorna um nome por linha, evitando que o ConvertFrom-Json una tags.
$allTags = @(& $gh release list --repo $repo --limit 200 --json tagName --jq '.[].tagName')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao listar Releases no GitHub.' }
$newTags = @($allTags | Where-Object { $_ -match '^gfarm-instalador-([0-9a-f]{12}|oficial)$' })
$confirmed = $false
foreach ($newTag in $newTags) {
  $publishedAssets = @(& $gh release view $newTag --repo $repo --json assets --jq '.assets[].name')
  if ($LASTEXITCODE -ne 0) { throw "Falha ao verificar a Release $newTag." }
  if ($publishedAssets -contains 'GFARM_Instalador_Definitivo.exe') {
    Write-Host "Novo instalador confirmado: $newTag" -ForegroundColor Green
    $confirmed = $true
    $confirmedTag = [string]$newTag
    break
  }
}
if (-not $confirmed) {
  throw 'Instalador definitivo nao encontrado nas Releases. Nenhum arquivo antigo foi excluido.'
}

Write-Host '[2/3] Excluindo Releases do instalador e painel antigos...'
$legacy = @($allTags | Where-Object {
  $_ -match '^painel-estq-[0-9]+
$removed = 0
foreach ($oldTag in $legacy) {
  Write-Host "Excluindo: $oldTag"
  & $gh release delete $oldTag --repo $repo --cleanup-tag --yes
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao excluir $oldTag. Remocao interrompida."
  }
  $removed++
}

Write-Host '[3/3] Conferindo resultado final...'
$after = @(& $gh release list --repo $repo --limit 200 --json tagName --jq '.[].tagName')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao conferir as Releases apos a limpeza.' }
$remaining = @($after | Where-Object {
  $_ -match '^painel-estq-[0-9]+
if ($remaining.Count -gt 0) {
  throw ("Ainda restam Releases antigas: " + ($remaining -join ', '))
}
Write-Host "LIMPEZA CONCLUIDA: $removed Releases antigas removidas." -ForegroundColor Green
Write-Host 'GFARM_Instalador_Definitivo.exe foi preservado.'
 -or
  ($confirmedTag -eq 'gfarm-instalador-oficial' -and $_ -match '^gfarm-instalador-[0-9a-f]{12}
$removed = 0
foreach ($oldTag in $legacy) {
  Write-Host "Excluindo: $oldTag"
  & $gh release delete $oldTag --repo $repo --cleanup-tag --yes
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao excluir $oldTag. Remocao interrompida."
  }
  $removed++
}

Write-Host '[3/3] Conferindo resultado final...'
$after = @(& $gh release list --repo $repo --limit 200 --json tagName --jq '.[].tagName')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao conferir as Releases apos a limpeza.' }
$remaining = @($after | Where-Object { $_ -match '^painel-estq-[0-9]+$' })
if ($remaining.Count -gt 0) {
  throw ("Ainda restam Releases antigas: " + ($remaining -join ', '))
}
Write-Host "LIMPEZA CONCLUIDA: $removed Releases antigas removidas." -ForegroundColor Green
Write-Host 'GFARM_Instalador_Definitivo.exe foi preservado.'
)
})
$removed = 0
foreach ($oldTag in $legacy) {
  Write-Host "Excluindo: $oldTag"
  & $gh release delete $oldTag --repo $repo --cleanup-tag --yes
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao excluir $oldTag. Remocao interrompida."
  }
  $removed++
}

Write-Host '[3/3] Conferindo resultado final...'
$after = @(& $gh release list --repo $repo --limit 200 --json tagName --jq '.[].tagName')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao conferir as Releases apos a limpeza.' }
$remaining = @($after | Where-Object { $_ -match '^painel-estq-[0-9]+$' })
if ($remaining.Count -gt 0) {
  throw ("Ainda restam Releases antigas: " + ($remaining -join ', '))
}
Write-Host "LIMPEZA CONCLUIDA: $removed Releases antigas removidas." -ForegroundColor Green
Write-Host 'GFARM_Instalador_Definitivo.exe foi preservado.'
 -or
  ($confirmedTag -eq 'gfarm-instalador-oficial' -and $_ -match '^gfarm-instalador-[0-9a-f]{12}
if ($remaining.Count -gt 0) {
  throw ("Ainda restam Releases antigas: " + ($remaining -join ', '))
}
Write-Host "LIMPEZA CONCLUIDA: $removed Releases antigas removidas." -ForegroundColor Green
Write-Host 'GFARM_Instalador_Definitivo.exe foi preservado.'
 -or
  ($confirmedTag -eq 'gfarm-instalador-oficial' -and $_ -match '^gfarm-instalador-[0-9a-f]{12}
$removed = 0
foreach ($oldTag in $legacy) {
  Write-Host "Excluindo: $oldTag"
  & $gh release delete $oldTag --repo $repo --cleanup-tag --yes
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao excluir $oldTag. Remocao interrompida."
  }
  $removed++
}

Write-Host '[3/3] Conferindo resultado final...'
$after = @(& $gh release list --repo $repo --limit 200 --json tagName --jq '.[].tagName')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao conferir as Releases apos a limpeza.' }
$remaining = @($after | Where-Object { $_ -match '^painel-estq-[0-9]+$' })
if ($remaining.Count -gt 0) {
  throw ("Ainda restam Releases antigas: " + ($remaining -join ', '))
}
Write-Host "LIMPEZA CONCLUIDA: $removed Releases antigas removidas." -ForegroundColor Green
Write-Host 'GFARM_Instalador_Definitivo.exe foi preservado.'
)
})
$removed = 0
foreach ($oldTag in $legacy) {
  Write-Host "Excluindo: $oldTag"
  & $gh release delete $oldTag --repo $repo --cleanup-tag --yes
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao excluir $oldTag. Remocao interrompida."
  }
  $removed++
}

Write-Host '[3/3] Conferindo resultado final...'
$after = @(& $gh release list --repo $repo --limit 200 --json tagName --jq '.[].tagName')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao conferir as Releases apos a limpeza.' }
$remaining = @($after | Where-Object { $_ -match '^painel-estq-[0-9]+$' })
if ($remaining.Count -gt 0) {
  throw ("Ainda restam Releases antigas: " + ($remaining -join ', '))
}
Write-Host "LIMPEZA CONCLUIDA: $removed Releases antigas removidas." -ForegroundColor Green
Write-Host 'GFARM_Instalador_Definitivo.exe foi preservado.'
)
})
if ($remaining.Count -gt 0) {
  throw ("Ainda restam Releases antigas: " + ($remaining -join ', '))
}
Write-Host "LIMPEZA CONCLUIDA: $removed Releases antigas removidas." -ForegroundColor Green
Write-Host 'GFARM_Instalador_Definitivo.exe foi preservado.'
 -or
  ($confirmedTag -eq 'gfarm-instalador-oficial' -and $_ -match '^gfarm-instalador-[0-9a-f]{12}
$removed = 0
foreach ($oldTag in $legacy) {
  Write-Host "Excluindo: $oldTag"
  & $gh release delete $oldTag --repo $repo --cleanup-tag --yes
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao excluir $oldTag. Remocao interrompida."
  }
  $removed++
}

Write-Host '[3/3] Conferindo resultado final...'
$after = @(& $gh release list --repo $repo --limit 200 --json tagName --jq '.[].tagName')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao conferir as Releases apos a limpeza.' }
$remaining = @($after | Where-Object { $_ -match '^painel-estq-[0-9]+$' })
if ($remaining.Count -gt 0) {
  throw ("Ainda restam Releases antigas: " + ($remaining -join ', '))
}
Write-Host "LIMPEZA CONCLUIDA: $removed Releases antigas removidas." -ForegroundColor Green
Write-Host 'GFARM_Instalador_Definitivo.exe foi preservado.'
)
})
$removed = 0
foreach ($oldTag in $legacy) {
  Write-Host "Excluindo: $oldTag"
  & $gh release delete $oldTag --repo $repo --cleanup-tag --yes
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao excluir $oldTag. Remocao interrompida."
  }
  $removed++
}

Write-Host '[3/3] Conferindo resultado final...'
$after = @(& $gh release list --repo $repo --limit 200 --json tagName --jq '.[].tagName')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao conferir as Releases apos a limpeza.' }
$remaining = @($after | Where-Object { $_ -match '^painel-estq-[0-9]+$' })
if ($remaining.Count -gt 0) {
  throw ("Ainda restam Releases antigas: " + ($remaining -join ', '))
}
Write-Host "LIMPEZA CONCLUIDA: $removed Releases antigas removidas." -ForegroundColor Green
Write-Host 'GFARM_Instalador_Definitivo.exe foi preservado.'
