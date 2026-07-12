param(
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

# Keep this script ASCII-only for Windows PowerShell compatibility.
$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendLog = Join-Path $backendDir "backend-dev.log"

if ($CheckOnly) {
    Write-Host "Backend start script syntax ok." -ForegroundColor Green
    exit 0
}

Set-Location $backendDir

# The root start script keeps Vite logs in the foreground. Backend logs are written to a file.
pnpm run dev *> $backendLog
