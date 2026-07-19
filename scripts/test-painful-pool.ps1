# Validates roll-pool rebuild with three inclusion sets.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$jsonPath = Join-Path $root "roulette\data\skills.json"
$data = Get-Content -Raw -Path $jsonPath | ConvertFrom-Json

$damage = @($data.damageSkills)
$banned = @($data.bannedSkills)
$trans = @($data.skills | Where-Object { $_.variant -eq "transfigured" -and $_.dealsDamage })

$incD = New-Object 'System.Collections.Generic.HashSet[string]'
$incB = New-Object 'System.Collections.Generic.HashSet[string]'
$incT = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($s in $damage) { [void]$incD.Add($s.id) }
foreach ($s in $trans) { [void]$incT.Add($s.id) }

function Rebuild([bool]$transOn) {
  $pool = New-Object System.Collections.Generic.List[object]
  foreach ($s in $damage) { if ($incD.Contains($s.id)) { $pool.Add($s) } }
  foreach ($s in $banned) { if ($incB.Contains($s.id)) { $pool.Add($s) } }
  if ($transOn) {
    foreach ($s in $trans) { if ($incT.Contains($s.id)) { $pool.Add($s) } }
  }
  return $pool
}

$fail = $false
function Check($cond, $msg) {
  if (-not $cond) { Write-Output "FAIL $msg"; $script:fail = $true }
  else { Write-Output "PASS $msg" }
}

# painful only
$incD.Clear()
foreach ($s in $banned) { [void]$incB.Add($s.id) }
$p = Rebuild $false
Check ($p.Count -eq $banned.Count) "painful-only count=$($p.Count)"

# remember transfigured while mode off
$before = $incT.Count
$p2 = Rebuild $false
Check ($p2.Count -eq $banned.Count) "trans mode off ignores transfigured"
Check ($incT.Count -eq $before) "trans selection memory kept while off"

# enable trans mode
$p3 = Rebuild $true
Check ($p3.Count -eq ($banned.Count + $trans.Count)) "trans mode on adds remembered transfigured"

# deselect half transfigured, toggle off/on memory
$half = [Math]::Floor($trans.Count / 2)
$kept = @($trans | Select-Object -First $half | ForEach-Object { $_.id })
$incT.Clear()
foreach ($id in $kept) { [void]$incT.Add($id) }
$mem = $incT.Count
$null = Rebuild $false
Check ($incT.Count -eq $mem) "memory survives rebuild with mode off"
$p4 = Rebuild $true
Check ($p4.Count -eq ($banned.Count + $mem)) "mode on restores remembered subset ($mem)"

if ($fail) { exit 1 }
Write-Output "ALL PASS"
exit 0
