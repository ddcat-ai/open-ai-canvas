[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $repoRoot "docker-compose.local.yml"

try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "未找到 Docker CLI。"
    }
    & docker compose --project-directory $repoRoot --project-name open-ai-canvas -f $composeFile down
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose 停止服务失败。"
    }
    Write-Host "影策已停止；数据卷未删除。" -ForegroundColor Green
} catch {
    Write-Host "影策停止失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
