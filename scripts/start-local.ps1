[CmdletBinding()]
param([switch]$SkipBrowser)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendDir = Join-Path $repoRoot "backend"
$webDir = Join-Path $repoRoot "web"
$canvasAgentDir = Join-Path $repoRoot "canvas-agent"
$canvasAgentEntry = Join-Path $canvasAgentDir "dist\index.js"
$dataDir = Join-Path $repoRoot ".local\project-workbench-debug"
$goBuildCache = Join-Path $repoRoot ".local\cache\go-build"
$goModuleCache = Join-Path $repoRoot ".local\cache\go-mod"
$statePath = Join-Path $repoRoot ".local\yingce-local-processes.json"
$appUrl = "http://127.0.0.1:3000"

Add-Type -Path (Join-Path $PSScriptRoot "local-process-job.cs")
[YingceLocalProcessJob]::AttachCurrentProcess()
$Host.UI.RawUI.WindowTitle = "Yingce - Local services"

function Get-ProcessStartMarker([System.Diagnostics.Process]$Process) {
    try {
        return $Process.StartTime.ToUniversalTime().ToString("o")
    } catch {
        return ""
    }
}

function Test-TrackedProcess([object]$Record) {
    $processId = 0
    if (-not [int]::TryParse([string]$Record.pid, [ref]$processId)) {
        return $false
    }

    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        return $false
    }

    $expectedStartTime = [string]$Record.startTime
    if ([string]::IsNullOrWhiteSpace($expectedStartTime)) {
        return $false
    }
    return (Get-ProcessStartMarker $process) -eq $expectedStartTime
}

function Stop-ProcessTree([int]$ProcessId) {
    if ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        return
    }

    $taskKill = Get-Command taskkill.exe -ErrorAction SilentlyContinue
    if ($null -ne $taskKill) {
        & $taskKill.Source /PID $ProcessId /T /F *> $null
        return
    }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

if (Test-Path -LiteralPath $statePath) {
    try {
        $previousState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    } catch {
        throw "Cannot read local service state file: $statePath"
    }

    $activePreviousProcesses = @($previousState.processes | Where-Object { Test-TrackedProcess $_ })
    if ($activePreviousProcesses.Count -gt 0) {
        throw "Local services may already be running. Run scripts\stop-local.ps1 first."
    }

    Remove-Item -LiteralPath $statePath -Force
}

foreach ($commandName in @("go", "bun", "node", "npm")) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        throw "Command not found: $commandName. Install the required runtime first."
    }
}

if (-not (Test-Path -LiteralPath $canvasAgentEntry)) {
    Write-Host "Canvas Agent build is missing; installing/building the local runtime..." -ForegroundColor Yellow
    Push-Location $canvasAgentDir
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $canvasAgentDir "node_modules"))) {
            & npm install --no-audit --no-fund --package-lock=false
            if ($LASTEXITCODE -ne 0) {
                throw "Canvas Agent dependency installation failed."
            }
        }
        & npm run build
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $canvasAgentEntry)) {
            throw "Canvas Agent build failed; the local conversion runtime cannot start."
        }
    } finally {
        Pop-Location
    }
}

foreach ($directory in @($dataDir, $goBuildCache, $goModuleCache)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

$viteBinary = Join-Path $webDir "node_modules\.bin\vite"
if (-not (Test-Path -LiteralPath $viteBinary)) {
    Write-Host "web/node_modules is missing; running bun install --frozen-lockfile..." -ForegroundColor Yellow
    Push-Location $webDir
    try {
        & bun install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) {
            throw "bun install failed; the web app cannot start."
        }
    } finally {
        Pop-Location
    }
}

function Test-ListeningPort([int]$Port) {
    try {
        return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1)
    } catch {
        return $false
    }
}

foreach ($port in @(3000, 8080, 17371)) {
    if (Test-ListeningPort $port) {
        throw "Port $port is already in use. Stop the process using it and retry."
    }
}

$powerShellPath = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $powerShellPath) {
    $powerShellPath = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
}
if (-not $powerShellPath) {
    throw "PowerShell was not found; cannot open the backend and web windows."
}

function ConvertTo-PowerShellLiteral([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

function Save-LocalState([object[]]$Processes) {
    $state = [ordered]@{
        version = 1
        createdAt = [DateTime]::UtcNow.ToString("o")
        processes = $Processes
    }
    $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding UTF8
}

$backendDirLiteral = ConvertTo-PowerShellLiteral $backendDir
$webDirLiteral = ConvertTo-PowerShellLiteral $webDir
$canvasAgentDirLiteral = ConvertTo-PowerShellLiteral $canvasAgentDir
$dataDirLiteral = ConvertTo-PowerShellLiteral $dataDir

$backendCommand = @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $backendDirLiteral
`$env:CANVAS_BACKEND_ADDR = '127.0.0.1:8080'
`$env:CANVAS_BACKEND_DATA_DIR = $dataDirLiteral
`$env:GOCACHE = $(ConvertTo-PowerShellLiteral $goBuildCache)
`$env:GOMODCACHE = $(ConvertTo-PowerShellLiteral $goModuleCache)
Write-Host 'Backend: http://127.0.0.1:8080' -ForegroundColor Cyan
go run ./cmd/server
"@

$webCommand = @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $webDirLiteral
`$env:VITE_API_PROXY_TARGET = 'http://127.0.0.1:8080'
Write-Host 'Web app: http://localhost:3000' -ForegroundColor Cyan
bun run dev --host 127.0.0.1 --strictPort
exit `$LASTEXITCODE
"@

$canvasAgentCommand = @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $canvasAgentDirLiteral
Write-Host 'Canvas Agent: http://127.0.0.1:17371' -ForegroundColor Cyan
node dist/index.js
exit `$LASTEXITCODE
"@

$trackedProcesses = @()
try {
    $backendEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($backendCommand + "`nexit `$LASTEXITCODE"))
    $backendProcess = Start-Process -FilePath $powerShellPath -NoNewWindow -WorkingDirectory $backendDir -PassThru -ArgumentList @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $backendEncoded)
    $trackedProcesses += [ordered]@{
        role = "backend"
        pid = $backendProcess.Id
        startTime = Get-ProcessStartMarker $backendProcess
    }
    Save-LocalState $trackedProcesses

    $canvasAgentEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($canvasAgentCommand))
    $canvasAgentProcess = Start-Process -FilePath $powerShellPath -NoNewWindow -WorkingDirectory $canvasAgentDir -PassThru -ArgumentList @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $canvasAgentEncoded)

    $trackedProcesses += [ordered]@{
        role = "canvas-agent"
        pid = $canvasAgentProcess.Id
        startTime = Get-ProcessStartMarker $canvasAgentProcess
    }
    Save-LocalState $trackedProcesses

    $webEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($webCommand))
    $webProcess = Start-Process -FilePath $powerShellPath -NoNewWindow -WorkingDirectory $webDir -PassThru -ArgumentList @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $webEncoded)

    $trackedProcesses += [ordered]@{
        role = "web"
        pid = $webProcess.Id
        startTime = Get-ProcessStartMarker $webProcess
    }
    Save-LocalState $trackedProcesses

    Write-Host "Waiting for backend, frontend and Canvas Agent (first Go build may take a few minutes)..." -ForegroundColor Cyan
    $ready = $false
    $deadline = [DateTime]::UtcNow.AddMinutes(5)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (@($trackedProcesses | Where-Object { Test-TrackedProcess $_ }).Count -ne 3) {
            throw "A local service exited during startup. Check the error above."
        }
        try {
            $health = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2
            $page = Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 2
            $runtime = Invoke-WebRequest -Uri "http://127.0.0.1:17371/runtime/info" -UseBasicParsing -TimeoutSec 2
            if ($health.code -eq 0 -and $page.StatusCode -eq 200 -and $runtime.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "Startup timed out after 5 minutes. Check the service output above." }
    Write-Host "Yingce is ready at $appUrl" -ForegroundColor Green
    Write-Host "Keep this terminal open. Closing it stops the local services." -ForegroundColor Yellow
    if (-not $SkipBrowser) {
        # Open the URL with the user's default browser.
        Start-Process -FilePath $appUrl
    }

    while ($true) {
        $activeProcesses = @($trackedProcesses | Where-Object { Test-TrackedProcess $_ })
        if ($activeProcesses.Count -eq 0) {
            break
        }
        if ($activeProcesses.Count -lt $trackedProcesses.Count) {
            Write-Host "A local service exited; stopping the remaining service." -ForegroundColor Yellow
            break
        }
        Start-Sleep -Seconds 1
    }
} finally {
    foreach ($process in $trackedProcesses) {
        if (Test-TrackedProcess $process) {
            Stop-ProcessTree ([int]$process.pid)
        }
    }
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}
