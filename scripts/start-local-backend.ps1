param(
    [string]$BindHost = "0.0.0.0",
    [int]$Port = 8002
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $repoRoot "supa_back"

function Test-BackendHealth {
    param(
        [int]$TargetPort
    )

    try {
        $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$TargetPort/" -TimeoutSec 3
        return $response.Content
    } catch {
        return $null
    }
}

$existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1

if ($existingListener) {
    $health = Test-BackendHealth -TargetPort $Port
    Write-Host "Port $Port is already in use by PID $($existingListener.OwningProcess)." -ForegroundColor Yellow

    if ($health) {
        Write-Host "Backend is already responding on http://127.0.0.1:$Port/" -ForegroundColor Green
        Write-Host $health
        exit 0
    }

    Write-Host "Another process is listening on port $Port. Stop it or choose a different port." -ForegroundColor Red
    exit 1
}

Set-Location $backendRoot
Write-Host "Starting backend on http://$BindHost`:$Port" -ForegroundColor Green
python -m uvicorn backend.app.main:app --host $BindHost --port $Port --reload
