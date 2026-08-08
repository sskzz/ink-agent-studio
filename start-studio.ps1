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

# ---------------------------------------------------------------------------
# Stale process detection: a leftover backend/Vite process would keep serving
# OLD code (e.g. the 90s timeout before the streaming fixes), making recent
# changes invisible. Check the ports before installing dependencies so the
# user is not kept waiting, and offer to stop the stale process.
# ---------------------------------------------------------------------------
$backendPort = 8787
$studioPort = 5173

function Get-ListeningProcessId([int]$Port) {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $connection) { return $null }
    return $connection.OwningProcess
}

function Get-ProcessLabel([int]$ProcessId) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) { return "PID $ProcessId" }
    return "$($process.ProcessName) (PID $ProcessId)"
}

function Ensure-PortFree([int]$Port, [string]$ServiceName) {
    $processId = Get-ListeningProcessId $Port
    if (-not $processId) { return }
    Write-Host ""
    Write-Host "WARNING: Port $Port ($ServiceName) is already in use by $(Get-ProcessLabel $processId)." -ForegroundColor Yellow
    Write-Host "A stale $ServiceName keeps serving OLD code, which makes recent fixes invisible." -ForegroundColor Yellow
    $answer = Read-Host "Stop this process and start fresh? (y/N)"
    if ($answer -ne "y" -and $answer -ne "Y") {
        Write-Host "Continuing anyway; close the old console window manually if it keeps serving old code." -ForegroundColor DarkGray
        return
    }
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 1500
    $remaining = Get-ListeningProcessId $Port
    if ($remaining) {
        Write-Host "Port $Port is still occupied by $(Get-ProcessLabel $remaining)." -ForegroundColor Red
        Write-Host "The stale process respawned (tsx watch). Please close its old console window manually, then re-run this script." -ForegroundColor Red
        exit 1
    }
    Write-Host "Stopped the stale process; port $Port is free now." -ForegroundColor Green
}

Ensure-PortFree $backendPort "backend"
Ensure-PortFree $studioPort "Studio (Vite)"

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
