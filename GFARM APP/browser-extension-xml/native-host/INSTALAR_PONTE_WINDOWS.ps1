# Instalador GFARM v0.3 - execute no Windows PowerShell 5.1.
# Nao execute na VPS. Nao precisa de privilegios de administrador.
param([string]$ExtensionId = "")

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$nomeHost = "com.gfarm.certificados"
$destino = Join-Path $env:LOCALAPPDATA "GFARM\Certificados"
$fonte = Join-Path $destino "NativeHost.cs"
$exe = Join-Path $destino "GFARM-Certificados.exe"
$manifesto = Join-Path $destino "com.gfarm.certificados.json"
$origem = "https://raw.githubusercontent.com/layon-lima/GFARM/main/GFARM%20APP/browser-extension-xml/native-host/NativeHost.cs"

New-Item -ItemType Directory -Force -Path $destino | Out-Null
Write-Host "1/3 - Baixando fonte da ponte local..."
Invoke-WebRequest -UseBasicParsing -Uri $origem -OutFile $fonte

Write-Host "2/3 - Compilando a ponte Windows (.NET Framework)..."
if (Test-Path $exe) { Remove-Item -LiteralPath $exe -Force }
Add-Type -Path $fonte -OutputAssembly $exe -OutputType ConsoleApplication -ReferencedAssemblies @("System.Net.Http.dll", "System.Xml.dll", "System.Web.Extensions.dll", "System.Core.dll") -ErrorAction Stop
if (-not (Test-Path $exe)) { throw "A compilacao nao gerou o executavel." }

$ids = New-Object 'System.Collections.Generic.HashSet[string]'
if ($ExtensionId) {
    if ($ExtensionId -notmatch '^[a-p]{32}$') { throw "ID da extensao invalido." }
    [void]$ids.Add($ExtensionId)
}

$perfisBase = @(
    (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data")
)
foreach ($base in $perfisBase) {
    if (-not (Test-Path $base)) { continue }
    $perfis = Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "Default" -or $_.Name -match '^Profile \d+$' }
    foreach ($perfil in $perfis) {
        foreach ($nomeArquivo in @("Preferences", "Secure Preferences")) {
            $configPath = Join-Path $perfil.FullName $nomeArquivo
            if (-not (Test-Path $configPath)) { continue }
            try {
                $preferencias = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $settings = $preferencias.extensions.settings
                if ($null -eq $settings) { continue }
                foreach ($entrada in $settings.PSObject.Properties) {
                    $id = $entrada.Name
                    $nome = [string]$entrada.Value.manifest.name
                    if (($id -match '^[a-p]{32}$') -and ($nome -match 'GFARM.*(Captura|XML)')) {
                        [void]$ids.Add($id)
                    }
                }
            }
            catch {
                # Alguns perfis nao possuem esse campo. Tentar o proximo.
            }
        }
    }
}

if ($ids.Count -eq 0) {
    Write-Host "Nao localizei automaticamente a extensao GFARM." -ForegroundColor Yellow
    $id = (Read-Host "Cole somente o ID da extensao de edge://extensions").Trim()
    if ($id -notmatch '^[a-p]{32}$') { throw "ID da extensao invalido." }
    [void]$ids.Add($id)
}

$allowed = @($ids | ForEach-Object { "chrome-extension://$_/" })
$json = @{
    name = $nomeHost
    description = "GFARM: certificados Windows para TLS da SEFAZ"
    path = $exe
    type = "stdio"
    allowed_origins = $allowed
} | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($manifesto, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "3/3 - Registrando a ponte para Edge e Chrome..."
foreach ($browser in @("Microsoft\Edge", "Google\Chrome")) {
    $key = "HKCU:\Software\$browser\NativeMessagingHosts\$nomeHost"
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $manifesto
}
Write-Host ""
Write-Host "PONTE GFARM INSTALADA." -ForegroundColor Green
Write-Host "Certificados nao foram exportados."
Write-Host "Extensoes autorizadas: $($ids.Count)"
Write-Host "Feche todas as janelas do Edge/Chrome e abra novamente."
