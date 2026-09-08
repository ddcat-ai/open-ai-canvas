[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$statePath = Join-Path $repoRoot ".local\yingce-local-processes.json"

function Get-ProcessStartMarker([System.Diagnostics.Process]$Process) {
    try {
        return $Process.StartTime.ToUniversalTime().ToString("o")
    } catch {
        return ""
    }
}

function Get-TrackedProcess([object]$Record) {
    $processId = 0
    if (-not [int]::TryParse([string]$Record.pid, [ref]$processId)) {
        return $null
    }

    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        return $null
    }

    $expectedStartTime = [string]$Record.startTime
    if ([string]::IsNullOrWhiteSpace($expectedStartTime)) {
        return $null
    }
    if ((Get-ProcessStartMarker $process) -ne $expectedStartTime) {
        return $null
    }
    return $process
}

function Stop-ProcessTree([int]$ProcessId) {
    $taskKill = Get-Command taskkill.exe -ErrorAction SilentlyContinue
    if ($null -ne $taskKill) {
        & $taskKill.Source /PID $ProcessId /T /F *> $null
        return
    }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $statePath)) {
    Write-Host "No local startup record found; no process was stopped by port." -ForegroundColor Yellow
    exit 0
}

try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
} catch {
    throw "Cannot read local service state file: $statePath. No process was stopped."
}

$trackedProcesses = @($state.processes)
$stoppedRoles = New-Object System.Collections.Generic.List[string]
$skippedRoles = New-Object System.Collections.Generic.List[string]

foreach ($record in ($trackedProcesses | Sort-Object @{ Expression = { if ($_.role -eq "web") { 0 } else { 1 } } })) {
    $process = Get-TrackedProcess $record
    if ($null -eq $process) {
        $skippedRoles.Add([string]$record.role)
        continue
    }

    Stop-ProcessTree $process.Id
    $stoppedRoles.Add([string]$record.role)
}

Remove-Item -LiteralPath $statePath -Force

if ($stoppedRoles.Count -gt 0) {
    Write-Host ("Stopped local services: " + ($stoppedRoles -join ", ")) -ForegroundColor Green
}
if ($skippedRoles.Count -gt 0) {
    Write-Host ("Skipped missing or changed process IDs: " + ($skippedRoles -join ", ")) -ForegroundColor Yellow
}
