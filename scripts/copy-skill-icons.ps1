# Prefer skill icons extracted from local PoE install; CDN fallback only for misses.
# Progress: tmp/screens/icon-download-progress.json and icon-copy.log

$SkipCdn = $true  # local install is primary; set $false to fill remaining from ggpk.exposed
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$extractRoot = Join-Path $root 'tmp\screens\poe-skillicons-raw'
$outDir = Join-Path $root 'roulette\assets\icons\skills'
$progressPath = Join-Path $root 'tmp\screens\icon-download-progress.json'
$logPath = Join-Path $root 'tmp\screens\icon-copy.log'
$iconsPath = Join-Path $root 'roulette\data\skill-icons.json'
$skillsPath = Join-Path $root 'roulette\data\skills.json'

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Add-Type -AssemblyName System.Web.Extensions
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = [int]::MaxValue

$skillsDoc = $ser.DeserializeObject([IO.File]::ReadAllText($skillsPath))
$oldIcons = $ser.DeserializeObject([IO.File]::ReadAllText($iconsPath))
$gems = $ser.DeserializeObject([IO.File]::ReadAllText("$env:TEMP\poe_gems_full.min.json"))
$items = $ser.DeserializeObject([IO.File]::ReadAllText("$env:TEMP\poe_base_items.min.json"))

if (-not (Test-Path $extractRoot)) {
  throw "Missing extracted icons at $extractRoot. Run poe_data_tools dump-art first."
}

$localByStem = @{}
Get-ChildItem $extractRoot -Recurse -Filter '*.png' | ForEach-Object {
  $rel = $_.FullName.Substring($extractRoot.Length).ToLower().Replace('\', '/')
  if ($rel -match '/passives/') { return }
  $stem = $_.BaseName.ToLower()
  if (-not $localByStem.ContainsKey($stem)) { $localByStem[$stem] = $_.FullName }
}
Write-Host "Indexed $($localByStem.Count) local skill icons"

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
    $n = ($n -replace '\.(webp|png|dds)$', '').ToLowerInvariant()
    if ($n -and -not $names.Contains($n)) { [void]$names.Add($n) }
  }

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
      & $add ($stem -replace 'gem$', '' -replace 'skillgem$', '')
    }
  }
  $compact = ($display -replace '[^A-Za-z0-9]', '').ToLowerInvariant()
  & $add $compact
  & $add ("icon" + $compact)
  $cleanId = $id -replace '_alt_[xyz]$', ''
  $pascal = (($cleanId -split '_' | ForEach-Object {
        if ($_.Length) { $_.Substring(0, 1).ToUpper() + $_.Substring(1) }
      }) -join '').ToLowerInvariant()
  & $add $pascal
  & $add ("icon" + $pascal)
  return , $names.ToArray()
}

# Filenames in client bundles often don't match skill ids (auras/totems/warcries).
$aliasById = @{
  'anger' = 'aurafire'; 'hatred' = 'auracold'; 'wrath' = 'auralightning'
  'haste' = 'auraspeed'; 'grace' = 'auraevasion'; 'determination' = 'auraarmour'
  'discipline' = 'auraenergy'; 'clarity' = 'auramana'; 'vitality' = 'auraregen'
  'purity_of_fire' = 'aurafireresist'; 'purity_of_ice' = 'auracoldresist'
  'purity_of_lightning' = 'auralightningresist'; 'purity_of_elements' = 'auraresist'
  'precision' = 'auracrit'; 'malevolence' = 'auradamage'; 'zealotry' = 'spelldamageaura'
  'ancestral_protector' = 'slamancestortotem'; 'ancestral_warchief' = 'slashancestortotem'
  'ancestral_cry' = 'warcryancestral'; 'enduring_cry' = 'warcryenduring'
  'intimidating_cry' = 'warcryintimidating'; 'infernal_cry' = 'warcryinfernal'
  'seismic_cry' = 'warcrygenerals'; 'battlemage_cry' = 'warcrygenerals'
  'ambush' = 'ambushicon'; 'ambush_player' = 'ambushicon'
  'divine_ire' = 'divinetempest'; 'holy_flame_totem' = 'flametotem'
  'siege_ballista' = 'crossbowtotem'; 'artillery_ballista' = 'mortartotemskillicon'
  'shrapnel_ballista' = 'shotguntotemskillicon'; 'decoy_totem' = 'taunttotem'
  'rejuvenation_totem' = 'liferegentotem'; 'devouring_totem' = 'devouringtotem'
  'double_strike' = 'icondoubleswing'; 'ethereal_knives' = 'shadowprojectiles'
  'eye_of_winter' = 'frozensphere'; 'perforate' = 'bloodspears'
  'flameblast' = 'chargedblast'; 'vaal_flameblast' = 'chargedblast'
  'scourge_arrow' = 'virulentarrowskillicon'; 'dominating_blow' = 'conversionstrike'
  'infernal_blow' = 'iconinnerfire'; 'pride' = 'auradamage'
  'mirror_arrow' = 'mirrorshot'; 'thunderstorm' = 'windstorm'
  'swordstorm' = 'retaliationweaponstorm'; 'steelskin' = 'immortalcall'
  'berserk' = 'bloodrage'; 'blood_and_sand' = 'bloodquicksand'
  'generals_cry' = 'warcrygenerals'; 'warlords_mark' = 'warlordsmark'
  'snipers_mark' = 'poachersmark'; 'graft_skill_tul_tornado' = 'tornado'
  'graft_skill_uulnetol_lowlife_buff' = 'commandgraftskill'
  'vaal_clarity' = 'auramana'; 'vaal_discipline' = 'auraenergy'
  'vaal_grace' = 'auraevasion'; 'vaal_haste' = 'auraspeed'
}

function Find-LocalIcon([string]$id, [string]$display, [string[]]$names) {
  $baseId = $id -replace '_alt_[xyz]$', ''
  if ($aliasById.ContainsKey($baseId) -and $localByStem.ContainsKey($aliasById[$baseId])) {
    $stem = $aliasById[$baseId]
    return @{ path = $localByStem[$stem]; stem = $stem; how = 'alias' }
  }

  foreach ($n in $names) {
    if ($localByStem.ContainsKey($n)) { return @{ path = $localByStem[$n]; stem = $n; how = 'exact' } }
  }

  $tokens = @(($id -replace '_alt_[xyz]$', '') -split '_' | Where-Object { $_.Length -ge 3 } | ForEach-Object { $_.ToLowerInvariant() })
  $compact = ($display -replace '[^A-Za-z0-9]', '').ToLowerInvariant()
  $bestStem = $null
  $bestScore = 0

  foreach ($stem in @($localByStem.Keys)) {
    $score = 0
    if ($compact -and $stem -eq $compact) { $score += 20 }
    if ($compact -and $stem -eq ("icon" + $compact)) { $score += 20 }
    if ($compact.Length -ge 5 -and $stem.Contains($compact)) { $score += 10 }
    $hit = 0
    foreach ($t in $tokens) {
      if ($stem.Contains($t)) { $hit++; $score += 3 }
    }
    if ($tokens.Count -gt 0 -and $hit -eq $tokens.Count) { $score += 8 }
    $score = $score * 100 - $stem.Length
    if ($score -gt $bestScore) {
      $bestScore = $score
      $bestStem = $stem
    }
  }

  if ($bestStem -and $bestScore -ge 280) {
    return @{ path = $localByStem[$bestStem]; stem = $bestStem; how = 'fuzzy' }
  }
  return $null
}

function Try-CdnDownload([string[]]$names, [string]$destAbs) {
  # Only try a few high-probability names with a short timeout (avoid hanging the run).
  $try = @($names | Select-Object -First 4)
  foreach ($n in $try) {
    $url = "https://image.ggpk.exposed/poe1/Art/2DArt/SkillIcons/$n.dds?format=png"
    try {
      $req = [System.Net.HttpWebRequest]::Create($url)
      $req.Method = 'GET'
      $req.Timeout = 2500
      $req.ReadWriteTimeout = 2500
      $req.UserAgent = 'poe-roulette-icon-fetch/1.0'
      $resp = $req.GetResponse()
      try {
        $ms = New-Object System.IO.MemoryStream
        $resp.GetResponseStream().CopyTo($ms)
        $bytes = $ms.ToArray()
        if ($bytes.Length -gt 200) {
          [IO.File]::WriteAllBytes($destAbs, $bytes)
          return $n
        }
      } finally { $resp.Close() }
    } catch {}
  }
  return $null
}

$results = @{}
$all = @($skillsDoc['skills'])
$ordered = @($all | Where-Object { $_['variant'] -ne 'transfigured' }) +
  @($all | Where-Object { $_['variant'] -eq 'transfigured' })

$total = $ordered.Count
$okLocal = 0; $okCdn = 0; $fail = 0; $i = 0
'' | Set-Content $logPath -Encoding UTF8

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

  $destRel = "assets/icons/skills/$id.png"
  $destAbs = Join-Path $root ($destRel -replace '/', '\')
  $names = Get-NameCandidates $id $display $meta $oldIcons[$id]
  $hit = Find-LocalIcon $id $display $names
  $skillPath = $null
  $source = 'MISS'

  if ($hit) {
    Copy-Item -Force $hit.path $destAbs
    $skillPath = $destRel
    $source = "local:$($hit.how):$($hit.stem)"
    $okLocal++
  } elseif ($id -match '^(.*)_alt_[xyz]$') {
    $baseId = $Matches[1]
    if ($results.ContainsKey($baseId) -and $results[$baseId].skill) {
      $baseAbs = Join-Path $root ($results[$baseId].skill -replace '/', '\')
      if (Test-Path $baseAbs) {
        Copy-Item -Force $baseAbs $destAbs
        $skillPath = $destRel
        $source = 'base'
        $okLocal++
      }
    }
  }

  if (-not $skillPath -and -not $SkipCdn) {
    $cdnName = Try-CdnDownload $names $destAbs
    if ($cdnName) {
      $skillPath = $destRel
      $source = "cdn:$cdnName"
      $okCdn++
    } else {
      $fail++
    }
  } elseif (-not $skillPath) {
    $fail++
  }

  $results[$id] = @{ gem = $gemUrl; skill = $skillPath }
  $line = "[$i/$total] $id ($source) -> $(if ($skillPath) { $skillPath } else { 'MISS' })"
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  if (($i % 20) -eq 0 -or $source -like 'MISS*' -or $source -like 'cdn*') {
    Write-Host $line
  }
  $prog = @{
    done = $i; total = $total; okLocal = $okLocal; okCdn = $okCdn; fail = $fail
    current = $id; updatedAt = (Get-Date).ToString('o')
  }
  [IO.File]::WriteAllText($progressPath, ($prog | ConvertTo-Json -Compress))
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('{')
$first = $true
foreach ($sk in $all) {
  $id = [string]$sk['id']
  $r = $results[$id]
  if (-not $first) { [void]$sb.Append(',') }
  $first = $false
  $gemJson = if ($r.gem) { '"' + $r.gem + '"' } else { 'null' }
  $skillJson = if ($r.skill) { '"' + $r.skill + '"' } else { 'null' }
  [void]$sb.Append(('"{0}":{{"gem":{1},"skill":{2}}}' -f $id, $gemJson, $skillJson))
}
[void]$sb.Append('}')
[IO.File]::WriteAllText($iconsPath, $sb.ToString())

$summary = "DONE local=$okLocal cdn=$okCdn fail=$fail total=$total files=$((Get-ChildItem $outDir -File).Count)"
Add-Content -Path $logPath -Value $summary -Encoding UTF8
Write-Host $summary
@('vigilant_strike', 'fireball', 'barrage', 'divine_ire', 'arc_alt_x', 'ancestral_cry', 'ambush') | ForEach-Object {
  if ($results.ContainsKey($_)) { Write-Host ("{0}: {1}" -f $_, ($results[$_] | ConvertTo-Json -Compress)) }
}
