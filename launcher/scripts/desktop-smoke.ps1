param(
  [Parameter(Mandatory=$true)][string]$AppPath,
  [Parameter(Mandatory=$true)][string]$DataRoot,
  [Parameter(Mandatory=$true)][string]$OutputRoot
)
$ErrorActionPreference='Stop'
if (!(Split-Path -IsAbsolute $AppPath) -or !(Split-Path -IsAbsolute $DataRoot) -or !(Split-Path -IsAbsolute $OutputRoot)) { throw 'Absolute paths required' }
$probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,9223); $probe.Start(); $probe.Stop()
New-Item -ItemType Directory -Force $OutputRoot | Out-Null
$env:YINGCE_LAUNCHER_SMOKE_ROOT=$DataRoot
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1'
$env:AGENT_BROWSER_SESSION='yingce-launcher-source-desktop'
$app=Start-Process -FilePath $AppPath -PassThru -RedirectStandardOutput (Join-Path $OutputRoot 'desktop.stdout.log') -RedirectStandardError (Join-Path $OutputRoot 'desktop.stderr.log')
try {
  $ready=$false
  for($i=0;$i -lt 40;$i++) {
    if($app.HasExited){throw 'Desktop app exited before WebView initialization'}
    try { $null=Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/version' -TimeoutSec 2 -NoProxy; $ready=$true; break } catch { Start-Sleep -Milliseconds 500 }
  }
  if(!$ready){throw 'WebView CDP not ready'}
  function Browser { & agent-browser --cdp 9223 @args; if($LASTEXITCODE -ne 0){throw ('Browser command failed: '+($args -join ' '))} }
  Browser snapshot -i
  Browser find role button click --name '设置' --exact
  Browser find label '服务就绪后自动打开默认浏览器' check
  Browser find role button click --name '保存设置' --exact
  Browser wait --text '设置已保存'
  Browser find role button click --name '工作台' --exact
  Browser find role button click --name '启动影策' --exact
  $serviceReady=$false
  for($i=0;$i -lt 300;$i++) {
    try { $check=Invoke-RestMethod -Uri 'http://127.0.0.1:37890/api/health/ready' -TimeoutSec 2 -NoProxy; if($check.code -eq 0 -and $check.data.ready){$serviceReady=$true;break} } catch {}
    Start-Sleep -Milliseconds 500
  }
  if(!$serviceReady){ Browser snapshot -i; Browser screenshot (Join-Path $OutputRoot 'desktop-start-failed.png'); throw 'Real service failed to start within 150 seconds' }
  Browser wait --text '影策正在运行'
  Browser screenshot (Join-Path $OutputRoot 'desktop-running.png')
  $health=Invoke-RestMethod -Uri 'http://127.0.0.1:37890/api/health/ready' -TimeoutSec 10 -NoProxy
  if($health.code -ne 0 -or !$health.data.ready){throw 'Real backend not ready'}
  Write-Output ('DESKTOP_REAL_READY version='+$health.data.build.version+' commit='+$health.data.build.commit)
  & agent-browser --session yingce-source-web-page open 'http://127.0.0.1:37890'
  if($LASTEXITCODE -ne 0){throw 'Browser failed to open real app'}
  & agent-browser --session yingce-source-web-page wait --load domcontentloaded
  & agent-browser --session yingce-source-web-page snapshot -i
  & agent-browser --session yingce-source-web-page screenshot (Join-Path $OutputRoot 'yingce-browser.png')
  Browser find role button click --name '停止服务' --exact
  Browser find role button click --name '确认停止' --exact
  Browser wait --text '服务已停止'
  Browser screenshot (Join-Path $OutputRoot 'desktop-stopped.png')
  Write-Output 'DESKTOP_START_BROWSER_STOP_PASS'
} finally {
  & agent-browser --session yingce-source-web-page close 2>$null | Out-Null
  & agent-browser --cdp 9223 close 2>$null | Out-Null
  if(!$app.HasExited){ $null=$app.CloseMainWindow(); if(!$app.WaitForExit(10000)){$app.Kill();$app.WaitForExit()} }
}
