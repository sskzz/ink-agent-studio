param(
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

# Keep this script ASCII-only for Windows PowerShell compatibility.
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$studioDir = Join-Path $projectRoot "packages\studio"
$backendDir = Join-Path $projectRoot "backend"
$backendUrl = "http://127.0.0.1:8787/api/v1/health"
$workspaceNodeModules = Join-Path $projectRoot "node_modules"

if (-not (Test-Path -LiteralPath $studioDir)) {
    throw "Studio directory not found: $studioDir"
}

if (-not (Test-Path -LiteralPath $backendDir)) {
    throw "Backend directory not found: $backendDir"
}

if ($CheckOnly) {
    Write-Host "Start script syntax ok." -ForegroundColor Green
    exit 0
}

$hasWorkspaceDependencies = Test-Path -LiteralPath $workspaceNodeModules
if (-not $hasWorkspaceDependencies) {
    Write-Host "Workspace node_modules not found. Installing dependencies..." -ForegroundColor Yellow
    Set-Location $projectRoot
    pnpm install
}

Write-Host ""
Write-Host "Ink Agent Studio frontend and backend are starting together:" -ForegroundColor Green
Write-Host "  http://127.0.0.1:5173/" -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:5173/models" -ForegroundColor Cyan
Write-Host "  Backend health: $backendUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "Close this window or press Ctrl+C to stop both processes." -ForegroundColor DarkGray
Write-Host ""

Set-Location $projectRoot
pnpm --parallel --stream `
    --filter "@ink-agent/backend" `
    --filter "@ink-agent/studio" `
    run dev
