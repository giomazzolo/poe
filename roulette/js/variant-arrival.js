/**
 * Variant arrival choreography:
 * reserve slots → gem descends from reel → splits into ordered variants.
 * Re-roll: reverse merge → ascend into reel, then the spin can start.
 */
import { els, state } from "./state.js";
import { createGemArtRenderer } from "./gem-art.js";
import { getVersionsForSkill, mountVariantButtons } from "./pool.js";

const DESCEND_MS = 400;
const SPLIT_MS = 320;
const EXPAND_MS = 400;
const FADE_OUT_MS = 280;
/** Re-roll reverse: quick merge then climb back into the reel. */
const MERGE_MS = 150;
const ASCEND_MS = 180;

/** Live gem tile size (CSS may shrink on mobile — never hardcode 92 for layout). */
function flyerSize() {
  const probe =
    document.querySelector(".skill-reel__cell") ||
    document.querySelector(".variants__btn");
  if (probe) {
    const width = Number.parseFloat(getComputedStyle(probe).width);
    if (Number.isFinite(width) && width > 0) return width;
  }
  return 92;
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Versions shown after a roll.
 * @param {object} skill
 * @param {boolean} [separateTrans] frozen at roll start — ignore live checkbox toggles mid-roll
 */
export function versionsForReveal(skill, separateTrans = els.rollTransfigured?.checked) {
  if (!skill) return [];
  if (separateTrans) return [skill];
  const versions = getVersionsForSkill(skill);
  if (versions.length <= 1) return [versions[0] || skill];
  return versions;
}

function clearFlyers() {
  for (const node of document.querySelectorAll(".variant-flyer")) node.remove();
}

/** Host for flyers — panel-relative so positions survive scroll / row expand. */
function flyerHost() {
  return document.querySelector(".gem-panel") || document.body;
}

/** Convert a viewport rect into coordinates relative to the flyer host. */
function toHostRect(clientRect, host = flyerHost()) {
  const hostBox = host.getBoundingClientRect();
  return {
    left: clientRect.left - hostBox.left + host.scrollLeft,
    top: clientRect.top - hostBox.top + host.scrollTop,
    width: clientRect.width,
    height: clientRect.height,
  };
}

function skillFromId(id) {
  if (!id) return null;
  return (
    state.allSkills.find((skill) => skill.id === id) ||
    state.skills.find((skill) => skill.id === id) ||
    state.transfiguredSkills.find((skill) => skill.id === id) ||
    null
  );
}

function findReturnCell() {
  const track = els.skillReelTrack;
  if (!track) return null;
  return (
    track.querySelector(".skill-reel__cell.is-departing") ||
    track.querySelector(".skill-reel__cell.is-winner") ||
    null
  );
}

function hostReelReturnRect(host = flyerHost()) {
  const size = flyerSize();
  const cell = findReturnCell();
  if (cell) return hostSlotRect(cell, host);
  const viewport = els.skillReel?.querySelector(".skill-reel__viewport");
  if (!viewport) {
    return { left: 0, top: 0, width: size, height: size };
  }
  const box = toHostRect(viewport.getBoundingClientRect(), host);
  return {
    left: box.left + box.width / 2 - size / 2,
    top: box.top + (box.height - size) / 2,
    width: size,
    height: size,
  };
}

function buildFlyer(skill) {
  const flyer = document.createElement("div");
  flyer.className = "variant-flyer";
  flyer.setAttribute("aria-hidden", "true");

  const frame = document.createElement("div");
  frame.className = "gem__art-frame variants__gem";

  const sparkle = document.createElement("div");
  sparkle.className = "gem__sparkle";
  sparkle.hidden = true;

  const inventory = document.createElement("img");
  inventory.className = "gem__inventory";
  inventory.alt = "";
  inventory.width = 92;
  inventory.height = 92;
  inventory.hidden = true;

  const base = document.createElement("div");
  base.className = "gem__art gem__art--base";

  const deco = document.createElement("div");
  deco.className = "gem__art gem__art--deco";

  frame.append(sparkle, inventory, base, deco);
  flyer.append(frame);
  flyerHost().append(flyer);

  const art = createGemArtRenderer(
    { frame, sparkle, inventory, base, deco },
    { alignMode: "balanced", preferSheet: true },
  );
  art.applyCardDatasets(flyer, skill);
  art.render(skill, state.iconsById);
  return flyer;
}

function placeFlyer(flyer, rect) {
  const size = rect.width || flyerSize();
  flyer.style.left = `${rect.left}px`;
  flyer.style.top = `${rect.top}px`;
  flyer.style.width = `${size}px`;
  flyer.style.height = `${rect.height || size}px`;
  flyer.style.transform = "translate(0, 0) scale(1)";
}

/** Layout box center as a gem-size rect in host coordinates (ignores CSS transform scale). */
function hostSlotRect(el, host = flyerHost()) {
  const size = flyerSize();
  const rect = el.getBoundingClientRect();
  const box = toHostRect(rect, host);
  return {
    left: box.left + (box.width - size) / 2,
    top: box.top + (box.height - size) / 2,
    width: size,
    height: size,
  };
}

function hostListCenter(list, host = flyerHost()) {
  const size = flyerSize();
  const box = toHostRect(list.getBoundingClientRect(), host);
  return {
    left: box.left + box.width / 2 - size / 2,
    top: box.top + Math.max(0, (Math.max(box.height, size) - size) / 2),
    width: size,
    height: size,
  };
}

function animateFlyerTo(flyer, fromRect, toRect, duration) {
  const dx = toRect.left - fromRect.left;
  const dy = toRect.top - fromRect.top;
  placeFlyer(flyer, fromRect);

  if (reducedMotion() || typeof flyer.animate !== "function") {
    placeFlyer(flyer, toRect);
    return Promise.resolve();
  }

  return flyer
    .animate(
      [
        { transform: "translate(0, 0) scale(1)" },
        { transform: `translate(${dx}px, ${dy}px) scale(1)` },
      ],
      {
        duration,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      },
    )
    .finished.then(() => {
      placeFlyer(flyer, toRect);
      flyer.style.transform = "translate(0, 0) scale(1)";
    })
    .catch(() => {
      placeFlyer(flyer, toRect);
    });
}

function revealButtons(list, chosenId = null) {
  const buttons = [...list.querySelectorAll(".variants__btn")];
  for (const button of buttons) {
    // Instant handoff from flyers — no opacity/filter fade.
    button.style.transition = "none";
  }
  void list.offsetHeight;
  for (const button of buttons) {
    button.classList.remove("is-arriving");
    if (chosenId != null) {
      button.classList.toggle("is-active", button.dataset.id === chosenId);
    }
  }
  void list.offsetHeight;
  // Re-enable transitions on the next frame for later hover/active.
  requestAnimationFrame(() => {
    for (const button of buttons) {
      button.style.transition = "";
    }
  });
}

function finishArrival(list, nav, chosenId, flyers = []) {
  // Show real buttons first, then drop flyers so there is no empty blink/fade.
  revealButtons(list, chosenId);
  nav.classList.remove("is-reserved");
  nav.classList.add("is-open");
  for (const flyer of flyers) flyer.remove();
  nav.style.minHeight = "";
}

async function openVariantsRow(nav) {
  if (!nav) return;
  nav.classList.remove("is-empty");
  if (nav.classList.contains("is-open")) return;
  if (reducedMotion()) {
    nav.classList.add("is-open");
    return;
  }
  void nav.offsetHeight;
  nav.classList.add("is-open");
  await wait(EXPAND_MS);
}

async function closeVariantsRow(nav) {
  if (!nav || !nav.classList.contains("is-open")) return;
  if (reducedMotion()) {
    nav.classList.remove("is-open");
    return;
  }
  nav.classList.remove("is-open");
  await wait(EXPAND_MS);
}

/**
 * Mount invisible variant slots (row stays collapsed until openVariantsRow).
 * @param {object} skill
 * @param {{ separateTrans?: boolean }} [opts]
 * @returns {object[]} versions
 */
export function reserveVariantSlots(skill, { separateTrans } = {}) {
  const versions = versionsForReveal(skill, separateTrans);
  if (!els.skillVariants || !els.skillVariantsList || !versions.length) {
    return versions;
  }

  clearFlyers();
  mountVariantButtons(versions, skill.id);
  els.skillVariants.hidden = false;
  els.skillVariants.classList.add("is-reserved");
  // Keep collapsed until openVariantsRow runs with the gem drop.
  els.skillVariants.classList.remove("is-empty", "is-open");
  els.skillVariants.style.minHeight = "";
  for (const button of els.skillVariantsList.querySelectorAll(".variants__btn")) {
    button.classList.add("is-arriving");
  }
  return versions;
}

/**
 * Fade out current variant buttons before a re-roll (reduced-motion / exclude path).
 * Collapses the row so the tooltip can rise, then drop again on the next arrival.
 * @param {{ restoreReelCell?: boolean }} [opts] when false, leave the reel hole empty
 */
export async function fadeOutVariants({ restoreReelCell = true } = {}) {
  const nav = els.skillVariants;
  const list = els.skillVariantsList;
  clearFlyers();

  if (!nav || !list?.querySelector(".variants__btn")) {
    nav?.classList.remove("is-reserved", "is-open");
    nav?.classList.add("is-empty");
    if (restoreReelCell) {
      findReturnCell()?.classList.remove("is-departing", "is-winner");
    } else {
      findReturnCell()?.classList.remove("is-winner");
    }
    return;
  }

  nav.classList.add("is-fading-out");
  for (const button of list.querySelectorAll(".variants__btn")) {
    button.classList.add("is-fading-out");
  }

  if (!reducedMotion()) await wait(FADE_OUT_MS);

  await closeVariantsRow(nav);
  list.replaceChildren();
  nav.classList.remove("is-fading-out", "is-reserved");
  nav.classList.add("is-empty");
  nav.style.minHeight = "";
  if (restoreReelCell) {
    findReturnCell()?.classList.remove("is-departing", "is-winner");
  } else {
    findReturnCell()?.classList.remove("is-winner");
  }
}

/**
 * Reverse of arrival: variants merge to center, then ascend into the empty reel cell.
 * Exclude-and-roll: variants disappear instead, leaving the reel hole empty.
 * Call and await this before starting a re-roll spin.
 * @param {{ exclude?: boolean }} [opts]
 */
export async function playVariantDeparture({ exclude = false } = {}) {
  if (exclude) {
    await fadeOutVariants({ restoreReelCell: false });
    return;
  }

  const nav = els.skillVariants;
  const list = els.skillVariantsList;
  const buttons = [...(list?.querySelectorAll(".variants__btn") || [])];

  if (!nav || !buttons.length) {
    nav?.classList.remove("is-reserved", "is-open");
    nav?.classList.add("is-empty");
    findReturnCell()?.classList.remove("is-departing", "is-winner");
    return;
  }

  if (reducedMotion()) {
    await fadeOutVariants({ restoreReelCell: true });
    return;
  }

  clearFlyers();
  const host = flyerHost();
  const returnCell = findReturnCell();
  const mergeCenter = hostListCenter(list, host);

  const entries = [];
  for (const button of buttons) {
    const skill = skillFromId(button.dataset.id);
    if (!skill) continue;
    const from = hostSlotRect(button, host);
    const flyer = buildFlyer(skill);
    placeFlyer(flyer, from);
    flyer.classList.add("is-visible");
    const active = button.classList.contains("is-active");
    if (active) flyer.classList.add("is-selected");
    else flyer.classList.add("is-dimmed");
    entries.push({ flyer, from, active });
  }

  // Hide real buttons instantly — flyers carry the art.
  for (const button of buttons) {
    button.classList.add("is-arriving");
    button.style.transition = "none";
  }

  if (!entries.length) {
    await fadeOutVariants({ restoreReelCell: true });
    return;
  }

  if (entries.length > 1) {
    await Promise.all(
      entries.map(({ flyer, from }) =>
        animateFlyerTo(flyer, from, mergeCenter, MERGE_MS),
      ),
    );
  }

  const primary = entries.find((entry) => entry.active) || entries[0];
  for (const entry of entries) {
    if (entry === primary) continue;
    entry.flyer.remove();
  }
  primary.flyer.classList.remove("is-dimmed");
  primary.flyer.classList.add("is-selected");

  const fromAscend = entries.length > 1 ? mergeCenter : primary.from;
  placeFlyer(primary.flyer, fromAscend);

  // Drop slots and collapse the row; don't wait for the full expand timing.
  list.replaceChildren();
  nav.classList.remove("is-open");

  const ascendTarget = returnCell
    ? hostSlotRect(returnCell, host)
    : hostReelReturnRect(host);
  await animateFlyerTo(primary.flyer, fromAscend, ascendTarget, ASCEND_MS);

  primary.flyer.remove();
  returnCell?.classList.remove("is-departing", "is-winner");

  nav.classList.remove("is-reserved", "is-fading-out");
  nav.classList.add("is-empty");
  nav.style.minHeight = "";
}

/** Cancel in-flight arrival visuals (e.g. new roll). Keeps empty reel slots. */
export function resetVariantArrival() {
  clearFlyers();
  els.skillVariants?.classList.remove("is-reserved", "is-fading-out");
}

/**
 * Descend winner gem from reel into reserved slots; split if multiple versions.
 * Opens the variants row as gems drop so the tooltip is pushed down.
 * @param {{ skill: object, sourceCell?: HTMLElement | null, onDescendComplete?: () => void, separateTrans?: boolean }} opts
 */
export async function playVariantArrival({ skill, sourceCell, onDescendComplete, separateTrans }) {
  const list = els.skillVariantsList;
  const nav = els.skillVariants;
  if (!skill || !list || !nav) return;

  const versions = versionsForReveal(skill, separateTrans);
  if (!versions.length) return;

  // Mount collapsed slots, then open the row as the gem descends.
  if (!list.querySelector(".variants__btn")) {
    reserveVariantSlots(skill, { separateTrans });
  }

  const buttons = [...list.querySelectorAll(".variants__btn")];
  if (!buttons.length) return;

  if (reducedMotion() || !sourceCell) {
    await openVariantsRow(nav);
    finishArrival(list, nav, skill.id);
    clearFlyers();
    onDescendComplete?.();
    return;
  }

  const host = flyerHost();
  const startRect = hostSlotRect(sourceCell, host);
  sourceCell.classList.add("is-departing");

  const chosenId = skill.id;
  const chosenIndex = Math.max(
    0,
    versions.findIndex((entry) => entry.id === chosenId),
  );
  const primarySkill = versions[chosenIndex] || versions[0];
  const primary = buildFlyer(primarySkill);
  placeFlyer(primary, startRect);
  primary.classList.add("is-visible");

  // Open the row first so drop/split targets match final layout (avoids mid-expand drift).
  await openVariantsRow(nav);
  void list.offsetHeight;

  // Remeasure after expand in case scroll anchoring shifted viewport coords.
  const fromRect = hostSlotRect(sourceCell, host);
  placeFlyer(primary, fromRect);

  // Single version: drop straight into its button.
  if (versions.length === 1) {
    const target = hostSlotRect(buttons[0], host);
    await animateFlyerTo(primary, fromRect, target, DESCEND_MS);
    // Tooltip starts as the gem lands — runs beside button settle.
    onDescendComplete?.();
    placeFlyer(primary, hostSlotRect(buttons[0], host));
    finishArrival(list, nav, chosenId, [primary]);
    return;
  }

  // Aim at the open row center (between reel and separator).
  const descendTarget = hostListCenter(list, host);

  await animateFlyerTo(primary, fromRect, descendTarget, DESCEND_MS);

  // Tooltip appears the moment the reel drop lands; split runs in parallel.
  onDescendComplete?.();
  primary.classList.add("is-selected");

  void list.offsetHeight;
  const settledCenter = hostListCenter(list, host);
  placeFlyer(primary, settledCenter);

  const targets = buttons.map((button) => hostSlotRect(button, host));
  const chosenTarget = targets[chosenIndex] || targets[0];

  // Chosen gem continues into its own slot; other versions fan out already dimmed.
  const otherFlyers = [];
  for (let i = 0; i < versions.length; i++) {
    if (i === chosenIndex) continue;
    const flyer = buildFlyer(versions[i]);
    placeFlyer(flyer, settledCenter);
    flyer.classList.add("is-visible", "is-dimmed");
    otherFlyers.push({ flyer, target: targets[i] || settledCenter });
  }

  await Promise.all([
    animateFlyerTo(primary, settledCenter, chosenTarget, SPLIT_MS),
    ...otherFlyers.map(({ flyer, target }) =>
      animateFlyerTo(flyer, settledCenter, target, SPLIT_MS),
    ),
  ]);

  finishArrival(list, nav, chosenId, [primary, ...otherFlyers.map(({ flyer }) => flyer)]);
}
