# Habilita SSH restrito à rede privada Tailscale. Executar UMA VEZ no servidor.
# Não altera FastAPI, banco, Cloudflare, usuários do ERP nem portas do estoque.
param(
    [Parameter(Mandatory=$true)][string]$Projeto,
    [Parameter(Mandatory=$true)][string]$PublicKey
)
$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute PAINEL_ESTQ.exe como Administrador SOMENTE para habilitar acesso remoto."
}
if (-not (Test-Path (Join-Path $Projeto "ops\REMOTO_COMANDO.ps1")) -and -not (Test-Path (Join-Path $Projeto "ops\windows\REMOTO_COMANDO.ps1"))) {
    throw "O comando remoto seguro não foi baixado do GitHub."
}
if (-not (Test-Path (Join-Path $Projeto "ops\remote_update.py"))) {
    throw "Atualize o repositório GitHub do servidor antes de autorizar o acesso remoto."
}
if (-not (Test-Path (Join-Path $Projeto "backend\.env"))) {
    throw "Esta pasta não corresponde ao servidor atual configurado."
}
$PublicKey = $PublicKey.Trim()
if ($PublicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+(?: [A-Za-z0-9._@ -]{0,120})?$') {
    throw "Chave inválida: aceite somente uma chave pública SSH ed25519."
}

$tail = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if (-not $tail) {
    $p = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
    if (Test-Path $p) { $tail = Get-Item $p }
}
if (-not $tail) {
    throw "Tailscale não instalado. Instale e autentique o computador servidor antes."
}
$tailPath = if ($tail -is [System.Management.Automation.ApplicationInfo]) { $tail.Source } else { $tail.FullName }
$ipResult = @(& $tailPath ip -4 2>$null)
$ip = [string]($ipResult | Select-Object -First 1)
$ip = $ip.Trim()
try {
    $octets = $ip.Split(".")
    $first = [int]$octets[0]
    $second = [int]$octets[1]
    if ($first -ne 100 -or $second -lt 64 -or $second -gt 127) { throw "Endereço fora do tailnet" }
} catch { throw "Tailscale não está conectado. Abra o Tailscale e faça login antes de continuar." }

$cap = Get-WindowsCapability -Online -Name "OpenSSH.Server~~~~0.0.1.0"
if ($cap.State -ne "Installed") {
    Add-WindowsCapability -Online -Name "OpenSSH.Server~~~~0.0.1.0" | Out-Null
}
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd

# A regra padrão do Windows não pode permanecer aberta a toda a Internet.
$defaultRule = Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue
if ($defaultRule) {
    $defaultRule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress "100.64.0.0/10"
} else {
    $mine = Get-NetFirewallRule -Name "ESTQ-SSH-Tailnet" -ErrorAction SilentlyContinue
    if (-not $mine) {
        New-NetFirewallRule -Name "ESTQ-SSH-Tailnet" -DisplayName "ESTQ SSH (somente Tailscale)" -Enabled True -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -RemoteAddress "100.64.0.0/10" | Out-Null
    }
}
# Para conta administradora, Windows OpenSSH exige este arquivo especial.
$authorized = Join-Path $env:ProgramData "ssh\administrators_authorized_keys"
$directory = Split-Path $authorized
New-Item -Path $directory -ItemType Directory -Force | Out-Null
if (-not (Test-Path $authorized)) {
    New-Item -Path $authorized -ItemType File -Force | Out-Null
}
# A chave deste painel só autoriza DUAS ações fixas: "status" e "update".
# EncodedCommand evita aspas especiais/caminhos com espaços nas opções do sshd.
$helper = Join-Path $Projeto "ops\windows\REMOTO_COMANDO.ps1"
$p = $Projeto.Replace("'", "''")
$h = $helper.Replace("'", "''")
$command = "& '$h' -Projeto '$p'"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$entry = 'restrict,command="powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + $encoded + '" ' + $PublicKey
$keyBody = ($PublicKey -split ' ')[1]
$lines = @(Get-Content -Path $authorized -ErrorAction SilentlyContinue | Where-Object {
    $_ -notmatch ('ssh-ed25519\s+' + [Regex]::Escape($keyBody) + '(\s|$)')
})
$lines += $entry
Set-Content -Path $authorized -Value $lines -Encoding ascii
& icacls.exe $authorized /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Não foi possível proteger as permissões das chaves SSH." }
$hostpub = Join-Path $env:ProgramData "ssh\ssh_host_ed25519_key.pub"
if (-not (Test-Path $hostpub)) { throw "Host key SSH não foi gerada. Verifique o serviço sshd." }
$fingerprint = (& ssh-keygen.exe -lf $hostpub -E sha256)
Write-Host ("SERVIDOR_TAILSCALE_IP: " + $ip)
Write-Host ("SERVIDOR_WINDOWS_USER: " + $env:USERNAME)
Write-Host ("SERVIDOR_PROJETO: " + (Resolve-Path $Projeto).Path)
Write-Host ("FINGERPRINT_HOST: " + $fingerprint)
Write-Host "A chave pública foi autorizada. Faça o pareamento por fingerprint no painel do seu PC."
