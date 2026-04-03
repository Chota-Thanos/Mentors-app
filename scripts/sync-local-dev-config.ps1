param(
    [string]$BackendHost,
    [int]$BackendPort = 8002,
    [int]$WebPort = 3000
)

function Get-PreferredIPv4Address {
    $preferredConfig = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object { $_.IPv4Address -and $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } |
        Select-Object -First 1

    if ($preferredConfig) {
        return $preferredConfig.IPv4Address.IPAddress
    }

    $fallbackAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notmatch "^169\\.254\\." -and
            $_.IPAddress -ne "127.0.0.1"
        } |
        Select-Object -First 1 -ExpandProperty IPAddress

    return $fallbackAddress
}

if ([string]::IsNullOrWhiteSpace($BackendHost)) {
    $BackendHost = Get-PreferredIPv4Address
}

if ([string]::IsNullOrWhiteSpace($BackendHost)) {
    $BackendHost = "localhost"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$mobileEnvPath = Join-Path $repoRoot "supa_mobile\.env"
$frontendEnvPath = Join-Path $repoRoot "supa_frontend\.env.local"

$backendRoot = "http://$BackendHost`:$BackendPort"
$backendApiV1 = "$backendRoot/api/v1"
$webRoot = "http://$BackendHost`:$WebPort"

function Set-EnvValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Missing env file: $Path"
    }

    $content = Get-Content -LiteralPath $Path -Raw
    $escapedKey = [regex]::Escape($Key)
    $pattern = "(?m)^$escapedKey=.*$"

    if ([regex]::IsMatch($content, $pattern)) {
        $content = [regex]::Replace($content, $pattern, "$Key=$Value")
    } else {
        if ($content.Length -gt 0 -and -not $content.EndsWith("`r`n") -and -not $content.EndsWith("`n")) {
            $content += [Environment]::NewLine
        }
        $content += "$Key=$Value" + [Environment]::NewLine
    }

    Set-Content -LiteralPath $Path -Value $content
}

Set-EnvValue -Path $mobileEnvPath -Key "EXPO_PUBLIC_API_URL" -Value $backendRoot
Set-EnvValue -Path $mobileEnvPath -Key "EXPO_PUBLIC_WEB_APP_URL" -Value $webRoot

Set-EnvValue -Path $frontendEnvPath -Key "NEXT_PUBLIC_SUPA_BACKEND_URL" -Value $backendRoot
Set-EnvValue -Path $frontendEnvPath -Key "NEXT_PUBLIC_API_URL" -Value $backendApiV1

Write-Host "Synchronized local client config:" -ForegroundColor Green
Write-Host "  Detected host:   $BackendHost"
Write-Host "  Mobile backend: $backendRoot"
Write-Host "  Web backend:    $backendRoot"
Write-Host "  Web app URL:    $webRoot"
