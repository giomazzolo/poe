import { els, state } from "./state.js";
import { pick } from "./format.js";
import { renderGemCard, showGemWaiting } from "./gem-tooltip.js";
import { getRollPool, setButtonsEnabled, excludeSelectedFromPool } from "./pool.js";
import {
  excludeSelectedAscendancy,
  getAscendancyPool,
  prepareAscendancyRollArt,
  renderAscendancyResult,
} from "./ascendancy-pool.js";
import { syncPoolCounts } from "./skill-filters.js";
import { syncAscendancyFilterCount } from "./ascendancy-filters.js";
import { runSkillReel } from "./skill-reel.js";
import { runAscendancyReel, prepareAscendancyReelForReroll } from "./ascendancy-reel.js";
import {
  playVariantDeparture,
  playVariantArrival,
  resetVariantArrival,
} from "./variant-arrival.js";

const SECTION_PAN_MS = 900;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function panToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;

  const margin = parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
  const targetY = Math.max(
    0,
    section.getBoundingClientRect().top + window.scrollY - margin,
  );
  const startY = window.scrollY;
  const delta = targetY - startY;
  if (Math.abs(delta) < 2) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.scrollTo(0, targetY);
    return;
  }

  const startedAt = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - startedAt) / SECTION_PAN_MS);
    window.scrollTo(0, startY + delta * easeInOutCubic(t));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function panToSkillSection() {
  panToSection("skill-section");
}

function panToAscendancySection() {
  panToSection("ascendancy-section");
}

export async function animateAscendancy({ exclude = false } = {}) {
  const pool = getAscendancyPool();
  if (!pool.length) return;

  panToAscendancySection();

  const finalItem = pick(pool);
  const hadPriorRoll = Boolean(state.selectedAscendancyId);

  state.rolling.ascendancy = true;
  setButtonsEnabled();

  // Normal re-roll: shrink the expanded winner first. Exclude: fade out, leave a gap.
  if (hadPriorRoll) {
    await prepareAscendancyReelForReroll({ exclude });
  }

  // Card fade and reel run together — don't block the spin on the banner.
  // Layout classes swap inside prepareAscendancyRollArt after fade-out so
  // the character name doesn't jump while the old result is still visible.
  const artReady = prepareAscendancyRollArt();

  runAscendancyReel({
    pool: getAscendancyPool(),
    winner: finalItem,
    onDone: async () => {
      await artReady;
      await renderAscendancyResult(finalItem);
      state.rolling.ascendancy = false;
      setButtonsEnabled();
    },
  });
}

export async function animateSkill({ exclude = false } = {}) {
  // Filters own the pool; reel/roulette only consume it.
  const pool = getRollPool();
  if (!pool.length) return;

  panToSkillSection();

  const finalItem = pick(pool);
  const card = els.skillCard;
  const hadPriorRoll = Boolean(state.selectedSkillId);
  // Freeze for this roll so toggling the checkbox mid-spin cannot remount variants.
  const separateTrans = Boolean(els.rollTransfigured?.checked);

  state.rolling.skill = true;
  setButtonsEnabled();

  card.classList.add("is-rolling");

  // Morph tooltip while variants leave; reel waits for that exit.
  const waitingPromise = showGemWaiting({ searching: true });
  if (hadPriorRoll) {
    await playVariantDeparture({ exclude });
  }
  resetVariantArrival();

  const reveal = async ({ winnerCell } = {}) => {
    let tooltipShown = false;
    const showTooltip = async () => {
      if (tooltipShown) return;
      tooltipShown = true;
      // Waiting morph may still be finishing from roll start — don't block the drop.
      await waitingPromise;
      renderGemCard(finalItem);
      state.selectedSkillId = finalItem.id;
      // Don't toggle button active here — that happens on instant reveal after split.
    };

    await playVariantArrival({
      skill: finalItem,
      sourceCell: winnerCell,
      // Fire as soon as the gem lands from the reel; tooltip morph runs beside split/settle.
      onDescendComplete: () => {
        void showTooltip();
      },
      separateTrans,
    });
    // Safety for reduced-motion / early-exit paths that skip the descend callback.
    await showTooltip();

    card.classList.remove("is-rolling");
    card.classList.add("has-result");
    state.rolling.skill = false;
    setButtonsEnabled();
  };

  runSkillReel({
    pool,
    winner: finalItem,
    onDone: reveal,
  });
}

export function rollAscendancy() {
  if (state.rolling.ascendancy) return;
  animateAscendancy();
}

export function excludeAndRollAscendancy() {
  if (state.rolling.ascendancy) return;
  if (!excludeSelectedAscendancy()) return;
  syncAscendancyFilterCount();
  animateAscendancy({ exclude: true });
}

export function rollSkill() {
  if (state.rolling.skill) return;
  animateSkill();
}

export function excludeAndRollSkill() {
  if (state.rolling.skill) return;
  if (!excludeSelectedFromPool()) return;
  syncPoolCounts();
  animateSkill({ exclude: true });
}
