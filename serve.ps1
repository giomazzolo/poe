# Serve the Exile Tools hub locally and print URLs.
# Usage:  .\serve.ps1
#         .\serve.ps1 -Port 8090
#         .\serve.ps1 -NoBrowser
# Binds on all interfaces so phones on the same Wi-Fi can open the LAN URL.

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
    if ($exe.Source -match "WindowsApps") { continue }
    try {
      & $cmd -c "import http.server" 2>$null
      if ($LASTEXITCODE -eq 0) { return $cmd }
    } catch { }
  }
  return $null
}

function Get-LanIPv4 {
  $addrs = @(
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.PrefixOrigin -ne "WellKnown"
      } |
      Sort-Object -Property InterfaceMetric |
      Select-Object -ExpandProperty IPAddress
  )
  if ($addrs.Count -gt 0) { return $addrs[0] }
  return $null
}

function Test-PortFree([int]$testPort) {
  $listener = $null
  try {
    $endpoint = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Any, $testPort)
    $listener = New-Object System.Net.Sockets.TcpListener $endpoint
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) {
      try { $listener.Stop() } catch { }
    }
  }
}

function Find-FreePort([int]$startPort) {
  for ($p = $startPort; $p -lt ($startPort + 20); $p++) {
    if (Test-PortFree $p) { return $p }
  }
  throw "No free port found from $startPort upward."
}

function Resolve-LocalPath([string]$urlPath) {
  $path = [Uri]::UnescapeDataString($urlPath.TrimStart("/")).Replace("\", "/")

  if ([string]::IsNullOrWhiteSpace($path)) {
    $path = "index.html"
  }
  else {
    $path = $path.TrimEnd("/")
    $asDir = [System.IO.Path]::GetFullPath((Join-Path $root ($path -replace "/", [System.IO.Path]::DirectorySeparatorChar)))
    if (Test-Path -LiteralPath $asDir -PathType Container) {
      $path = "$path/index.html"
    }
  }

  $relative = $path -replace "/", [System.IO.Path]::DirectorySeparatorChar
  $full = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
  $rootFull = [System.IO.Path]::GetFullPath($root)
  if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootFull = $rootFull + [System.IO.Path]::DirectorySeparatorChar
  }
  if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }
  return $full
}

function Read-HttpRequest($stream) {
  $ms = New-Object System.IO.MemoryStream
  $buffer = New-Object byte[] 4096
  $stream.ReadTimeout = 8000
  while ($true) {
    $read = $stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) { break }
    $ms.Write($buffer, 0, $read)
    $text = [System.Text.Encoding]::ASCII.GetString($ms.ToArray())
    if ($text.Contains("`r`n`r`n")) { break }
    if ($ms.Length -gt 65536) { break }
  }
  return [System.Text.Encoding]::ASCII.GetString($ms.ToArray())
}

function Send-TcpResponse($stream, [int]$status, [string]$reason, [string]$contentType, [byte[]]$body) {
  if (-not $body) { $body = [byte[]]@() }
  $header = "HTTP/1.1 $status $reason`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-cache`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($body.Length -gt 0) {
    $stream.Write($body, 0, $body.Length)
  }
  $stream.Flush()
}

$chosenPort = Find-FreePort $Port
if ($chosenPort -ne $Port) {
  Write-Host "Port $Port busy - using $chosenPort instead."
  $Port = $chosenPort
}

$lan = Get-LanIPv4
$url = "http://127.0.0.1:$Port/"
$rouletteUrl = "http://127.0.0.1:$Port/roulette/"
Write-Host ""
Write-Host "Exile Tools"
Write-Host "  Hub:      $url"
Write-Host "  Roulette: $rouletteUrl"
if ($lan) {
  Write-Host "  Phone:    http://${lan}:$Port/roulette/"
  Write-Host "            (same Wi-Fi as this PC)"
} else {
  Write-Host "  Phone:    (no LAN IPv4 found - check Wi-Fi)"
}
Write-Host ""
Write-Host "  If the phone cannot connect, allow the port in Windows Firewall"
Write-Host "  (run PowerShell as Administrator once):"
Write-Host "    New-NetFirewallRule -DisplayName 'Exile Tools Dev' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private"
Write-Host ""
Write-Host "  Press Ctrl+C to stop"
Write-Host ""

if (-not $NoBrowser) {
  try { Start-Process $url } catch { }
}

$python = Test-RealPython
if ($python) {
  Write-Host "Using $python -m http.server $Port (0.0.0.0)"
  & $python -m http.server $Port --bind 0.0.0.0
  exit $LASTEXITCODE
}

Write-Host "Using built-in PowerShell TCP server on port $Port (0.0.0.0)"
$endpoint = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Any, $Port)
$listener = New-Object System.Net.Sockets.TcpListener $endpoint

try {
  $listener.Start()
} catch {
  Write-Host "ERROR: Could not bind 0.0.0.0:$Port"
  Write-Host "Is the port already in use?"
  Write-Host $_.Exception.Message
  exit 1
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $remote = $client.Client.RemoteEndPoint.ToString()
    try {
      $stream = $client.GetStream()
      $requestText = Read-HttpRequest $stream
      if ([string]::IsNullOrWhiteSpace($requestText)) { continue }

      $firstLine = ($requestText -split "`r`n")[0]
      if ($firstLine -notmatch '^(GET|HEAD)\s+(\S+)\s+HTTP/') {
        Write-Host "  [$remote] bad request"
        Send-TcpResponse $stream 400 "Bad Request" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Bad Request"))
        continue
      }

      $method = $Matches[1]
      $rawPath = $Matches[2]
      # Strip query string for file lookup.
      $pathOnly = ($rawPath -split "\?", 2)[0]
      $uriPath = ([Uri]"http://localhost$pathOnly").AbsolutePath
      $full = Resolve-LocalPath $uriPath

      if ($null -eq $full) {
        Write-Host "  [$remote] 403 $uriPath"
        Send-TcpResponse $stream 403 "Forbidden" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Forbidden"))
        continue
      }

      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Write-Host "  [$remote] 404 $uriPath"
        Send-TcpResponse $stream 404 "Not Found" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Not Found"))
        continue
      }

      Write-Host "  [$remote] 200 $uriPath"
      $fileLen = (Get-Item -LiteralPath $full).Length
      $ctype = Get-ContentType ([System.IO.Path]::GetExtension($full))
      if ($method -eq "HEAD") {
        $header = "HTTP/1.1 200 OK`r`nContent-Type: $ctype`r`nContent-Length: $fileLen`r`nConnection: close`r`nCache-Control: no-cache`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $stream.Flush()
      }
      else {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        Send-TcpResponse $stream 200 "OK" $ctype $bytes
      }
    } catch {
      Write-Host "  [$remote] error: $($_.Exception.Message)"
    } finally {
      try { $client.Close() } catch { }
    }
  }
} finally {
  $listener.Stop()
}
