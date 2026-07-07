$ErrorActionPreference = "Stop"

# 项目根目录：脚本放在根目录时，自动以脚本所在位置作为项目根。
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$studioDir = Join-Path $projectRoot "packages\studio"

if (-not (Test-Path -LiteralPath $studioDir)) {
    throw "未找到前端项目目录：$studioDir"
}

Set-Location $studioDir

# 第一版前端使用 pnpm。若依赖目录不存在，先自动安装一次，降低首次启动门槛。
if (-not (Test-Path -LiteralPath (Join-Path $studioDir "node_modules"))) {
    Write-Host "未检测到 node_modules，开始安装前端依赖..." -ForegroundColor Yellow
    pnpm install
}

Write-Host ""
Write-Host "Ink Agent Studio 前端即将启动：" -ForegroundColor Green
Write-Host "  http://127.0.0.1:5173/" -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:5173/models" -ForegroundColor Cyan
Write-Host ""

# 保持前台运行，方便用户直接看到 Vite 日志和错误信息。
pnpm run dev
