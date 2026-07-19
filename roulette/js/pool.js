import { els, state } from "./state.js";
import { baseIdFromSkill } from "./format.js";
import { createGemArtRenderer } from "./gem-art.js";
import { renderGemCard } from "./gem-tooltip.js";
import {
  initAscendancyInclusion,
  syncAscendancyRollBar,
} from "./ascendancy-pool.js";

export function buildTransfiguredIndex(allSkills) {
  const map = new Map();
  for (const skill of allSkills) {
    if (skill.variant !== "transfigured" || !skill.dealsDamage) continue;
    const baseId = baseIdFromSkill(skill);
    if (!map.has(baseId)) map.set(baseId, []);
    map.get(baseId).push(skill);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

export function getVersionsForSkill(skill) {
  const baseId = baseIdFromSkill(skill);
  const baseSkill =
    state.allSkills.find(
      (entry) => entry.id === baseId && entry.variant === "base"
    ) || (skill.variant === "base" ? skill : null);
  const transfigured = state.transfiguredByBaseId.get(baseId) || [];
  const versions = [];
  if (baseSkill) versions.push(baseSkill);
  versions.push(...transfigured);
  const seen = new Set();
  return versions.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function hideVariants() {
  if (!els.skillVariants || !els.skillVariantsList) return;
  els.skillVariants.hidden = false;
  els.skillVariantsList.replaceChildren();
  els.skillVariants.classList.add("is-empty");
  els.skillVariants.classList.remove("is-reserved", "is-fading-out", "is-open");
  els.skillVariants.style.minHeight = "";
}

export function selectSkillVersion(skill) {
  state.selectedSkillId = skill.id;
  renderGemCard(skill);
  for (const button of els.skillVariantsList.querySelectorAll(".variants__btn")) {
    button.classList.toggle("is-active", button.dataset.id === skill.id);
  }
  syncExcludeButton();
}

function buildVariantButton(version) {
  const label =
    version.variant === "base" ? `${version.name} (base)` : version.name;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "variants__btn";
  button.setAttribute("role", "tab");
  button.dataset.id = version.id;
  button.title = label;
  button.setAttribute("aria-label", label);

  const frame = document.createElement("div");
  frame.className = "gem__art-frame variants__gem";

  const sparkle = document.createElement("div");
  sparkle.className = "gem__sparkle";
  sparkle.hidden = true;
  sparkle.setAttribute("aria-hidden", "true");

  const inventory = document.createElement("img");
  inventory.className = "gem__inventory";
  inventory.alt = "";
  inventory.width = 92;
  inventory.height = 92;
  inventory.hidden = true;

  const base = document.createElement("div");
  base.className = "gem__art gem__art--base";
  base.setAttribute("aria-hidden", "true");

  const deco = document.createElement("div");
  deco.className = "gem__art gem__art--deco";
  deco.setAttribute("role", "img");

  frame.append(sparkle, inventory, base, deco);
  button.append(frame);

  const art = createGemArtRenderer(
    { frame, sparkle, inventory, base, deco },
    { alignMode: "balanced", preferSheet: true },
  );
  art.applyCardDatasets(button, version);
  art.render(version, state.iconsById);

  button.addEventListener("click", () => selectSkillVersion(version));
  return button;
}

export function mountVariantButtons(versions, activeId) {
  if (!els.skillVariants || !els.skillVariantsList) return;

  els.skillVariantsList.replaceChildren();
  for (const version of versions) {
    els.skillVariantsList.append(buildVariantButton(version));
  }

  els.skillVariants.hidden = false;
  els.skillVariants.classList.remove("is-empty");
  els.skillVariants.classList.add("is-open");
  state.selectedSkillId = activeId;
  for (const button of els.skillVariantsList.querySelectorAll(".variants__btn")) {
    button.classList.toggle("is-active", button.dataset.id === activeId);
  }
  syncExcludeButton();
}

export function showVariantsForSkill(skill, { render = true } = {}) {
  if (!skill || !els.skillVariants || !els.skillVariantsList) {
    if (render && skill) renderGemCard(skill);
    return;
  }

  // Separate-roll mode: only the landed/selected version.
  if (els.rollTransfigured?.checked) {
    mountVariantButtons([skill], skill.id);
    if (render) renderGemCard(skill);
    return;
  }

  const versions = getVersionsForSkill(skill);
  // Always keep at least the selected skill visible (no empty bar after a roll).
  if (versions.length <= 1) {
    const only = versions[0] || skill;
    mountVariantButtons([only], only.id);
    if (render) renderGemCard(only);
    return;
  }

  const active = versions.find((entry) => entry.id === skill.id) || versions[0];
  mountVariantButtons(versions, active.id);
  if (render) renderGemCard(active);
}

export function setButtonsEnabled() {
  if (els.rollAscendancy) {
    els.rollAscendancy.disabled =
      state.rolling.ascendancy || state.ascendancyPool.length === 0;
  }
  if (els.rollSkill) {
    els.rollSkill.disabled = state.rolling.skill || state.skills.length === 0;
  }
  syncExcludeButton();
  syncAscendancyRollBar();
}

/** Pool membership ids to remove for the current selection. */
function exclusionIdsForSelection(skillId) {
  const skill = state.allSkills.find((entry) => entry.id === skillId);
  if (!skill) return skillId ? [skillId] : [];
  // Separate-roll mode: exclude the exact gem. Otherwise exclude the base pool entry.
  if (els.rollTransfigured?.checked) return [skillId];
  return [baseIdFromSkill(skill)];
}

function isIncludedInAnySet(id) {
  return (
    state.includedDamageIds.has(id) ||
    state.includedBannedIds.has(id) ||
    state.includedTransfiguredIds.has(id)
  );
}

function uncheckFilterInputs(ids) {
  for (const id of ids) {
    for (const list of [els.filterList, els.bannedList, els.transfiguredList]) {
      const input = list?.querySelector(`input[value="${CSS.escape(id)}"]`);
      if (input) input.checked = false;
    }
  }
}

/** Show the split bar after the first finished roll, and enable Exclude and Roll. */
export function syncExcludeButton() {
  const bar = els.skillRollBar;
  const btn = els.excludeAndRoll;
  const slot = els.excludeAndRollSlot;
  if (!bar || !btn) return;

  const ids = exclusionIdsForSelection(state.selectedSkillId);
  const stillInPool =
    ids.length > 0 && ids.some((id) => isIncludedInAnySet(id));
  // Need at least one other skill left after excluding this one.
  const poolLeft = state.skills.filter((skill) => !ids.includes(skill.id));
  const canExcludeAndRoll =
    !state.rolling.skill &&
    !!state.selectedSkillId &&
    stillInPool &&
    poolLeft.length > 0;

  if (state.selectedSkillId && !bar.classList.contains("is-split")) {
    slot?.setAttribute("aria-hidden", "false");
    // Double rAF so the collapsed → half expansion transitions from a painted start.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bar.classList.add("is-split");
      });
    });
  }

  btn.disabled = !canExcludeAndRoll;
}

/**
 * Remove the current skill from the roll pool (and skill-filter checkboxes).
 * @returns {boolean} true if anything was excluded
 */
export function excludeSelectedFromPool() {
  const ids = exclusionIdsForSelection(state.selectedSkillId);
  if (!ids.length || state.rolling.skill) return false;

  let removed = false;
  for (const id of ids) {
    if (state.includedDamageIds.delete(id)) removed = true;
    if (state.includedBannedIds.delete(id)) removed = true;
    if (state.includedTransfiguredIds.delete(id)) removed = true;
  }
  if (!removed) {
    syncExcludeButton();
    return false;
  }

  uncheckFilterInputs(ids);
  rebuildSkillPool();
  syncExcludeButton();
  return true;
}

/**
 * Sole writer of state.skills (the roll pool).
 * Filters mutate inclusion sets, then call this.
 * Reel / roulette only read getRollPool() / state.skills.
 */
export function rebuildSkillPool() {
  const pool = [];

  for (const skill of state.damageSkills) {
    if (state.includedDamageIds.has(skill.id)) pool.push(skill);
  }
  for (const skill of state.bannedSkills) {
    if (state.includedBannedIds.has(skill.id)) pool.push(skill);
  }
  if (els.rollTransfigured?.checked) {
    for (const skill of state.transfiguredSkills) {
      if (state.includedTransfiguredIds.has(skill.id)) pool.push(skill);
    }
  }

  state.skills = pool;
  setButtonsEnabled();

  if (els.skillPoolCount) {
    const n = pool.length;
    els.skillPoolCount.textContent = n === 1 ? "1 in pool" : `${n} in pool`;
  }
}

/** Read-only roll pool for reel / roulette. */
export function getRollPool() {
  return state.skills;
}

export async function loadData() {
  const [
    charactersRes,
    skillsRes,
    detailsRes,
    iconsRes,
    ascendancyIconsRes,
    ascendancyCirclesRes,
    ascendancyFlavourRes,
  ] = await Promise.all([
    fetch("data/characters.json"),
    fetch("data/skills.json"),
    fetch("data/skill-details.json"),
    fetch("data/skill-icons.json"),
    fetch("data/ascendancy-icons.json"),
    fetch("data/ascendancy-circles.json"),
    fetch("data/ascendancy-flavour.json"),
  ]);

  if (
    ![
      charactersRes,
      skillsRes,
      detailsRes,
      iconsRes,
      ascendancyIconsRes,
      ascendancyCirclesRes,
      ascendancyFlavourRes,
    ].every((res) => res.ok)
  ) {
    throw new Error("Could not load game data.");
  }

  const charactersData = await charactersRes.json();
  const skillsData = await skillsRes.json();
  const detailsData = await detailsRes.json();
  const iconsData = await iconsRes.json();
  state.ascendancyIconsById = await ascendancyIconsRes.json();
  state.ascendancyCirclesById = await ascendancyCirclesRes.json();
  state.ascendancyFlavourById = await ascendancyFlavourRes.json();

  state.ascendancies = charactersData.ascendancies;
  state.damageSkills = skillsData.damageSkills;
  state.bannedSkills = skillsData.bannedSkills;
  state.allSkills = skillsData.skills;
  state.detailsById = detailsData.skills;
  state.iconsById = iconsData;
  state.transfiguredByBaseId = buildTransfiguredIndex(skillsData.skills);
  state.transfiguredSkills = skillsData.skills
    .filter((skill) => skill.variant === "transfigured" && skill.dealsDamage)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  state.includedBannedIds.clear();
  state.includedDamageIds.clear();
  state.includedTransfiguredIds.clear();
  for (const skill of state.damageSkills) {
    state.includedDamageIds.add(skill.id);
  }
  // Remembered defaults: all transfigured selected when the mode is first turned on.
  for (const skill of state.transfiguredSkills) {
    state.includedTransfiguredIds.add(skill.id);
  }

  initAscendancyInclusion();
  rebuildSkillPool();

  if (!state.ascendancies.length || !state.damageSkills.length) {
    throw new Error("Loaded data was empty.");
  }
}
