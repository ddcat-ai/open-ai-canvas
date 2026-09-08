[CmdletBinding()]
param(
    [switch]$NoBuild,
    [switch]$SkipBrowser
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $repoRoot "docker-compose.local.yml"
$composeProjectName = "open-ai-canvas"
$appUrl = "http://localhost:3000"

function Invoke-DockerDesktopStart {
    Write-Host "正在启动 Docker Desktop..." -ForegroundColor Yellow
    $output = & docker desktop start 2>&1
    if ($LASTEXITCODE -ne 0) {
        $details = ($output | Out-String).Trim()
        throw "Docker Desktop 启动失败。$details"
    }
}

function Test-DockerEngine {
    & docker info --format "{{.ServerVersion}}" *> $null
    return $LASTEXITCODE -eq 0
}

function Wait-DockerEngine([int]$TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not (Test-DockerEngine)) {
        if ([DateTime]::UtcNow -ge $deadline) {
            return $false
        }
        Start-Sleep -Seconds 2
    }
    return $true
}

function Invoke-Compose([string[]]$Arguments) {
    $outputLines = New-Object System.Collections.Generic.List[string]
    & docker compose @Arguments 2>&1 | ForEach-Object {
        $line = "$_"
        $outputLines.Add($line)
        Write-Host $line
    }

    if ($LASTEXITCODE -ne 0) {
        $details = ($outputLines | Select-Object -Last 30) -join [Environment]::NewLine
        throw "Docker Compose 执行失败。`n$details"
    }
}

function Wait-App([int]$TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
            # 服务刚启动时连接失败是正常现象，继续等待。
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "未找到 Docker CLI，请先安装 Docker Desktop。"
    }
    if (-not (Test-Path -LiteralPath $composeFile)) {
        throw "找不到本地 Compose 配置：$composeFile"
    }

    if (-not (Test-DockerEngine)) {
        Invoke-DockerDesktopStart
        if (-not (Wait-DockerEngine -TimeoutSeconds 180)) {
            throw "Docker Desktop 已尝试启动，但 Docker 引擎在 180 秒内仍不可用。请检查 Docker Desktop 界面。"
        }
    }

    Write-Host "Docker 引擎已就绪，正在启动影策..." -ForegroundColor Cyan
    $composeArguments = @(
        "--project-directory", $repoRoot,
        "--project-name", $composeProjectName,
        "-f", $composeFile,
        "up", "-d"
    )
    if (-not $NoBuild) {
        $composeArguments += "--build"
    }
    $composeArguments += "--wait"
    Invoke-Compose -Arguments $composeArguments

    if (-not (Wait-App -TimeoutSeconds 90)) {
        throw "容器已启动，但网页在 90 秒内没有响应。可以查看 Docker Desktop 中 open-ai-canvas 项目的日志。"
    }

    if (-not $SkipBrowser) {
        Start-Process $appUrl
    }
    Write-Host "影策已启动：$appUrl" -ForegroundColor Green
} catch {
    Write-Host "影策启动失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
