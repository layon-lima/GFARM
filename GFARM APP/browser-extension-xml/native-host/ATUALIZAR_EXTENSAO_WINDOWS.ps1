# GFARM - atualiza a extensao carregada sem compactacao (Windows PowerShell 5.1)
param([string]$ExtensionId = "")
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ($ExtensionId -and $ExtensionId -notmatch '^[a-p]{32}$') {
    throw "ID de extensao invalido."
}
$versao = "0.3.0"
$sha = "f8bcf0c9d55ef9636402724b5dd50eb09c2919e4"
$origem = "https://raw.githubusercontent.com/layon-lima/GFARM/$sha/GFARM%20APP/browser-extension-xml"
$arquivos = @("manifest.json", "background.js", "bridge.js", "fsist.js",
              "dfe-client.js", "dfe-sync.js", "dfe-sync.html", "README.md")
$stage = Join-Path $env:TEMP ("GFARM-EXT-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stage -Force | Out-Null

function EhGfarm([string]$folder) {
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) { return $false }
    $m = Join-Path $folder "manifest.json"
    if (-not (Test-Path -LiteralPath $m -PathType Leaf)) { return $false }
    try {
        $json = Get-Content -LiteralPath $m -Raw -Encoding UTF8 | ConvertFrom-Json
        return ($json.manifest_version -eq 3 -and ([string]$json.name -match "GFARM"))
    } catch { return $false }
}

function AcharPasta([string]$id) {
    $locais = @((Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data"),
                (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"))
    foreach ($base in $locais) {
        if (-not (Test-Path -LiteralPath $base -PathType Container)) { continue }
        $perfis = Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq "Default" -or $_.Name -match '^Profile \d+$' }
        foreach ($perfil in $perfis) {
            foreach ($arquivo in @("Preferences", "Secure Preferences")) {
                $p = Join-Path $perfil.FullName $arquivo
                if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { continue }
                try {
                    $prefs = Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json
                    $settings = $prefs.extensions.settings
                    if ($null -eq $settings) { continue }
                    foreach ($entry in $settings.PSObject.Properties) {
                        if ($id -and $entry.Name -ne $id) { continue }
                        $name = [string]$entry.Value.manifest.name
                        if ($name -notmatch "GFARM") { continue }
                        $folder = [string]$entry.Value.path
                        if (-not $folder) { continue }
                        if (-not [IO.Path]::IsPathRooted($folder)) { $folder = Join-Path $base $folder }
                        if (EhGfarm $folder) {
                            return (Resolve-Path -LiteralPath $folder).ProviderPath
                        }
                    }
                } catch { }
            }
        }
    }
    return $null
}

try {
    Write-Host "1/4 - Localizando extensao GFARM..."
    $pasta = AcharPasta $ExtensionId
    if (-not $pasta) {
        Add-Type -AssemblyName System.Windows.Forms
        $janela = New-Object System.Windows.Forms.FolderBrowserDialog
        $janela.Description = "Escolha a pasta original da extensao GFARM com o arquivo manifest.json"
        $janela.ShowNewFolderButton = $false
        if ($janela.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
            throw "Nenhuma pasta escolhida. Atualizacao cancelada."
        }
        $pasta = $janela.SelectedPath
    }
    if (-not (EhGfarm $pasta)) { throw "A pasta informada nao contem a extensao GFARM." }
    $antiga = Get-Content -LiteralPath (Join-Path $pasta "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host ("Versao encontrada: " + $antiga.version)
    Write-Host "2/4 - Baixando pacote oficial GFARM v$versao..."
    foreach ($nome in $arquivos) {
        $url = "$origem/$nome"
        $alvo = Join-Path $stage $nome
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $alvo
        if ((Get-Item -LiteralPath $alvo).Length -lt 15) { throw "Arquivo incompleto: $nome" }
    }
    $nova = Get-Content -LiteralPath (Join-Path $stage "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($nova.version -ne $versao -or [string]$nova.name -notmatch "GFARM" -or
        -not (@($nova.permissions) -contains "nativeMessaging")) {
        throw "Pacote recebido nao e o GFARM v$versao."
    }
    if ((Get-Content -LiteralPath (Join-Path $stage "background.js") -Raw) -notmatch "connectNative") {
        throw "Pacote baixado sem o suporte a certificados Windows."
    }
    Write-Host "3/4 - Fazendo backup antes de atualizar..."
    $backup = Join-Path (Join-Path $env:LOCALAPPDATA "GFARM") ("Backup-Extensao-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $originais = @{}
    foreach ($nome in $arquivos) {
        $atual = Join-Path $pasta $nome
        $originais[$nome] = Test-Path -LiteralPath $atual -PathType Leaf
        if ($originais[$nome]) {
            Copy-Item -LiteralPath $atual -Destination (Join-Path $backup $nome) -Force
        }
    }
    Write-Host "4/4 - Atualizando a mesma pasta (ID preservado)..."
    try {
        foreach ($nome in $arquivos) {
            Copy-Item -LiteralPath (Join-Path $stage $nome) -Destination (Join-Path $pasta $nome) -Force
        }
        $instalada = Get-Content -LiteralPath (Join-Path $pasta "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($instalada.version -ne $versao) { throw "A versao nao foi atualizada." }
    } catch {
        foreach ($nome in $arquivos) {
            $atual = Join-Path $pasta $nome
            if ($originais[$nome]) {
                Copy-Item -LiteralPath (Join-Path $backup $nome) -Destination $atual -Force
            } elseif (Test-Path -LiteralPath $atual -PathType Leaf) {
                Remove-Item -LiteralPath $atual -Force
            }
        }
        throw
    }
    Write-Host ""
    Write-Host "GFARM v$versao INSTALADO NA EXTENSAO!" -ForegroundColor Green
    Write-Host ("Pasta atualizada: " + $pasta)
    Write-Host ("Backup: " + $backup)
    Write-Host "Feche todas as janelas do Edge, reabra e use Ctrl+F5 no GFARM."
} finally {
    if (Test-Path -LiteralPath $stage -PathType Container) {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
