param(
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

# Keep this script ASCII-only for Windows PowerShell compatibility.
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$studioDir = Join-Path $projectRoot "packages\studio"
$backendDir = Join-Path $projectRoot "backend"
$backendUrl = "http://127.0.0.1:8787/api/v1/health"
$backendLog = Join-Path $backendDir "backend-dev.log"
$backendStartScript = Join-Path $backendDir "start-backend.ps1"
$workspaceNodeModules = Join-Path $projectRoot "node_modules"

if (-not (Test-Path -LiteralPath $studioDir)) {
    throw "Studio directory not found: $studioDir"
}

if (-not (Test-Path -LiteralPath $backendDir)) {
    throw "Backend directory not found: $backendDir"
}

if (-not (Test-Path -LiteralPath $backendStartScript)) {
    throw "Backend start script not found: $backendStartScript"
}

if ($CheckOnly) {
    Write-Host "Start script syntax ok." -ForegroundColor Green
    exit 0
}

function Test-BackendAlive {
    try {
        $response = Invoke-RestMethod -Uri $backendUrl -TimeoutSec 2
        return $null -ne $response -and $response.code -eq 0
    }
    catch {
        return $false
    }
}

$hasWorkspaceDependencies = Test-Path -LiteralPath $workspaceNodeModules
if (-not $hasWorkspaceDependencies) {
    Write-Host "Workspace node_modules not found. Installing dependencies..." -ForegroundColor Yellow
    Set-Location $projectRoot
    pnpm install
}

$backendAlive = Test-BackendAlive
if ($backendAlive) {
    Write-Host "Backend is already running." -ForegroundColor Green
}
else {
    Write-Host "Starting Ink Agent Studio backend in background..." -ForegroundColor Yellow
    Write-Host "  Backend log: $backendLog" -ForegroundColor DarkGray

    Start-Process `
        -FilePath "powershell" `
        -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            $backendStartScript
        ) `
        -WindowStyle Hidden

    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "Ink Agent Studio is starting:" -ForegroundColor Green
Write-Host "  http://127.0.0.1:5173/" -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:5173/models" -ForegroundColor Cyan
Write-Host "  Backend health: $backendUrl" -ForegroundColor Cyan
Write-Host ""

Set-Location $studioDir
pnpm run dev
