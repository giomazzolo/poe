# Extract classic ascendancy subgraphs from GGG skilltree-export (or local cache).
# Source: https://github.com/grindinggear/skilltree-export
# Usage: pwsh scripts/extract-ascendancy-trees.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $PSScriptRoot "_tree-raw.json"
$outFile = Join-Path $root "roulette\data\ascendancy-trees.json"
$cdn = "https://raw.githubusercontent.com/grindinggear/skilltree-export/master/data.json"

if (-not (Test-Path $cache)) {
  Write-Host "Downloading $cdn"
  Invoke-WebRequest -Uri $cdn -OutFile $cache -UseBasicParsing
}

Write-Host "Parsing tree..."
$tree = Get-Content $cache -Raw | ConvertFrom-Json

$skillsPerOrbit = @($tree.constants.skillsPerOrbit)
$orbitRadii = @($tree.constants.orbitRadii)

function Get-OrbitAngles([int]$nodesInOrbit) {
  if ($nodesInOrbit -eq 16) {
    return @(0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330)
  }
  if ($nodesInOrbit -eq 40) {
    return @(0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135, 140, 150, 160, 170, 180, 190, 200, 210, 220, 225, 230, 240, 250, 260, 270, 280, 290, 300, 310, 315, 320, 330, 340, 350)
  }
  $angles = @()
  for ($i = 0; $i -lt $nodesInOrbit; $i++) {
    $angles += 360.0 * $i / $nodesInOrbit
  }
  return $angles
}

$orbitAnglesByOrbit = @()
foreach ($count in $skillsPerOrbit) {
  $orbitAnglesByOrbit += , (Get-OrbitAngles ([int]$count))
}

# App slug -> PoB ascendancyName (Raider == Warden in data)
$slugByAscendName = @{}
$classByAscendName = @{}
$displayByAscendName = @{}
foreach ($cls in $tree.classes) {
  foreach ($asc in $cls.ascendancies) {
    $slug = ($asc.name -replace '\s+', '').ToLowerInvariant()
    $slugByAscendName[$asc.id] = $slug
    $classByAscendName[$asc.id] = $cls.name
    $displayByAscendName[$asc.id] = $asc.name
  }
}

$nodesByAscend = @{}
foreach ($prop in $tree.nodes.PSObject.Properties) {
  $node = $prop.Value
  if (-not $node.ascendancyName) { continue }
  if ($node.PSObject.Properties.Name -contains 'isBloodline' -and $node.isBloodline) { continue }
  $name = [string]$node.ascendancyName
  if (-not $slugByAscendName.ContainsKey($name)) { continue }
  if (-not $nodesByAscend.ContainsKey($name)) {
    $nodesByAscend[$name] = [System.Collections.Generic.List[object]]::new()
  }
  $nodesByAscend[$name].Add([pscustomobject]@{
      id   = [string]$prop.Name
      node = $node
    })
}

$trees = [ordered]@{}
foreach ($ascendName in ($nodesByAscend.Keys | Sort-Object)) {
  $slug = $slugByAscendName[$ascendName]
  $entries = $nodesByAscend[$ascendName]
  $idSet = [System.Collections.Generic.HashSet[string]]::new()
  foreach ($e in $entries) { [void]$idSet.Add($e.id) }

  $computed = @()
  $minX = [double]::PositiveInfinity
  $minY = [double]::PositiveInfinity
  $maxX = [double]::NegativeInfinity
  $maxY = [double]::NegativeInfinity

  foreach ($e in $entries) {
    $n = $e.node
    $groupId = [string]$n.group
    $group = $tree.groups.$groupId
    if (-not $group) { continue }

    $orbit = [int]$n.orbit
    $orbitIndex = [int]$n.orbitIndex
    $angles = $orbitAnglesByOrbit[$orbit]
    if ($null -eq $angles -or $angles.Count -eq 0 -or $orbitIndex -ge $angles.Count) { continue }
    $deg = [double]$angles[$orbitIndex]
    $rad = $deg * [math]::PI / 180.0
    $radius = [double]$orbitRadii[$orbit]
    $x = [double]$group.x + [math]::Sin($rad) * $radius
    $y = [double]$group.y - [math]::Cos($rad) * $radius

    if ($x -lt $minX) { $minX = $x }
    if ($y -lt $minY) { $minY = $y }
    if ($x -gt $maxX) { $maxX = $x }
    if ($y -gt $maxY) { $maxY = $y }

    $outs = @()
    if ($n.out) {
      foreach ($t in @($n.out)) {
        if ($idSet.Contains([string]$t)) { $outs += [string]$t }
      }
    }

    $type = "normal"
    if ($n.isAscendancyStart) { $type = "start" }
    elseif ($n.isNotable) { $type = "notable" }
    elseif ($n.isMultipleChoice -or $n.isMultipleChoiceOption) { $type = "choice" }

    $stats = @()
    if ($n.stats) { $stats = @($n.stats) }
    $reminder = @()
    if ($n.reminderText) { $reminder = @($n.reminderText) }

    $computed += [ordered]@{
      id        = $e.id
      name      = [string]$n.name
      type      = $type
      x         = [math]::Round($x, 2)
      y         = [math]::Round($y, 2)
      icon      = [string]$n.icon
      stats     = $stats
      reminder  = $reminder
      out       = $outs
      isStart   = [bool]$n.isAscendancyStart
      isNotable = [bool]$n.isNotable
    }
  }

  $pad = 40.0
  $norm = @()
  foreach ($c in $computed) {
    $c.x = [math]::Round(($c.x - $minX) + $pad, 2)
    $c.y = [math]::Round(($c.y - $minY) + $pad, 2)
    $norm += $c
  }

  $width = [math]::Round(($maxX - $minX) + $pad * 2, 2)
  $height = [math]::Round(($maxY - $minY) + $pad * 2, 2)
  $bgKey = $ascendName
  if ($ascendName -eq "Raider") { $bgKey = "Warden" }

  $trees[$slug] = [ordered]@{
    id              = $slug
    name            = $displayByAscendName[$ascendName]
    ascendancyName  = $ascendName
    character       = $classByAscendName[$ascendName]
    background      = "assets/ascendancy-trees/Classes$bgKey.png"
    width           = $width
    height          = $height
    nodes           = $norm
  }

  Write-Host ("  {0,-14} {1,2} nodes  {2:N0}x{3:N0}" -f $slug, $norm.Count, $width, $height)
}

$payload = [ordered]@{
  meta = [ordered]@{
    source       = "grindinggear/skilltree-export data.json"
    poeVersion   = "3.28"
    generatedAt  = (Get-Date).ToUniversalTime().ToString("o")
    nodeCount    = ($trees.Values | ForEach-Object { $_.nodes.Count } | Measure-Object -Sum).Sum
    ascendancies = $trees.Count
  }
  trees = $trees
}

$dir = Split-Path $outFile
New-Item -ItemType Directory -Force -Path $dir | Out-Null
($payload | ConvertTo-Json -Depth 8 -Compress:$false) | Set-Content -Path $outFile -Encoding UTF8
Write-Host "Wrote $outFile"
