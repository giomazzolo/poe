# Serve the Exile Tools hub locally and print URLs.
# Usage:  .\serve.ps1
#         .\serve.ps1 -Port 8090
#         .\serve.ps1 -NoBrowser

param(
  [int]$Port = 8080,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
if (-not $root) { $root = Get-Location }
Set-Location $root

function Get-ContentType([string]$ext) {
  switch ($ext.ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".js"   { "text/javascript; charset=utf-8" }
    ".css"  { "text/css; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".png"  { "image/png" }
    ".jpg"  { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".webp" { "image/webp" }
    ".gif"  { "image/gif" }
    ".svg"  { "image/svg+xml" }
    ".woff" { "font/woff" }
    ".woff2"{ "font/woff2" }
    ".map"  { "application/json" }
    default { "application/octet-stream" }
  }
}

function Test-RealPython {
  foreach ($cmd in @("python", "py")) {
    $exe = Get-Command $cmd -ErrorAction SilentlyContinue
    if (-not $exe) { continue }
    # Windows Store stub often exists but is not a real install.
    if ($exe.Source -match "WindowsApps") { continue }
    try {
      & $cmd -c "import http.server" 2>$null
      if ($LASTEXITCODE -eq 0) { return $cmd }
    } catch { }
  }
  return $null
}

$url = "http://127.0.0.1:$Port/"
$rouletteUrl = "http://127.0.0.1:$Port/roulette/"
Write-Host ""
Write-Host "Exile Tools"
Write-Host "  Hub:      $url"
Write-Host "  Roulette: $rouletteUrl"
Write-Host "  Press Ctrl+C to stop"
Write-Host ""

if (-not $NoBrowser) {
  try { Start-Process $url } catch { }
}

$python = Test-RealPython
if ($python) {
  Write-Host "Using $python -m http.server $Port"
  & $python -m http.server $Port --bind 127.0.0.1
  exit $LASTEXITCODE
}

Write-Host "Using built-in PowerShell HTTP listener on port $Port"
$prefix = "http://127.0.0.1:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Host "ERROR: Could not bind $prefix"
  Write-Host "Is the port already in use?"
  Write-Host $_.Exception.Message
  exit 1
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.LocalPath.TrimStart("/"))
    if ([string]::IsNullOrWhiteSpace($path)) { $path = "index.html" }
    elseif ($path.EndsWith("/")) { $path = $path + "index.html" }

    $full = [System.IO.Path]::GetFullPath((Join-Path $root $path))
    $rootFull = [System.IO.Path]::GetFullPath($root)
    if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
      $rootFull = $rootFull + [System.IO.Path]::DirectorySeparatorChar
    }
    if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
      $ctx.Response.StatusCode = 403
      $ctx.Response.Close()
      continue
    }

    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $ctx.Response.StatusCode = 404
      $ctx.Response.Close()
      continue
    }

    $bytes = [System.IO.File]::ReadAllBytes($full)
    $ctx.Response.ContentType = Get-ContentType ([System.IO.Path]::GetExtension($full))
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
