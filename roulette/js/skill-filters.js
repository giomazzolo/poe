/**
 * Skill pool filter UI.
 *
 * Owns inclusion sets + calls rebuildSkillPool() whenever they change.
 * Does not talk to the reel. The reel only reads state.skills (getRollPool()).
 */
import { els, state } from "./state.js";
import { rebuildSkillPool } from "./pool.js";
import {
  altLetterFromId,
  baseIdFromGemId,
  isTrarthusSkill,
  shadedCrystalUrl,
  shadeParamsFor,
} from "./gem-shade.js";

const COLOR_GROUPS = [
  { id: "strength", label: "Strength", rank: 0 },
  { id: "dexterity", label: "Dexterity", rank: 1 },
  { id: "intelligence", label: "Intelligence", rank: 2 },
];

const COLOR_RANK = Object.fromEntries(COLOR_GROUPS.map((g) => [g.id, g.rank]));

function syncCounts() {
  if (els.filterCountNormal) {
    els.filterCountNormal.textContent = String(state.includedDamageIds.size);
  }
  if (els.filterCountPainful) {
    els.filterCountPainful.textContent = String(state.includedBannedIds.size);
  }
  if (els.filterCountTransfigured) {
    const transCount = els.rollTransfigured?.checked
      ? state.includedTransfiguredIds.size
      : 0;
    els.filterCountTransfigured.textContent = String(transCount);
  }

  const q = els.filterSearch?.value?.trim().toLowerCase() || "";
  syncSectionIncludedCounts(q);
  syncColorGroupCounts(q);
}

/** Section "N included" — uses the typed query so counts update before the list animates. */
function syncSectionIncludedCounts(q = "") {
  const sections = [
    [els.filterList, document.getElementById("standard-skills-count"), state.includedDamageIds],
    [els.bannedList, els.bannedCount, state.includedBannedIds],
    [els.transfiguredList, els.transfiguredCount, state.includedTransfiguredIds],
  ];

  for (const [list, countEl, set] of sections) {
    if (!list || !countEl) continue;
    if (!q) {
      countEl.textContent = `${set.size} included`;
      continue;
    }
    let included = 0;
    for (const item of list.querySelectorAll(".banned__item")) {
      if (!itemMatchesQuery(item, q)) continue;
      const id = item.querySelector("input")?.value;
      if (id && set.has(id)) included += 1;
    }
    countEl.textContent = `${included} included`;
  }
}

function syncColorGroupCounts(q = "") {
  for (const list of searchLists()) {
    for (const group of list.querySelectorAll(".banned__color-group")) {
      const countEl = group.querySelector(".banned__color-count");
      if (!countEl) continue;
      let visible = 0;
      for (const item of group.querySelectorAll(".banned__item")) {
        if (itemMatchesQuery(item, q)) visible += 1;
      }
      countEl.textContent = `${visible}`;
    }
  }
}

function refreshPool() {
  rebuildSkillPool();
  syncCounts();
}

function inclusionSet(which) {
  if (which === "standard") return state.includedDamageIds;
  if (which === "painful") return state.includedBannedIds;
  return state.includedTransfiguredIds;
}

function sortByName(skills) {
  return skills.slice().sort((a, b) => a.name.localeCompare(b.name));
}

function groupSkillsByColor(skills) {
  const buckets = {
    strength: [],
    dexterity: [],
    intelligence: [],
    other: [],
  };
  for (const skill of skills) {
    const key = COLOR_RANK[skill.color] != null ? skill.color : "other";
    buckets[key].push(skill);
  }
  for (const key of Object.keys(buckets)) {
    buckets[key] = sortByName(buckets[key]);
  }
  return buckets;
}

function sheetCssUrl(path) {
  try {
    return `url("${new URL(path, document.baseURI).href}")`;
  } catch {
    return `url("${path}")`;
  }
}

function resolveFilterSheet(skill) {
  const entry = state.iconsById?.[skill.id] || {};
  if (entry.gem) return entry.gem;
  const baseId = baseIdFromGemId(skill.id);
  if (baseId !== skill.id) return state.iconsById?.[baseId]?.gem || null;
  return null;
}

function applyTransfiguredShade(crystalEl, sheetUrl, skill) {
  if (isTrarthusSkill(skill)) return;
  const alt = altLetterFromId(skill.id);
  if ((alt !== "x" && alt !== "y") || !shadeParamsFor(skill.color, alt)) return;

  shadedCrystalUrl(sheetUrl, skill.color, alt).then((crystalUrl) => {
    if (!crystalUrl || !crystalEl.isConnected) return;
    crystalEl.classList.add("is-shaded");
    crystalEl.style.backgroundImage = `url("${crystalUrl}")`;
  });
}

function appendSparkle(el) {
  const sparkle = document.createElement("span");
  sparkle.className = "banned__item-icon-sparkle";
  sparkle.setAttribute("aria-hidden", "true");
  el.prepend(sparkle);
}

function makeSheetIcon(sheetUrl, skill = null) {
  const el = document.createElement("div");
  el.className = "banned__item-icon banned__item-icon--sheet";
  el.setAttribute("aria-hidden", "true");
  el.style.setProperty("--gem-sheet", sheetCssUrl(sheetUrl));

  const crystal = document.createElement("span");
  crystal.className = "banned__item-icon-layer banned__item-icon-layer--base";

  const deco = document.createElement("span");
  deco.className = "banned__item-icon-layer banned__item-icon-layer--deco";

  el.append(crystal, deco);

  if (skill) {
    if (isTrarthusSkill(skill)) appendSparkle(el);
    else applyTransfiguredShade(crystal, sheetUrl, skill);
  }

  return el;
}

/** Crystal-only gem sheet cell for a color-group header (no decoration). */
function colorBaseGemMark(skills) {
  const el = document.createElement("span");
  el.className = "banned__color-gem";
  el.setAttribute("aria-hidden", "true");

  for (const skill of skills) {
    const gem = resolveFilterSheet(skill);
    if (!gem) continue;
    el.style.setProperty("--gem-sheet", sheetCssUrl(gem));
    if (isTrarthusSkill(skill)) appendSparkle(el);
    else applyTransfiguredShade(el, gem, skill);
    break;
  }

  return el;
}

function filterGemIcon(skill) {
  const sheetUrl = resolveFilterSheet(skill);
  if (sheetUrl) return makeSheetIcon(sheetUrl, skill);

  const entry = state.iconsById?.[skill.id] || {};
  const baseEntry =
    /_alt_[xyz]$/.test(skill.id)
      ? state.iconsById?.[baseIdFromGemId(skill.id)] || {}
      : {};
  const inv = entry.inv || baseEntry.inv || null;

  if (inv) {
    const img = document.createElement("img");
    img.className = "banned__item-icon";
    img.alt = "";
    img.width = 48;
    img.height = 48;
    img.loading = "lazy";
    img.decoding = "async";
    img.src = inv;
    img.addEventListener("error", () => {
      img.hidden = true;
    });
    return img;
  }

  return null;
}

function buildSkillRow(skill, set) {
  const label = document.createElement("label");
  label.className = "banned__item";
  label.dataset.name = skill.name.toLowerCase();
  label.dataset.color = skill.color || "neutral";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = skill.id;
  input.checked = set.has(skill.id);
  input.addEventListener("change", () => {
    if (input.checked) set.add(skill.id);
    else set.delete(skill.id);
    refreshPool();
  });

  label.append(input);
  const gemIcon = filterGemIcon(skill);
  if (gemIcon) label.append(gemIcon);

  const text = document.createElement("span");
  text.textContent = skill.name;
  label.append(text);
  return label;
}

function renderChecklist(container, skills, which) {
  if (!container) return;
  container.replaceChildren();
  const set = inclusionSet(which);
  const grouped = groupSkillsByColor(skills);

  const groups = [
    ...COLOR_GROUPS,
    { id: "other", label: "Other", rank: 9 },
  ];

  for (const group of groups) {
    const list = grouped[group.id] || [];
    if (!list.length) continue;

    const section = document.createElement("section");
    section.className = "banned__color-group";
    section.dataset.color = group.id;

    const head = document.createElement("div");
    head.className = "banned__color-head";

    const gemMark = colorBaseGemMark(list);

    const title = document.createElement("span");
    title.className = "banned__color-label";
    title.textContent = group.label;

    const count = document.createElement("span");
    count.className = "banned__color-count";
    count.textContent = `${list.length}`;

    head.append(gemMark, title, count);

    const rows = document.createElement("div");
    rows.className = "banned__color-list";
    for (const skill of list) {
      rows.append(buildSkillRow(skill, set));
    }

    section.append(head, rows);
    container.append(section);
  }
}

const SEARCH_DEBOUNCE_MS = 100;
const SEARCH_FADE_MS = 150;
const SEARCH_HEIGHT_MS = 200;

let searchTimer = null;
let searchAnimToken = 0;

function searchLists() {
  return [els.filterList, els.bannedList, els.transfiguredList].filter(Boolean);
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function itemMatchesQuery(item, q) {
  return !q || (item.dataset.name || "").includes(q);
}

function isSearchHidden(item) {
  return item.classList.contains("is-search-hidden") || item.hidden;
}

function commitGroupVisibility(group) {
  let visible = 0;
  for (const item of group.querySelectorAll(".banned__item")) {
    if (!isSearchHidden(item)) visible += 1;
  }
  group.classList.toggle("is-search-hidden", visible === 0);
  group.hidden = visible === 0;
  const countEl = group.querySelector(".banned__color-count");
  if (countEl) countEl.textContent = `${visible}`;
  return visible;
}

function applySearchFilterInstant(query = "") {
  const q = query.trim().toLowerCase();

  for (const list of searchLists()) {
    list.style.height = "";
    list.style.overflow = "";
    list.style.transition = "";
    list.classList.remove("is-search-animating");

    for (const group of list.querySelectorAll(".banned__color-group")) {
      for (const item of group.querySelectorAll(".banned__item")) {
        const hide = !itemMatchesQuery(item, q);
        item.classList.remove("is-search-leaving", "is-search-preenter");
        item.classList.toggle("is-search-hidden", hide);
        item.hidden = hide;
      }
      commitGroupVisibility(group);
    }
  }

  syncCounts();
}

async function animateListSearch(list, q) {
  const items = [...list.querySelectorAll(".banned__item")];
  const willHide = [];
  const willShow = [];

  for (const item of items) {
    const match = itemMatchesQuery(item, q);
    const hidden = isSearchHidden(item);
    if (!match && !hidden) willHide.push(item);
    if (match && hidden) willShow.push(item);
  }

  if (!willHide.length && !willShow.length) {
    for (const group of list.querySelectorAll(".banned__color-group")) {
      commitGroupVisibility(group);
    }
    return;
  }

  const startH = list.getBoundingClientRect().height;
  list.classList.add("is-search-animating");
  list.style.height = `${startH}px`;
  list.style.overflow = "hidden";

  for (const item of willShow) {
    item.hidden = false;
    item.classList.remove("is-search-hidden");
    item.classList.add("is-search-preenter");
  }

  void list.offsetHeight;

  for (const item of willHide) item.classList.add("is-search-leaving");
  for (const item of willShow) item.classList.remove("is-search-preenter");

  if (!reducedMotion()) await wait(SEARCH_FADE_MS);

  for (const item of willHide) {
    item.classList.add("is-search-hidden");
    item.classList.remove("is-search-leaving");
    item.hidden = true;
  }

  for (const group of list.querySelectorAll(".banned__color-group")) {
    commitGroupVisibility(group);
  }

  list.style.height = "auto";
  const endH = list.getBoundingClientRect().height;
  list.style.height = `${startH}px`;
  void list.offsetHeight;
  list.style.transition = `height ${SEARCH_HEIGHT_MS}ms ease`;
  list.style.height = `${endH}px`;

  if (!reducedMotion()) await wait(SEARCH_HEIGHT_MS);

  list.style.height = "";
  list.style.overflow = "";
  list.style.transition = "";
  list.classList.remove("is-search-animating");
}

async function applySearchAnimated(query = "") {
  const token = ++searchAnimToken;
  const q = query.trim().toLowerCase();

  if (reducedMotion()) {
    if (token !== searchAnimToken) return;
    applySearchFilterInstant(query);
    return;
  }

  await Promise.all(searchLists().map((list) => animateListSearch(list, q)));
  if (token !== searchAnimToken) return;
  syncCounts();
}

function applySearch(query = "", { immediate = false } = {}) {
  window.clearTimeout(searchTimer);
  searchTimer = null;

  // Counts follow the typed query immediately; list animation stays debounced.
  syncCounts();

  if (immediate) {
    searchAnimToken += 1;
    els.filterSearch?.classList.remove("is-search-pending");
    applySearchFilterInstant(query);
    return;
  }

  els.filterSearch?.classList.add("is-search-pending");
  searchTimer = window.setTimeout(() => {
    searchTimer = null;
    els.filterSearch?.classList.remove("is-search-pending");
    applySearchAnimated(query);
  }, SEARCH_DEBOUNCE_MS);
}

/** Section "N included" counts for skills currently matching the search. */
function syncVisibleSectionCounts() {
  syncSectionIncludedCounts(els.filterSearch?.value?.trim().toLowerCase() || "");
}

function renderPanels() {
  renderChecklist(els.filterList, state.damageSkills, "standard");
  renderChecklist(els.bannedList, state.bannedSkills, "painful");
  renderChecklist(els.transfiguredList, state.transfiguredSkills, "transfigured");
  applySearch(els.filterSearch?.value || "", { immediate: true });
}

export function setAllFiltered(included) {
  setSectionInclusion(els.filterList, state.includedDamageIds, included);
}

export function setAllBanned(included) {
  setSectionInclusion(els.bannedList, state.includedBannedIds, included);
}

export function setAllTransfigured(included) {
  setSectionInclusion(els.transfiguredList, state.includedTransfiguredIds, included);
}

/**
 * Include/exclude skills in a section. Respects the search box: only matching
 * (visible) rows are changed when a filter is active.
 */
function setSectionInclusion(list, set, included) {
  if (!list || !set) return;

  const q = els.filterSearch?.value?.trim().toLowerCase() || "";

  for (const item of list.querySelectorAll(".banned__item")) {
    if (q && !itemMatchesQuery(item, q)) continue;
    const input = item.querySelector("input");
    if (!input) continue;
    input.checked = included;
    if (included) set.add(input.value);
    else set.delete(input.value);
  }

  refreshPool();
}

/** Show/hide the transfigured filter box with a height transition. */
export function syncTransfiguredFilterVisibility() {
  const shell =
    document.getElementById("transfigured-filter-shell") ||
    els.transfiguredFilter ||
    document.getElementById("transfigured-filter");
  if (!shell) return;

  const wantOpen = Boolean(els.rollTransfigured?.checked);
  const section =
    els.transfiguredFilter || document.getElementById("transfigured-filter");

  if (shell.id === "transfigured-filter-shell") {
    const isOpen = shell.classList.contains("is-open");
    shell.setAttribute("aria-hidden", wantOpen ? "false" : "true");
    if (wantOpen) section?.removeAttribute("inert");
    else section?.setAttribute("inert", "");

    if (wantOpen === isOpen) return;

    if (wantOpen) {
      // Force a closed frame before opening so the transition always runs.
      shell.classList.remove("is-open");
      void shell.offsetHeight;
      shell.classList.add("is-open");
    } else {
      shell.classList.remove("is-open");
    }
    return;
  }

  // Legacy fallback (no reveal shell).
  shell.hidden = !wantOpen;
}

export function syncPoolCounts() {
  syncCounts();
}

export function initSkillFilters() {
  els.filterList = document.getElementById("filter-list");
  els.bannedList = document.getElementById("banned-list");
  els.transfiguredList = document.getElementById("transfigured-list");
  els.filterCountNormal = document.getElementById("filter-count-normal");
  els.filterCountPainful = document.getElementById("filter-count-painful");
  els.filterCountTransfigured = document.getElementById("filter-count-transfigured");
  els.bannedCount = document.getElementById("banned-count");
  els.transfiguredCount = document.getElementById("transfigured-count");
  els.transfiguredFilter = document.getElementById("transfigured-filter");
  els.filterSearch = document.getElementById("filter-search");

  renderPanels();
  syncTransfiguredFilterVisibility();

  document.getElementById("filter-all")?.addEventListener("click", () => setAllFiltered(true));
  document.getElementById("filter-none")?.addEventListener("click", () => setAllFiltered(false));
  document.getElementById("banned-all")?.addEventListener("click", () => setAllBanned(true));
  document.getElementById("banned-none")?.addEventListener("click", () => setAllBanned(false));
  document
    .getElementById("transfigured-all")
    ?.addEventListener("click", () => setAllTransfigured(true));
  document
    .getElementById("transfigured-none")
    ?.addEventListener("click", () => setAllTransfigured(false));
  els.filterSearch?.addEventListener("input", () => applySearch(els.filterSearch.value));
}
