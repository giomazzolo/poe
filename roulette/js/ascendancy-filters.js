/**
 * Ascendancy pool filters — character-grouped checklists in the settings dialog.
 */
import { els, state } from "./state.js";
import {
  iconPathForAscendancy,
  rebuildAscendancyPool,
} from "./ascendancy-pool.js";

const CHARACTER_ORDER = [
  "Marauder",
  "Duelist",
  "Ranger",
  "Shadow",
  "Witch",
  "Templar",
  "Scion",
];

function groupByCharacter(list) {
  const map = new Map();
  for (const name of CHARACTER_ORDER) map.set(name, []);
  for (const entry of list) {
    const key = entry.character || "Other";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  return map;
}

export function syncAscendancyFilterCount() {
  const countEl = document.getElementById("ascendancy-filter-count");
  const totalEl = document.getElementById("ascendancy-filter-total");
  const total = state.ascendancies.length;
  if (countEl) countEl.textContent = String(state.includedAscendancyIds.size);
  if (totalEl) totalEl.textContent = String(total);
}

function buildRow(entry) {
  const label = document.createElement("label");
  label.className = "ascendancy-pool__row";

  const thumb = document.createElement("img");
  thumb.className = "ascendancy-pool__thumb";
  thumb.alt = "";
  thumb.width = 88;
  thumb.height = 64;
  const src = iconPathForAscendancy(entry.id);
  if (src) thumb.src = src;
  else thumb.hidden = true;

  const caption = document.createElement("span");
  caption.className = "ascendancy-pool__caption";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = entry.id;
  input.checked = state.includedAscendancyIds.has(entry.id);

  const name = document.createElement("span");
  name.className = "ascendancy-pool__name";
  name.textContent = entry.name;

  input.addEventListener("change", () => {
    if (input.checked) state.includedAscendancyIds.add(entry.id);
    else state.includedAscendancyIds.delete(entry.id);
    rebuildAscendancyPool();
    syncAscendancyFilterCount();
  });

  caption.append(input, name);
  label.append(thumb, caption);
  return label;
}

function setAllAscendancies(include) {
  state.includedAscendancyIds.clear();
  if (include) {
    for (const entry of state.ascendancies) {
      state.includedAscendancyIds.add(entry.id);
    }
  }
  for (const input of els.ascendancyFilterList?.querySelectorAll("input[type=checkbox]") ||
    []) {
    input.checked = include;
  }
  rebuildAscendancyPool();
  syncAscendancyFilterCount();
}

export function initAscendancyFilters() {
  const host = els.ascendancyFilterList;
  if (!host) return;

  host.replaceChildren();
  const groups = groupByCharacter(state.ascendancies);

  for (const [character, entries] of groups) {
    if (!entries.length) continue;
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const section = document.createElement("section");
    section.className = "ascendancy-pool__group";
    section.setAttribute("aria-label", character);

    const title = document.createElement("h3");
    title.className = "ascendancy-pool__group-title";
    title.textContent = character;

    const rows = document.createElement("div");
    rows.className = "ascendancy-pool__rows";
    for (const entry of entries) rows.append(buildRow(entry));

    section.append(title, rows);
    host.append(section);
  }

  document
    .getElementById("ascendancy-filter-all")
    ?.addEventListener("click", () => setAllAscendancies(true));
  document
    .getElementById("ascendancy-filter-none")
    ?.addEventListener("click", () => setAllAscendancies(false));

  syncAscendancyFilterCount();
}
