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
# Stale process detection: a leftover backend/Vite process keeps serving OLD
# code, and its workspace lease (data/workspaces/*/index/workspace.lock) blocks
# a fresh backend from starting ("工作区已被另一个后端进程占用"). A duplicate
# `pnpm dev` session typically leaves tsx watch + its backend child behind.
# Killing only the child makes the watcher respawn it, so we kill the whole
# session tree (up to pnpm), never the user's own console/shell.
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

# True when the command line points into this project's backend (tsx watch / node src/index.ts).
function Test-BackendProcess([int]$ProcessId) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if (-not $process -or -not $process.CommandLine) { return $false }
    return $process.CommandLine -match [regex]::Escape($backendDir) -and $process.CommandLine -match "tsx|index\.ts"
}

# True when the command line is this project's Vite dev server.
function Test-StudioProcess([int]$ProcessId) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if (-not $process -or -not $process.CommandLine) { return $false }
    return $process.CommandLine -match [regex]::Escape($studioDir) -and $process.CommandLine -match "vite"
}

# Ancestors that belong to the user's own shell/console must never be killed.
$shellNames = @("cmd.exe", "conhost.exe", "powershell.exe", "pwsh.exe", "explorer.exe", "WindowsTerminal.exe", "OpenConsole.exe", "Code.exe")

# Walk up the process tree and return the pid of the session root (e.g. pnpm).
function Get-ProcessTreeRoot([int]$ProcessId) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if (-not $current) { return $null }
    $guard = 0
    while ($current.ParentProcessId -and $current.ParentProcessId -ne 0 -and $guard -lt 20) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($current.ParentProcessId)" -ErrorAction SilentlyContinue
        if (-not $parent) { break }
        if ($parent.Name -in $shellNames) { break }
        $current = $parent
        $guard += 1
    }
    return $current.ProcessId
}

# Kill a process and its whole subtree, tolerating an already-dead target.
function Stop-ProcessTree([int]$ProcessId) {
    taskkill /PID $ProcessId /T /F 2>&1 | Out-Null
    Start-Sleep -Milliseconds 300
}

# PID recorded in the workspace lease file, if any.
function Get-WorkspaceLockOwnerPid {
    $lockFiles = Get-ChildItem -LiteralPath (Join-Path $projectRoot "data\workspaces") -Filter "workspace.lock" -Recurse -ErrorAction SilentlyContinue
    foreach ($lockFile in $lockFiles) {
        try {
            $record = Get-Content -Raw -LiteralPath $lockFile.FullName | ConvertFrom-Json
            if ($record -and $record.pid) { return [int]$record.pid }
        } catch { }
    }
    return $null
}

# Stop every stale process of ours that would block the backend port or lease.
function Ensure-BackendFree {
    $candidates = @()
    $portPid = Get-ListeningProcessId $backendPort
    if ($portPid) { $candidates += $portPid }
    $lockPid = Get-WorkspaceLockOwnerPid
    if ($lockPid -and $candidates -notcontains $lockPid) { $candidates += $lockPid }

    $ours = @($candidates | Where-Object { Test-BackendProcess $_ })
    $foreign = @($candidates | Where-Object { -not (Test-BackendProcess $_) })

    if ($ours.Count -gt 0) {
        Write-Host ""
        Write-Host "Stale Ink Agent Backend detected (it would block the workspace lease and serve old code):" -ForegroundColor Yellow
        foreach ($processId in $ours) {
            Write-Host "  $(Get-ProcessLabel $processId)" -ForegroundColor Yellow
        }
        Write-Host "Stopping it together with its watcher/session..." -ForegroundColor Yellow
        foreach ($processId in $ours) {
            $root = Get-ProcessTreeRoot $processId
            if ($root) { Stop-ProcessTree $root }
        }
        Start-Sleep -Milliseconds 1500
    }

    foreach ($processId in $foreign) {
        Write-Host ""
        Write-Host "WARNING: Port $backendPort (backend) is already in use by $(Get-ProcessLabel $processId), which does not look like this project's backend." -ForegroundColor Yellow
        $answer = Read-Host "Stop this process and start fresh? (y/N)"
        if ($answer -eq "y" -or $answer -eq "Y") {
            $root = Get-ProcessTreeRoot $processId
            if ($root) { Stop-ProcessTree $root }
            Start-Sleep -Milliseconds 1500
        } else {
            Write-Host "Continuing anyway; the backend may fail to start on that port." -ForegroundColor DarkGray
        }
    }

    $remaining = Get-ListeningProcessId $backendPort
    if ($remaining) {
        Write-Host "Port $backendPort is still occupied by $(Get-ProcessLabel $remaining); close its console manually and re-run this script." -ForegroundColor Red
        exit 1
    }
}

# Stop a stale Studio (Vite) dev server; only ask when the port is held by a foreign process.
function Ensure-StudioFree {
    $processId = Get-ListeningProcessId $studioPort
    if (-not $processId) { return }

    if (Test-StudioProcess $processId) {
        Write-Host ""
        Write-Host "Stale Studio (Vite) dev server detected on port $studioPort (serving old code); stopping it..." -ForegroundColor Yellow
        $root = Get-ProcessTreeRoot $processId
        if ($root) { Stop-ProcessTree $root }
        Start-Sleep -Milliseconds 1500
        return
    }

    Write-Host ""
    Write-Host "WARNING: Port $studioPort (Studio) is already in use by $(Get-ProcessLabel $processId), which does not look like this project's Vite." -ForegroundColor Yellow
    $answer = Read-Host "Stop this process and start fresh? (y/N)"
    if ($answer -eq "y" -or $answer -eq "Y") {
        $root = Get-ProcessTreeRoot $processId
        if ($root) { Stop-ProcessTree $root }
        Start-Sleep -Milliseconds 1500
    } else {
        Write-Host "Continuing anyway; close the old console window manually if it keeps serving old code." -ForegroundColor DarkGray
    }
}

Ensure-BackendFree
Ensure-StudioFree

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
