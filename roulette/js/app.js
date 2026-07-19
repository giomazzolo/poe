import { els, state } from "./state.js";
import {
  loadData,
  rebuildSkillPool,
  setButtonsEnabled,
  showVariantsForSkill,
  hideVariants,
} from "./pool.js";
import { showAscendancyWaiting } from "./ascendancy-pool.js";
import { initAscendancyFilters } from "./ascendancy-filters.js";
import { initSkillFilters, syncPoolCounts, syncTransfiguredFilterVisibility } from "./skill-filters.js";
import { enableAnimatedDetails } from "./details-animate.js";
import { initSettingsModal } from "./settings-modal.js";
import { renderGemCard, showGemWaiting } from "./gem-tooltip.js";
import { whenGemSheetsAligned } from "./gem-art.js";
import { initSkillReel } from "./skill-reel.js";
import { initAscendancyReel } from "./ascendancy-reel.js";
import {
  rollAscendancy,
  rollSkill,
  excludeAndRollSkill,
  excludeAndRollAscendancy,
} from "./roulette.js";

const FONT_WAIT_MS = 4000;

// Always open at the top — browsers otherwise restore mid-page scroll on reload.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.scrollTo(0, 0);

function showStatus(message) {
  els.status.hidden = !message;
  els.status.textContent = message || "";
}

function previewSkillFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const previewId = params.get("preview");
  if (!previewId) return;

  const skill =
    state.allSkills.find((entry) => entry.id === previewId) ||
    state.damageSkills.find((entry) => entry.id === previewId) ||
    state.bannedSkills.find((entry) => entry.id === previewId);

  if (!skill) {
    showStatus(`Preview skill not found: ${previewId}`);
    return;
  }

  els.skillCard.classList.add("has-result");
  renderGemCard(skill);
  state.selectedSkillId = skill.id;
  showVariantsForSkill(skill, { render: false });
  initSkillReel([skill, ...state.skills.filter((entry) => entry.id !== skill.id)]);
  setButtonsEnabled();
}

async function waitForFonts() {
  if (!document.fonts?.load) return;
  try {
    await Promise.race([
      (async () => {
        await Promise.all([
          document.fonts.load('500 1em Cinzel'),
          document.fonts.load('700 1em Cinzel'),
          document.fonts.load('500 1em "Cormorant Garamond"'),
          document.fonts.load('600 1em "Cormorant Garamond"'),
          document.fonts.load('16px "Fontin SmallCaps"'),
          document.fonts.load("14px Fontin"),
          document.fonts.load("italic 14px Fontin"),
        ]);
        await document.fonts.ready;
      })(),
      new Promise((resolve) => window.setTimeout(resolve, FONT_WAIT_MS)),
    ]);
  } catch {
    /* reveal anyway */
  }
}

function revealPage() {
  // Two frames so reel/tooltip layout settles before first paint of content.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.documentElement.classList.add("is-ready");
    });
  });
}

els.rollAscendancy?.addEventListener("click", rollAscendancy);
els.excludeAndRollAscendancy?.addEventListener("click", excludeAndRollAscendancy);
els.rollSkill.addEventListener("click", rollSkill);
els.excludeAndRoll?.addEventListener("click", excludeAndRollSkill);
els.rollTransfigured.addEventListener("change", () => {
  // Selection memory stays in includedTransfiguredIds; only pool membership changes.
  // Variant buttons stay as-is until the next skill roll (never remount mid-roll / mid-result).
  syncTransfiguredFilterVisibility();
  rebuildSkillPool();
  syncPoolCounts();
});

Promise.all([waitForFonts(), loadData()])
  .then(async () => {
    initAscendancyFilters();
    initSkillFilters();
    enableAnimatedDetails();
    initSettingsModal();
    showStatus("");
    showAscendancyWaiting();
    initAscendancyReel(state.ascendancies);
    setButtonsEnabled();
    state.selectedSkillId = null;
    hideVariants();
    showGemWaiting();
    initSkillReel(state.skills);
    previewSkillFromQuery();
    // First paint only: wait for initial reel sheet aligns, then unlock the page.
    await whenGemSheetsAligned();
    revealPage();
  })
  .catch((error) => {
    console.error(error);
    showStatus("Failed to load data. Serve this folder over HTTP (not file://).");
    if (els.rollAscendancy) els.rollAscendancy.disabled = true;
    if (els.rollSkill) els.rollSkill.disabled = true;
    revealPage();
  });
