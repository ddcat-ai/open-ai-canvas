$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSCommandPath
$ids = if ($args.Count -gt 0) { $args } else { throw 'Pass one or more plugin directory names.' }

foreach ($id in $ids) {
  $source = Join-Path $root $id
  $output = Join-Path $root ($id + '.yingce-plugin')
  $temporary = Join-Path $root ('.' + $id + '.yingce-plugin.tmp')
  if (-not (Test-Path -LiteralPath (Join-Path $source 'manifest.json'))) {
    throw "Missing manifest.json for $id"
  }
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }

  $archive = [System.IO.Compression.ZipFile]::Open($temporary, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -LiteralPath $source -Recurse -File | Where-Object {
      $_.Name -in @('manifest.json', 'README.md', 'LICENSE') -or
      $_.FullName -match '\\(docs|assets|web|backend)\\'
    } | ForEach-Object {
      $entryName = $_.FullName.Substring($source.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  } finally {
    $archive.Dispose()
  }
  Move-Item -LiteralPath $temporary -Destination $output -Force
  Write-Output "$id -> $output"
}
