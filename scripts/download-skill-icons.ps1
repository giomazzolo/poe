# Download PoE skill-bar icons from image.ggpk.exposed into roulette/assets/icons/skills/
# Resumable, short timeouts, parallel workers, progress file updated every skill.

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$skillsPath = Join-Path $root 'roulette\data\skills.json'
$iconsPath = Join-Path $root 'roulette\data\skill-icons.json'
$outDir = Join-Path $root 'roulette\assets\icons\skills'
$progressPath = Join-Path $root 'tmp\screens\icon-download-progress.json'
$logPath = Join-Path $root 'tmp\screens\icon-download.log'

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $progressPath) | Out-Null

Add-Type -AssemblyName System.Web.Extensions
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = [int]::MaxValue

$skillsDoc = $ser.DeserializeObject([IO.File]::ReadAllText($skillsPath))
$oldIcons = $ser.DeserializeObject([IO.File]::ReadAllText($iconsPath))

$gemsFile = Join-Path $env:TEMP 'poe_gems_full.min.json'
$itemsFile = Join-Path $env:TEMP 'poe_base_items.min.json'
if (-not (Test-Path $gemsFile)) {
  Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/brather1ng/RePoE/master/RePoE/data/gems.min.json' -OutFile $gemsFile -UseBasicParsing
}
if (-not (Test-Path $itemsFile)) {
  Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/brather1ng/RePoE/master/RePoE/data/base_items.min.json' -OutFile $itemsFile -UseBasicParsing
}
$gems = $ser.DeserializeObject([IO.File]::ReadAllText($gemsFile))
$items = $ser.DeserializeObject([IO.File]::ReadAllText($itemsFile))

$byActiveId = @{}
foreach ($key in @($gems.Keys)) {
  $g = $gems[$key]
  if (-not $g['active_skill'] -or -not $g['base_item']) { continue }
  $aid = [string]$g['active_skill']['id']
  if (-not $aid -or $byActiveId.ContainsKey($aid)) { continue }
  $byActiveId[$aid] = @{
    gemKey = $key
    display = [string]$g['display_name']
    baseItemId = [string]$g['base_item']['id']
  }
}

function Get-NameCandidates([string]$id, [string]$display, $meta, $oldEntry) {
  $names = New-Object System.Collections.Generic.List[string]
  $add = {
    param($n)
    if (-not $n) { return }
    $n = ($n -replace '\.(webp|png|dds)$', '')
    if ($n -and -not $names.Contains($n)) { [void]$names.Add($n) }
  }

  # From existing CDN candidate URLs
  if ($oldEntry -and $oldEntry['skill']) {
    $arr = if ($oldEntry['skill'] -is [string]) { @($oldEntry['skill']) } else { @($oldEntry['skill']) }
    foreach ($u in $arr) {
      if ($u -match '/SkillIcons/([^/?#]+)') { & $add $Matches[1] }
    }
  }

  if ($meta) {
    & $add $meta.gemKey
    $bi = $items[$meta.baseItemId]
    if ($bi -and $bi['visual_identity'] -and $bi['visual_identity']['dds_file']) {
      $stem = [IO.Path]::GetFileNameWithoutExtension((([string]$bi['visual_identity']['dds_file'] -replace '\\', '/').Split('/')[-1]))
      & $add $stem
      & $add ($stem -replace 'Gem$', '' -replace 'SkillGem$', '')
    }
  }

  $compact = ($display -replace '[^A-Za-z0-9]', '')
  & $add $compact
  & $add ("icon" + $compact.ToLower())
  & $add $compact.ToLower()

  $cleanId = $id -replace '_alt_[xyz]$', ''
  $pascal = ($cleanId -split '_' | ForEach-Object {
      if ($_.Length) { $_.Substring(0, 1).ToUpper() + $_.Substring(1) }
    }) -join ''
  & $add $pascal
  & $add ("icon" + $pascal.ToLower())

  # Prefer icon* and short names first (Fireball-style), then Pascal, then *Gem last
  return @($names | Sort-Object {
      if ($_ -match '^icon') { 0 }
      elseif ($_ -match 'Gem$') { 3 }
      elseif ($_ -cmatch '^[A-Z]') { 1 }
      else { 2 }
    })
}

# Shared filename cache: icon name -> local relative path (or $false if missing)
$fileCache = @{}
$results = @{} # skill id -> @{ gem; skill }

function Try-DownloadName([string]$name) {
  if ($fileCache.ContainsKey($name)) { return $fileCache[$name] }

  $safe = ($name -replace '[^A-Za-z0-9_\-]', '_')
  $localRel = "assets/icons/skills/$safe.png"
  $localAbs = Join-Path $root ($localRel -replace '/', '\')

  if (Test-Path $localAbs -PathType Leaf) {
    $len = (Get-Item $localAbs).Length
    if ($len -gt 200) {
      $fileCache[$name] = $localRel
      return $localRel
    }
  }

  $url = "https://image.ggpk.exposed/poe1/Art/2DArt/SkillIcons/$name.dds?format=png"
  try {
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add('User-Agent', 'poe-roulette-icon-fetch/1.0')
    $bytes = $wc.DownloadData($url)
    if ($bytes -and $bytes.Length -gt 200) {
      [IO.File]::WriteAllBytes($localAbs, $bytes)
      $fileCache[$name] = $localRel
      return $localRel
    }
  } catch {
    # miss
  }
  $fileCache[$name] = $false
  return $false
}

function Write-ProgressFile($done, $total, $ok, $fail, $current) {
  $obj = @{
    done = $done
    total = $total
    ok = $ok
    fail = $fail
    current = $current
    updatedAt = (Get-Date).ToString('o')
  }
  [IO.File]::WriteAllText($progressPath, ($obj | ConvertTo-Json -Compress))
}

$all = @($skillsDoc['skills'])
# Bases first so alts can reuse
$ordered = @($all | Where-Object { $_['variant'] -ne 'transfigured' }) +
           @($all | Where-Object { $_['variant'] -eq 'transfigured' })

$total = $ordered.Count
$ok = 0
$fail = 0
$i = 0

"START total=$total" | Tee-Object -FilePath $logPath

foreach ($sk in $ordered) {
  $i++
  $id = [string]$sk['id']
  $display = [string]$sk['name']
  $meta = $byActiveId[$id]
  if ($meta) { $display = $meta.display }

  $gemUrl = $null
  if ($oldIcons[$id] -and $oldIcons[$id]['gem']) {
    $gemUrl = [string]$oldIcons[$id]['gem']
  } elseif ($meta) {
    $bi = $items[$meta.baseItemId]
    if ($bi -and $bi['visual_identity'] -and $bi['visual_identity']['dds_file']) {
      $dds = ([string]$bi['visual_identity']['dds_file'] -replace '\\', '/')
      $gemUrl = 'https://web.poecdn.com/image/' + ($dds -replace '\.dds$', '.png')
    }
  }

  $skillPath = $false
  $names = Get-NameCandidates $id $display $meta $oldIcons[$id]
  foreach ($n in $names) {
    $hit = Try-DownloadName $n
    if ($hit) { $skillPath = $hit; break }
  }

  # Transfigured fallback: reuse base skill's resolved icon
  if (-not $skillPath -and $id -match '^(.*)_alt_[xyz]$') {
    $baseId = $Matches[1]
    if ($results.ContainsKey($baseId) -and $results[$baseId].skill) {
      $skillPath = $results[$baseId].skill
    }
  }

  if ($skillPath) { $ok++ } else { $fail++ }

  $results[$id] = @{
    gem = $gemUrl
    skill = $(if ($skillPath) { $skillPath } else { $null })
  }

  $line = ("[{0}/{1}] {2} => {3}" -f $i, $total, $id, $(if ($skillPath) { $skillPath } else { 'MISS' }))
  Add-Content -Path $logPath -Value $line
  Write-Host $line
  Write-ProgressFile $i $total $ok $fail $id
}

# Write skill-icons.json
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('{')
$first = $true
foreach ($sk in $all) {
  $id = [string]$sk['id']
  $r = $results[$id]
  if (-not $first) { [void]$sb.Append(',') }
  $first = $false
  $gemJson = if ($r.gem) { '"' + $r.gem + '"' } else { 'null' }
  $skillJson = if ($r.skill) { '"' + ($r.skill -replace '\\', '/') + '"' } else { 'null' }
  [void]$sb.Append(('"{0}":{{"gem":{1},"skill":{2}}}' -f $id, $gemJson, $skillJson))
}
[void]$sb.Append('}')
[IO.File]::WriteAllText($iconsPath, $sb.ToString())

$summary = "DONE ok=$ok fail=$fail total=$total iconsDir=$outDir"
Add-Content -Path $logPath -Value $summary
Write-Host $summary
Write-ProgressFile $total $total $ok $fail 'done'
