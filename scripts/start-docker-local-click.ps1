[CmdletBinding()]
param(
    [switch]$NoBuild,
    [switch]$SkipBrowser
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $repoRoot "docker-compose.local.yml"
$appUrl = "http://localhost:3000"
$projectName = "open-ai-canvas"

function Test-DockerEngine {
    & docker info --format "{{.ServerVersion}}" *> $null
    return $LASTEXITCODE -eq 0
}

function Wait-DockerEngine([int]$TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not (Test-DockerEngine)) {
        if ([DateTime]::UtcNow -ge $deadline) { return $false }
        Start-Sleep -Seconds 2
    }
    return $true
}

function Invoke-Compose([string[]]$Arguments) {
    $output = & docker compose @Arguments 2>&1
    $composeExitCode = $LASTEXITCODE
    foreach ($line in $output) { Write-Host $line }
    if ($composeExitCode -ne 0) {
        $details = ($output | Select-Object -Last 30) -join [Environment]::NewLine
        throw "Docker Compose failed.`n$details"
    }
}

function Wait-WebApp([int]$TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
        } catch { }
        Start-Sleep -Seconds 2
    }
    return $false
}

try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker CLI was not found. Install Docker Desktop first."
    }
    if (-not (Test-Path -LiteralPath $composeFile)) {
        throw "Compose file was not found: $composeFile"
    }

    if (-not (Test-DockerEngine)) {
        Write-Host "Starting Docker Desktop..." -ForegroundColor Yellow
        $dockerPath = (Get-Command docker).Source
        Start-Process -FilePath $dockerPath -ArgumentList @("desktop", "start") -WindowStyle Hidden | Out-Null
        if (-not (Wait-DockerEngine -TimeoutSeconds 180)) {
            throw "Docker engine did not become ready within 180 seconds."
        }
    }

    Write-Host "Starting the local Yingce services..." -ForegroundColor Cyan
    $composeArgs = @(
        "--project-directory", $repoRoot,
        "--project-name", $projectName,
        "-f", $composeFile,
        "up", "-d"
    )
    if (-not $NoBuild) { $composeArgs += "--build" }
    $composeArgs += "--wait"
    Invoke-Compose -Arguments $composeArgs

    if (-not (Wait-WebApp -TimeoutSeconds 90)) {
        throw "The web app did not respond within 90 seconds. Check Docker Desktop logs."
    }
    if (-not $SkipBrowser) { Start-Process $appUrl }
    Write-Host "Yingce is ready at $appUrl" -ForegroundColor Green
} catch {
    Write-Host "Yingce failed to start: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
