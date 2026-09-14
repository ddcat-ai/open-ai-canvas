[CmdletBinding()]
param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "windows-proxy.ps1")
Import-CanvasWindowsProxy

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendDir = Join-Path $repoRoot "backend"
$webDir = Join-Path $repoRoot "web"
$agentDir = Join-Path $repoRoot "canvas-agent"
$localDir = Join-Path $repoRoot ".local"
$dataDir = Join-Path $localDir "project-workbench-debug"
$runDir = Join-Path $localDir "run"
$goBuildCache = Join-Path $localDir "cache\go-build"
$goModuleCache = Join-Path $localDir "cache\go-mod"
$cloudflaredConfig = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
$cloudflaredExe = (Get-Command cloudflared.exe -ErrorAction SilentlyContinue).Source
if (-not $cloudflaredExe -and (Test-Path -LiteralPath "C:\Program Files (x86)\cloudflared\cloudflared.exe")) {
    $cloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
}

foreach ($directory in @($dataDir, $runDir, $goBuildCache, $goModuleCache)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

function Test-ListeningPort([int]$Port) {
    try {
        return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1)
    } catch {
        return $false
    }
}

function Wait-BackendReady {
    $deadline = (Get-Date).AddMinutes(3)
    do {
        try {
            $response = Invoke-RestMethod "http://127.0.0.1:8080/api/health" -TimeoutSec 3
            if ($response.code -eq 0 -and $response.data.ready -eq $true) { return }
        } catch { }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Backend is not ready. See $localDir\run\backend.stderr.log"
}

function Wait-FrontendReady {
    $deadline = (Get-Date).AddMinutes(2)
    do {
        try {
            $response = Invoke-RestMethod "http://127.0.0.1:3000/api/health" -TimeoutSec 3
            if ($response.code -eq 0 -and $response.data.ready -eq $true) {
                $null = Invoke-WebRequest "http://127.0.0.1:3000/canvas" -UseBasicParsing -TimeoutSec 10
                return
            }
        } catch { }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Frontend is not ready. See $localDir\run\web.stderr.log"
}

function Wait-AgentReady {
    $deadline = (Get-Date).AddMinutes(2)
    do {
        try {
            $response = Invoke-RestMethod "http://127.0.0.1:17371/health" -TimeoutSec 3
            if ($response.ok -eq $true -or $response.status -eq "ok") { return }
        } catch { }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Canvas Agent is not ready. See $localDir\run\agent.stderr.log"
}

function Test-CloudflaredRunning {
    if (-not $cloudflaredConfig) { return $false }
    $escapedConfig = [regex]::Escape($cloudflaredConfig)
    return $null -ne (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "cloudflared.exe" -and $_.CommandLine -match $escapedConfig } |
        Select-Object -First 1)
}

function Wait-PublicEndpoint {
    $publicHealth = "https://canvas.yingce.cc.cd/api/health"
    $deadline = (Get-Date).AddMinutes(2)
    do {
        try {
            $response = Invoke-RestMethod $publicHealth -TimeoutSec 8
            if ($response.code -eq 0 -and $response.data.ready -eq $true) { return }
        } catch { }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    throw "公网访问地址未就绪：$publicHealth；请查看 $runDir\cloudflared.stderr.log"
}

if (-not (Test-ListeningPort 8080)) {
    Write-Host "Starting backend..." -ForegroundColor Cyan
    $env:CANVAS_BACKEND_ADDR = "127.0.0.1:8080"
    $env:CANVAS_BACKEND_DATA_DIR = $dataDir
    $env:CANVAS_PUBLIC_BASE_URL = "https://canvas.yingce.cc.cd"
    $env:GOCACHE = $goBuildCache
    $env:GOMODCACHE = $goModuleCache
    Start-Process -WindowStyle Hidden -FilePath "go.exe" `
        -ArgumentList @("run", "./cmd/server") `
        -WorkingDirectory $backendDir `
        -RedirectStandardOutput (Join-Path $runDir "backend.stdout.log") `
        -RedirectStandardError (Join-Path $runDir "backend.stderr.log") | Out-Null
}
Wait-BackendReady

if (-not (Test-ListeningPort 3000)) {
    Write-Host "Starting frontend..." -ForegroundColor Cyan
    $vite = Join-Path $webDir "node_modules\vite\bin\vite.js"
    if (-not (Test-Path -LiteralPath $vite)) {
        throw "Frontend dependencies are missing. Run bun install --frozen-lockfile in web."
    }
    $env:VITE_API_PROXY_TARGET = "http://127.0.0.1:8080"
    Start-Process -WindowStyle Hidden -FilePath "node.exe" `
        -ArgumentList @($vite, "--host", "127.0.0.1", "--port", "3000", "--strictPort") `
        -WorkingDirectory $webDir `
        -RedirectStandardOutput (Join-Path $runDir "web.stdout.log") `
        -RedirectStandardError (Join-Path $runDir "web.stderr.log") | Out-Null
}
Wait-FrontendReady

$agentDist = Join-Path $agentDir "dist\index.js"
if (-not (Test-ListeningPort 17371)) {
    Write-Host "Starting Canvas Agent..." -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $agentDist)) {
        throw "Canvas Agent is not built. Run bun run build in canvas-agent."
    }
    $env:CANVAS_PROJECT_ROOT = $repoRoot
    Start-Process -WindowStyle Hidden -FilePath "node.exe" `
        -ArgumentList @($agentDist) `
        -WorkingDirectory $agentDir `
        -RedirectStandardOutput (Join-Path $runDir "agent.stdout.log") `
        -RedirectStandardError (Join-Path $runDir "agent.stderr.log") | Out-Null
}
Wait-AgentReady

if ($cloudflaredExe -and (Test-Path -LiteralPath $cloudflaredConfig) -and -not (Test-CloudflaredRunning)) {
    Write-Host "Starting Cloudflare Tunnel..." -ForegroundColor Cyan
    Start-Process -WindowStyle Hidden -FilePath $cloudflaredExe `
        -ArgumentList @("--config", $cloudflaredConfig, "tunnel", "run") `
        -WorkingDirectory (Split-Path -Parent $cloudflaredConfig) `
        -RedirectStandardOutput (Join-Path $runDir "cloudflared.stdout.log") `
        -RedirectStandardError (Join-Path $runDir "cloudflared.stderr.log") | Out-Null
}
if ($cloudflaredExe -and (Test-Path -LiteralPath $cloudflaredConfig)) {
    Wait-PublicEndpoint
}

Write-Host "Canvas ready: http://localhost:3000/canvas" -ForegroundColor Green
Write-Host "Canvas Agent: http://127.0.0.1:17371" -ForegroundColor Green
if ($cloudflaredExe -and (Test-Path -LiteralPath $cloudflaredConfig)) {
    Write-Host "Public media URL: https://canvas.yingce.cc.cd" -ForegroundColor Green
}
if (-not $NoBrowser) {
    Start-Process "http://localhost:3000/canvas"
}
