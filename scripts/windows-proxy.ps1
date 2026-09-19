# Go uses proxy environment variables, not Windows Internet Settings.
# Inherit the user's enabled static proxy only when no explicit proxy was set.
function Import-CanvasWindowsProxy {
    if ($env:HTTPS_PROXY -or $env:HTTP_PROXY -or $env:ALL_PROXY) { return }
    $settings = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    if (-not $settings -or $settings.ProxyEnable -ne 1 -or -not $settings.ProxyServer) { return }
    $proxies = @{}
    foreach ($entry in ($settings.ProxyServer -split ';')) {
        if ($entry -match '^\s*(https?)=(.+)$') {
            $proxies[$Matches[1]] = $Matches[2].Trim()
        } elseif ($entry -notmatch '=') {
            $proxies['http'] = $entry.Trim()
            $proxies['https'] = $entry.Trim()
        }
    }
    foreach ($scheme in @('http', 'https')) {
        $address = $proxies[$scheme]
        if (-not $address) { continue }
        if ($address -notmatch '^[a-z]+://') { $address = "http://$address" }
        $parsed = $null
        if (-not [Uri]::TryCreate($address, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -notin @('http', 'https')) {
            throw 'Windows proxy address is invalid. Check system proxy settings.'
        }
        [Environment]::SetEnvironmentVariable("$($scheme.ToUpper())_PROXY", $address, 'Process')
    }
    if ($env:HTTP_PROXY -or $env:HTTPS_PROXY) {
        $bypass = @($env:NO_PROXY, 'localhost', '127.0.0.1', '::1')
        foreach ($entry in ($settings.ProxyOverride -split ';')) {
            $entry = $entry.Trim()
            if ($entry -and $entry -ne '<local>') { $bypass += $entry }
        }
        $env:NO_PROXY = ($bypass | Where-Object { $_ } | Select-Object -Unique) -join ','
        Write-Host 'Backend network: using the enabled Windows proxy.' -ForegroundColor Cyan
    }
}
