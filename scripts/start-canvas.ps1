[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$localStarter = Join-Path $PSScriptRoot "start-local.ps1"
$healthUrl = "http://127.0.0.1:3000/api/health"
$canvasUrl = "http://localhost:3000/canvas"

function Test-CanvasHttp([string]$Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    } catch {
        return $false
    }
}

function Test-ListeningPort([int]$Port) {
    try {
        return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1)
    } catch {
        return $false
    }
}

if (Test-CanvasHttp $healthUrl) {
    Write-Host "影策画布已经在运行，正在打开..." -ForegroundColor Green
    Start-Process $canvasUrl
    exit 0
}

$occupiedPorts = @(3000, 8080) | Where-Object { Test-ListeningPort $_ }
if ($occupiedPorts.Count -gt 0) {
    throw "端口 $($occupiedPorts -join ', ') 已被其他程序占用，无法安全启动影策。"
}

if (-not (Test-Path -LiteralPath $localStarter)) {
    throw "未找到项目启动脚本：$localStarter"
}

Write-Host "正在启动影策前端和后端，请稍候..." -ForegroundColor Cyan
& $localStarter

$deadline = (Get-Date).AddMinutes(3)
do {
    Start-Sleep -Seconds 2
    if (Test-CanvasHttp $healthUrl) {
        Write-Host "影策画布已启动，正在打开浏览器..." -ForegroundColor Green
        Start-Process $canvasUrl
        exit 0
    }
} while ((Get-Date) -lt $deadline)

throw "影策服务已拉起，但 3 分钟内未通过健康检查。请查看打开的前端、后端窗口。"
