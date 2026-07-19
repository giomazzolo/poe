$root = Split-Path -Parent $PSScriptRoot
$resultFile = Join-Path $PSScriptRoot "smoke-result.txt"
Remove-Item -Force -ErrorAction SilentlyContinue $resultFile

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:8766/")
try {
  $listener.Start()
} catch {
  # Port may already be in use from a previous run — reuse by exiting if ready flag exists
  Write-Output "BIND_FAIL $_"
  exit 1
}
Set-Content -Path (Join-Path $PSScriptRoot "server.ready") -Value "up"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $local = $ctx.Request.Url.LocalPath

  if ($local -eq "/__smoke") {
    $status = $ctx.Request.QueryString["status"]
    $msg = $ctx.Request.QueryString["msg"]
    Set-Content -Path $resultFile -Value "$status`n$msg"
    $bytes = [Text.Encoding]::UTF8.GetBytes("ok")
    $ctx.Response.ContentType = "text/plain"
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
    continue
  }

  $path = [Uri]::UnescapeDataString($local.TrimStart("/"))
  if ([string]::IsNullOrWhiteSpace($path)) { $path = "index.html" }
  $full = [System.IO.Path]::GetFullPath((Join-Path $root $path))
  $rootFull = [System.IO.Path]::GetFullPath($root)
  if (-not $full.StartsWith($rootFull)) {
    $ctx.Response.StatusCode = 403
    $ctx.Response.Close()
    continue
  }
  if (-not (Test-Path -LiteralPath $full) -or (Get-Item -LiteralPath $full).PSIsContainer) {
    $ctx.Response.StatusCode = 404
    $ctx.Response.Close()
    continue
  }
  $bytes = [System.IO.File]::ReadAllBytes($full)
  $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
  $ctype = switch ($ext) {
    ".html" { "text/html; charset=utf-8" }
    ".js" { "text/javascript; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".png" { "image/png" }
    ".webp" { "image/webp" }
    default { "application/octet-stream" }
  }
  $ctx.Response.ContentType = $ctype
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}
