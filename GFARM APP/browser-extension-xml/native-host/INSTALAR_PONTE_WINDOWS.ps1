# Instalacao em Windows PowerShell 5.1; nao requer administrador.
param([string]$ExtensionId = "")
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$nomeHost = "com.gfarm.certificados"
$destino = Join-Path $env:LOCALAPPDATA "GFARM\Certificados"
New-Item -ItemType Directory -Force -Path $destino | Out-Null
$fonte = Join-Path $destino "NativeHost.cs"
$exe = Join-Path $destino "GFARM-Certificados.exe"
$origem = "https://raw.githubusercontent.com/layon-lima/GFARM/main/GFARM%20APP/browser-extension-xml/native-host/NativeHost.cs"
Write-Host "Baixando fonte da ponte de certificados..."
Invoke-WebRequest -UseBasicParsing -Uri $origem -OutFile $fonte
Write-Host "Compilando ponte local do Windows (.NET Framework)..."
if (Test-Path $exe) { Remove-Item $exe -Force }
Add-Type -Path $fonte -OutputAssembly $exe -OutputType ConsoleApplication -ReferencedAssemblies @("System.Net.Http.dll", "System.Xml.dll", "System.Web.Extensions.dll") -ErrorAction Stop
if (-not (Test-Path $exe)) { throw "Falha na compilacao da ponte." }
$ids = New-Object 'System.Collections.Generic.HashSet[string]'
if ($ExtensionId) {
    if ($ExtensionId -notmatch '^[a-p]{32}$') { throw "ID da extensao invalido." }
    [void]$ids.Add($ExtensionId)
}
$bases = @((Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data"), (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"))
foreach ($base in $bases) {
    if (-not (Test-Path $base)) { continue }
    $perfis = Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq "Default" -or $_.Name -match '^Profile \d+$' }
    foreach ($perfil in $perfis) {
        $prefs = Join-Path $perfil.FullName "Preferences"
        if (-not (Test-Path $prefs)) { continue }
        try {
            $json = Get-Content -Raw -Encoding UTF8 $prefs | ConvertFrom-Json
            $config = $json.extensions.settings
            foreach ($entry in $config.PSObject.Properties) {
                $id = $entry.Name
                $nome = [string]$entry.Value.manifest.name
                if ($id -match '^[a-p]{32}$' -and $nome -match 'GFARM.*(Captura|XML)') { [void]$ids.Add($id) }
            }
        } catch {
            Write-Host "Aviso: nao foi possivel ler perfil $($perfil.Name)." -ForegroundColor Yellow
        }
    }
}
if ($ids.Count -eq 0) {
    Write-Host "Nao foi possivel detectar o ID da extensao automaticamente." -ForegroundColor Yellow
    $id = (Read-Host "Cole o ID da extensao GFARM mostrado em edge://extensions").Trim()
    if ($id -notmatch '^[a-p]{32}$') { throw "ID da extensao invalido." }
    [void]$ids.Add($id)
}
$manifesto = Join-Path $destino "com.gfarm.certificados.json"
$data = @{
    name = $nomeHost
    description = "GFARM: usa certificados do Windows para TLS na SEFAZ"
    path = $exe
    type = "stdio"
    allowed_origins = @($ids | ForEach-Object { "chrome-extension://$_/" })
} | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($manifesto, $data, (New-Object System.Text.UTF8Encoding($false)))
foreach ($browser in @("Microsoft\Edge", "Google\Chrome")) {
    $reg = "HKCU:\Software\$browser\NativeMessagingHosts\$nomeHost"
    New-Item -Path $reg -Force | Out-Null
    Set-Item -Path $reg -Value $manifesto
}
Write-Host ""
Write-Host "PONTE GFARM INSTALADA!" -ForegroundColor Green
Write-Host "Nenhuma chave privada foi exportada."
Write-Host "Extensoes autorizadas: $($ids.Count)"
Write-Host "Feche e abra o Edge/Chrome e clique em Sincronizar XML no GFARM."
