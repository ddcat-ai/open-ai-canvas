# 打包资源先在独立目录构建、校验，成功后才替换 resources。默认产出对外 Lite 版。
[CmdletBinding()]
param(
    [ValidateSet('lite', 'full')]
    [string]$Edition = 'lite'
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$desktop = Join-Path $repo 'desktop'
$resources = Join-Path $desktop 'resources'
$cache = Join-Path $repo '.local\cache'
$staging = Join-Path $cache ('desktop-resources-' + [guid]::NewGuid().ToString('N'))
$previous = Join-Path $cache ('desktop-resources-previous-' + [guid]::NewGuid().ToString('N'))
$manifest = Join-Path $PSScriptRoot 'resource-manifest.cjs'
$savedEnv = @{}
foreach ($name in @('PATH', 'CC', 'CGO_ENABLED', 'CANVAS_BUILD_COMMIT', 'VITE_CLIENT_EDITION', 'GIT_INDEX_FILE', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL')) {
    $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

# 只操作仓库内的构建目录，并拒绝目录链接。
function Assert-BuildPath([string]$Target) {
    $full = [IO.Path]::GetFullPath($Target)
    if (!$full.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "构建路径超出仓库：$full"
    }
    $current = $full
    while ($current -ne $repo) {
        if ((Test-Path -LiteralPath $current) -and
            ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "构建路径不允许链接：$current"
        }
        $current = Split-Path $current -Parent
    }
}

function Invoke-Build([string]$Directory, [string]$Tool, [string[]]$Arguments) {
    Push-Location -LiteralPath $Directory
    try {
        & $Tool @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Tool 失败（exit=$LASTEXITCODE）" }
    } finally { Pop-Location }
}

function Get-BuildRevision {
    $index = Join-Path $cache ('desktop-build-index-' + [guid]::NewGuid().ToString('N'))
    $env:GIT_INDEX_FILE = $index
    $env:GIT_AUTHOR_NAME = 'Lite Build Snapshot'
    $env:GIT_AUTHOR_EMAIL = 'lite-build@local.invalid'
    $env:GIT_COMMITTER_NAME = $env:GIT_AUTHOR_NAME
    $env:GIT_COMMITTER_EMAIL = $env:GIT_AUTHOR_EMAIL
    try {
        & git -C $repo read-tree HEAD
        if ($LASTEXITCODE -ne 0) { throw '无法读取 Git index' }
        & git -C $repo add -A
        if ($LASTEXITCODE -ne 0) { throw '无法登记构建源文件' }
        $tree = (& git -C $repo write-tree).Trim()
        if ($LASTEXITCODE -ne 0) { throw '无法生成构建源文件树' }
        $revision = (& git -C $repo commit-tree $tree -p HEAD -m 'Lite build snapshot').Trim()
        if ($LASTEXITCODE -ne 0) { throw '无法标记构建源文件' }
        return $revision
    } finally {
        foreach ($name in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name], 'Process') }
        if (Test-Path -LiteralPath $index) { Remove-Item -LiteralPath $index -Force }
    }
}

try {
    foreach ($target in @($staging, $previous, $resources)) { Assert-BuildPath $target }
    $env:PATH = "$env:USERPROFILE\.bun\bin;C:\Program Files\Go\bin;$env:PATH"
    foreach ($tool in @('bun', 'node', 'go', 'git')) {
        if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { throw "未找到 $tool" }
    }
    $gcc = $env:GCC
    if (!$gcc) {
        $found = Get-Command gcc -ErrorAction SilentlyContinue
        if ($found) { $gcc = $found.Source }
        elseif (Test-Path -LiteralPath (Join-Path $repo '..\.local\tools\w64devkit\bin\gcc.exe')) {
            $gcc = [IO.Path]::GetFullPath((Join-Path $repo '..\.local\tools\w64devkit\bin\gcc.exe'))
        }
    }
    if (!$gcc -or !(Test-Path -LiteralPath $gcc)) { throw '未找到 gcc；请设置 GCC 为编译器绝对路径' }
    $revision = Get-BuildRevision
    $env:CANVAS_BUILD_COMMIT = $revision
    $env:VITE_CLIENT_EDITION = $Edition
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    # 不覆盖混入任务库、账号 profile 等运行数据的旧资源。
    if (Test-Path -LiteralPath $resources) {
        Invoke-Build $repo 'node' @($manifest, 'inspect', $resources)
    }
    Write-Host "== 前端构建（$Edition）=="
    Invoke-Build (Join-Path $repo 'web') 'bun' @('install', '--frozen-lockfile')
    $build = if ($Edition -eq 'lite') { 'build:lite' } else { 'build' }
    Invoke-Build (Join-Path $repo 'web') 'bun' @('run', $build, '--outDir', (Join-Path $staging 'web-dist'))
    $dollDir = Join-Path $staging 'web-dist\doll'
    if (Test-Path -LiteralPath $dollDir) {
        Assert-BuildPath $dollDir
        Remove-Item -LiteralPath $dollDir -Recurse -Force
    }

    Write-Host '== 后端 CGO 构建（SQLite）=='
    $env:CGO_ENABLED = '1'
    $env:CC = $gcc
    $env:PATH = "$(Split-Path $gcc -Parent);$env:PATH"
    Invoke-Build (Join-Path $repo 'backend') 'go' @('build', '-trimpath', '-ldflags', '-s -w', '-o', (Join-Path $staging 'canvas-backend.exe'), './cmd/server')

    Write-Host '== 官方插件与桥依赖装配 =='
    $plugins = Join-Path $staging 'plugin-packages'
    New-Item -ItemType Directory -Path $plugins | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $repo 'plugin-packages') -Filter '*.yingce-plugin' -File |
        Where-Object { $_.Name -notlike '*payment*' } |
        Copy-Item -Destination $plugins
    $bridge = Join-Path $staging 'doubao-bridge'
    $sourceBridge = Join-Path $desktop 'doubao-bridge'
    New-Item -ItemType Directory -Path (Join-Path $bridge 'data') -Force | Out-Null
    # 明确白名单，不复制源目录的账号、备份、取证或已有 node_modules。
    foreach ($name in @('src', 'package.json', 'bun.lock', 'config.json')) {
        Copy-Item -LiteralPath (Join-Path $sourceBridge $name) -Destination $bridge -Recurse
    }
    Invoke-Build $repo 'node' @((Join-Path $PSScriptRoot 'sanitize-bridge-config.cjs'), (Join-Path $bridge 'config.json'))
    Copy-Item -LiteralPath (Join-Path $sourceBridge 'data\skill-pack.json') -Destination (Join-Path $bridge 'data')
    Invoke-Build $bridge 'bun' @('install', '--production', '--frozen-lockfile', '--registry=https://registry.npmjs.org')
    # 仅去掉声明和 source map；保留许可证、模板及动态加载资源。
    Get-ChildItem -LiteralPath (Join-Path $bridge 'node_modules') -Recurse -File |
        Where-Object { $_.Name -like '*.d.ts' -or $_.Name -like '*.map' } |
        ForEach-Object { Assert-BuildPath $_.FullName; Remove-Item -LiteralPath $_.FullName -Force }
    Invoke-Build $repo 'node' @($manifest, 'write', $staging, $Edition, $revision)
    Invoke-Build $repo 'node' @($manifest, 'smoke', $staging, $Edition, $revision)

    if (Test-Path -LiteralPath $resources) { Move-Item -LiteralPath $resources -Destination $previous }
    try { Move-Item -LiteralPath $staging -Destination $resources }
    catch {
        if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $resources }
        throw
    }
    if (Test-Path -LiteralPath $previous) {
        Assert-BuildPath $previous
        Remove-Item -LiteralPath $previous -Recurse -Force
    }
    Write-Host "资源就绪：$Edition $revision"
} finally {
    foreach ($name in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name], 'Process') }
    if (Test-Path -LiteralPath $staging) {
        Assert-BuildPath $staging
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}
