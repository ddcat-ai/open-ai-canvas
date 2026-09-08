[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $repoRoot "docker-compose.local.yml"

try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker CLI was not found."
    }
    $output = & docker compose --project-directory $repoRoot --project-name open-ai-canvas -f $composeFile down 2>&1
    $composeExitCode = $LASTEXITCODE
    foreach ($line in $output) { Write-Host $line }
    if ($composeExitCode -ne 0) { throw "Docker Compose failed to stop the services." }
    Write-Host "Yingce is stopped; the data volume was preserved." -ForegroundColor Green
} catch {
    Write-Host "Yingce failed to stop: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
