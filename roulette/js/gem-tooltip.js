import { els, state } from "./state.js";
import {
  altLetterFromId,
  baseIdFromGemId,
  createGemArtRenderer,
  isTrarthusSkill,
} from "./gem-art.js";
import {
  cleanStatText,
  formatAttackSpeed,
  formatCastTime,
  formatCosts,
  formatCooldown,
  formatCrit,
  formatDamageLine,
  formatEffectiveness,
  formatRequirements,
  formatTags,
  formatWeapons,
  isReminderLine,
  mergeStatTextLists,
  reminderLinesForStats,
  resolveQualityLines,
  splitPropLine,
} from "./format.js";

/** Isolated inventory-gem painter (shade / sparkle / sheet / inv). */
const gemArt = createGemArtRenderer(
  {
    frame: els.skillGemFrame,
    sparkle: els.skillGemSparkle,
    inventory: els.skillGemInventory,
    base: els.skillGemBase,
    deco: els.skillGemDeco,
  },
  { onChange: updateIconsVisibility }
);

function appendLines(container, lines, className) {
  for (const line of lines) {
    if (!line) continue;
    const item = document.createElement("p");
    item.className = className;
    if (className.includes("gem__stat--reminder")) {
      item.textContent = line;
    } else {
      fillStatLine(item, line);
    }
    container.append(item);
  }
}

/** Wrap numeric tokens in white spans (PoE magic-mod style). */
function fillStatLine(el, line) {
  const tokenRe =
    /\+?(?:\(-?\d+(?:\.\d+)?(?:\s*[–—−-]\s*-?\d+(?:\.\d+)?)?\)|-?\d+(?:\.\d+)?(?:\s*[–—−-]\s*-?\d+(?:\.\d+)?)?)%?/g;

  let last = 0;
  let match;
  while ((match = tokenRe.exec(line)) !== null) {
    if (match.index > last) {
      el.append(document.createTextNode(line.slice(last, match.index)));
    }
    const num = document.createElement("span");
    num.className = "gem__stat-num";
    num.textContent = match[0];
    el.append(num);
    last = match.index + match[0].length;
  }
  if (last < line.length) {
    el.append(document.createTextNode(line.slice(last)));
  }
  if (!el.childNodes.length) {
    el.textContent = line;
  }
}

function appendProp(container, text) {
  if (!text) return;
  for (const part of text.split("\n")) {
    const line = document.createElement("p");
    const { label, value } = splitPropLine(part);
    const labelEl = document.createElement("span");
    labelEl.className = "gem__label";
    labelEl.textContent = label;
    line.append(labelEl);
    if (value) {
      line.append(document.createTextNode(" "));
      const valueEl = document.createElement("span");
      valueEl.className = "gem__value";
      valueEl.textContent = value;
      line.append(valueEl);
    }
    container.append(line);
  }
}

/** "Requires …" stays grey; level/attr values are white (PoEDB colourDefault). */
function setRequiresLine(el, text) {
  el.replaceChildren();
  if (!text) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const prefix = "Requires ";
  if (!text.startsWith(prefix)) {
    el.textContent = text;
    return;
  }
  const label = document.createElement("span");
  label.className = "gem__label";
  label.textContent = prefix;
  const value = document.createElement("span");
  value.className = "gem__value";
  value.textContent = text.slice(prefix.length);
  el.append(label, value);
}

function updateIconsVisibility() {
  if (!els.skillIcons) return;
  const skillVisible = els.skillBarIcon && !els.skillBarIcon.hidden;
  els.skillIcons.hidden = !skillVisible;
}

function skillIconCandidates(entry, skillId) {
  const raw = entry?.skill;
  let list = Array.isArray(raw) ? raw.filter(Boolean) : raw ? [raw] : [];

  if ((!list.length || list.every((u) => !u)) && skillId && /_alt_[xyz]$/.test(skillId)) {
    const baseId = baseIdFromGemId(skillId);
    const base = state.iconsById[baseId]?.skill;
    const baseList = Array.isArray(base) ? base.filter(Boolean) : base ? [base] : [];
    list = baseList;
  }

  return [...new Set(list.filter(Boolean))];
}

function setSkillBarIcon(candidates) {
  const img = els.skillBarIcon;
  if (!img) return;

  const list = [...new Set((candidates || []).filter(Boolean))];
  img.onload = null;
  img.onerror = null;

  if (!list.length) {
    img.hidden = true;
    img.removeAttribute("src");
    updateIconsVisibility();
    return;
  }

  const preferred = list.find((u) => u.startsWith("assets/")) || list[0];
  img.hidden = false;
  img.onerror = () => {
    img.hidden = true;
    img.removeAttribute("src");
    img.onerror = null;
    updateIconsVisibility();
  };
  img.onload = () => {
    img.hidden = false;
    updateIconsVisibility();
  };
  img.src = preferred;
  updateIconsVisibility();
}

function renderSkillIcons(skill) {
  // Inventory gem art lives on the variant buttons / reel — tooltip keeps skill icon only.
  gemArt.clear();
  const entry = state.iconsById[skill.id] || {};
  setSkillBarIcon(skillIconCandidates(entry, skill.id));
  if (els.skillBarIcon) els.skillBarIcon.alt = `${skill.name} skill icon`;
}

const PANEL_FADE_OUT_MS = 140;
const PANEL_FADE_IN_MS = 160;
/** Keep in sync with `.gem.is-morphing { transition: height … }` */
const PANEL_HEIGHT_MS = 380;

let gemPanelMorphToken = 0;

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clearPanelInlineStyles(...elsList) {
  for (const el of elsList) {
    if (!el) continue;
    el.style.opacity = "";
    el.style.position = "";
    el.style.left = "";
    el.style.right = "";
    el.style.top = "";
    el.style.width = "";
    el.style.visibility = "";
  }
}

/**
 * Crossfade only the middle panels. Header + foot stay in normal document flow.
 * Height is measured as real `auto` height so releasing it at the end is a no-op.
 */
function morphGemPanels(fromEl, toEl, onSwap) {
  const card = els.skillCard;
  if (!fromEl || !toEl || !card) {
    onSwap?.();
    return Promise.resolve();
  }

  if (!toEl.hidden && fromEl.hidden) {
    onSwap?.();
    return Promise.resolve();
  }

  const token = ++gemPanelMorphToken;

  const finishInstant = () => {
    fromEl.hidden = true;
    toEl.hidden = false;
    clearPanelInlineStyles(fromEl, toEl);
    card.classList.remove("is-morphing");
    card.style.height = "";
    card.style.transition = "";
    onSwap?.();
  };

  if (reducedMotion() || fromEl.hidden) {
    finishInstant();
    return Promise.resolve();
  }

  return (async () => {
    const startH = card.offsetHeight;
    card.classList.add("is-morphing");
    card.style.height = `${startH}px`;

    fromEl.style.opacity = "0";
    await wait(PANEL_FADE_OUT_MS);
    if (token !== gemPanelMorphToken) return;

    fromEl.hidden = true;
    clearPanelInlineStyles(fromEl);

    toEl.hidden = false;
    toEl.style.opacity = "0";
    onSwap?.();

    // Measure resting auto height. Do not flex-collapse the stage — that undersizes
    // by ~1px on collapse and clips the foot until height is released (visible nudge down).
    card.style.transition = "none";
    card.style.height = "auto";
    const endH = Math.max(
      Math.ceil(card.getBoundingClientRect().height),
      card.scrollHeight,
      1
    );
    card.style.height = `${startH}px`;
    void card.offsetHeight;
    card.style.transition = "";
    card.style.height = `${endH}px`;

    await wait(32);
    if (token !== gemPanelMorphToken) return;

    requestAnimationFrame(() => {
      if (token !== gemPanelMorphToken) return;
      toEl.style.opacity = "1";
    });

    await wait(Math.max(PANEL_FADE_IN_MS, PANEL_HEIGHT_MS));
    if (token !== gemPanelMorphToken) return;

    clearPanelInlineStyles(fromEl, toEl);
    // Freeze at the painted height, then release — avoids a post-collapse foot nudge.
    card.style.transition = "none";
    card.style.height = `${card.offsetHeight}px`;
    void card.offsetHeight;
    card.classList.remove("is-morphing");
    card.style.height = "";
    void card.offsetHeight;
    card.style.transition = "";
  })();
}

function playGemHeaderShine() {
  const header = els.skillCard?.querySelector(".gem__header");
  if (!header || reducedMotion()) return;

  header.classList.remove("is-shining");
  void header.offsetWidth;
  header.classList.add("is-shining");

  const onEnd = (event) => {
    if (event.target !== header || event.animationName !== "gem-header-shine") return;
    header.classList.remove("is-shining");
    header.removeEventListener("animationend", onEnd);
  };
  header.addEventListener("animationend", onEnd);
}

export function showGemWaiting({ searching = false } = {}) {
  const card = els.skillCard;
  if (!card) return Promise.resolve();

  card.querySelector(".gem__header")?.classList.remove("is-shining");
  card.classList.toggle("is-rolling", searching);
  card.dataset.color = "neutral";
  delete card.dataset.variant;
  delete card.dataset.trarthus;
  gemArt.clear();

  return morphGemPanels(els.skillBody, els.skillPlaceholder, () => {
    if (els.skillResult) {
      els.skillResult.textContent = "Skill Gem";
      els.skillResult.classList.remove("is-spinning");
    }
    card.classList.add("is-waiting");
    card.classList.remove("has-result");
  });
}

export function renderGemCard(skill) {
  const detail = state.detailsById[skill.id] || {};
  const level1 = detail.levels?.["1"] || detail.levels?.[1];
  const level20 = detail.levels?.["20"] || detail.levels?.[20];
  const card = els.skillCard;

  card.dataset.color = skill.color || "neutral";
  card.dataset.variant = skill.variant || "base";
  gemArt.applyCardDatasets(card, skill);

  renderSkillIcons(skill);

  const tags = formatTags(skill, detail);
  els.skillTags.textContent = tags.join(", ");
  els.skillTags.hidden = tags.length === 0;

  els.skillProps.replaceChildren();
  appendProp(els.skillProps, "Level: (1–20)");

  const costs = formatCosts(level1, level20);
  appendProp(els.skillProps, costs);

  const cooldown = formatCooldown(detail.cooldown ?? level1?.cooldown);
  if (cooldown) appendProp(els.skillProps, `Cooldown Time: ${cooldown}`);

  const attackSpeed = formatAttackSpeed(detail.attackSpeedMultiplier);
  if (attackSpeed) appendProp(els.skillProps, `Attack Speed: ${attackSpeed}`);

  const castTime = formatCastTime(detail.castTime);
  if (castTime && detail.castTime > 0 && detail.attackSpeedMultiplier == null) {
    appendProp(els.skillProps, `Cast Time: ${castTime}`);
  }

  const attackDamage = formatDamageLine(level1, level20);
  appendProp(els.skillProps, attackDamage);

  const effectiveness = formatEffectiveness(level1, level20);
  appendProp(els.skillProps, effectiveness);

  const crit = formatCrit(detail.critChance);
  if (crit) appendProp(els.skillProps, `Critical Strike Chance: ${crit}`);

  setRequiresLine(els.skillRequires, formatRequirements(level1, level20));

  const weapons = formatWeapons(detail.weaponRestrictions);
  if (weapons) {
    els.skillWeapons.hidden = false;
    els.skillWeapons.replaceChildren();
    const requires = document.createElement("span");
    requires.className = "gem__label";
    requires.textContent = "Requires ";
    const list = document.createElement("span");
    list.className = "gem__value";
    list.textContent = weapons;
    els.skillWeapons.append(requires, list);
  } else {
    els.skillWeapons.hidden = true;
    els.skillWeapons.replaceChildren();
  }

  els.skillDesc.textContent = detail.description || "";
  els.skillDesc.hidden = !detail.description;

  const levelStats = mergeStatTextLists(
    level1?.statText || [],
    level20?.statText || []
  ).map(cleanStatText);

  const stats = [...(detail.staticStatText || []).map(cleanStatText), ...levelStats];

  const reminders = [
    ...stats.filter(isReminderLine),
    ...reminderLinesForStats(stats, detail.description || ""),
  ];

  els.skillStats.replaceChildren();
  appendLines(
    els.skillStats,
    stats.filter((line) => !isReminderLine(line)),
    "gem__stat"
  );
  appendLines(els.skillStats, reminders, "gem__stat gem__stat--reminder");

  const quality = resolveQualityLines(detail);
  const qualitySep = els.skillBody.querySelector(".gem__sep--quality");
  if (quality.length) {
    els.skillQuality.hidden = false;
    if (qualitySep) qualitySep.hidden = false;
    els.skillQualityStats.replaceChildren();
    appendLines(els.skillQualityStats, quality, "gem__stat gem__stat--quality");
  } else {
    els.skillQuality.hidden = true;
    if (qualitySep) qualitySep.hidden = true;
    els.skillQualityStats.replaceChildren();
  }

  const revealName = !els.skillPlaceholder?.hidden;

  void morphGemPanels(els.skillPlaceholder, els.skillBody, () => {
    els.skillResult.textContent = skill.name;
    els.skillResult.classList.remove("is-spinning");
    card.classList.remove("is-waiting", "is-rolling");
    card.classList.add("has-result");
  }).then(() => {
    if (revealName) playGemHeaderShine();
  });
}

// Re-export for roulette spin dataset updates without importing shade internals.
export { altLetterFromId, isTrarthusSkill };
