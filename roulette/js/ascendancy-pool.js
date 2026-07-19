/**
 * Ascendancy roll pool — parallel to skill pool ownership.
 * Filters mutate includedAscendancyIds, then call rebuildAscendancyPool().
 * Reel / roulette only read getAscendancyPool().
 */
import { els, state } from "./state.js";

/** PoELab page background — waiting / rolling placeholder. */
export const ASCENDANCY_EMPTY_ART = "assets/labyrinth/poelab-page-background.jpg";

/** Framed inventory face — reel + filter thumbs. */
export function iconPathForAscendancy(id) {
  return state.ascendancyIconsById?.[id] || "";
}

/** Official landscape ascendancy banner — result card background. */
export function circlePathForAscendancy(id) {
  return state.ascendancyCirclesById?.[id] || "";
}

export function flavourForAscendancy(id) {
  return state.ascendancyFlavourById?.[id] || "";
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Which layer is currently the visible face: "a" | "b". */
let activeArtLayer = "a";

const FADE_MS = 220;

function artLayers() {
  return {
    a: els.ascendancyPortraitA,
    b: els.ascendancyPortraitB,
  };
}

function activeArt() {
  const layers = artLayers();
  return activeArtLayer === "a" ? layers.a : layers.b;
}

function inactiveArt() {
  const layers = artLayers();
  return activeArtLayer === "a" ? layers.b : layers.a;
}

function waitMs(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function textRoot() {
  return els.ascendancyCard?.querySelector(".ascendancy-card__text") || null;
}

function setAscendancyText({ name = "", meta = "", flavour = "" } = {}) {
  if (els.ascendancyResult) els.ascendancyResult.textContent = name;
  if (els.ascendancyMeta) els.ascendancyMeta.textContent = meta;
  if (els.ascendancyFlavour) {
    if (flavour) {
      els.ascendancyFlavour.hidden = false;
      els.ascendancyFlavour.textContent = flavour;
    } else {
      els.ascendancyFlavour.hidden = true;
      els.ascendancyFlavour.textContent = "";
    }
  }
}

function clearTextFade(textEl = textRoot()) {
  if (!textEl) return;
  textEl.classList.remove("is-fade-in", "is-fade-out");
  textEl.style.opacity = "";
}

function isPlaceholderArt(art = activeArt()) {
  return Boolean(
    art &&
      !art.hidden &&
      art.classList.contains("is-placeholder") &&
      art.getAttribute("src"),
  );
}

function clearArtFace(art) {
  if (!art) return;
  art.classList.remove("is-fade-in", "is-fade-out", "is-placeholder");
  art.hidden = true;
  art.removeAttribute("src");
  art.alt = "";
  art.style.zIndex = "";
  art.style.opacity = "";
}

/** Set face while hidden, wait until the bitmap is ready, then return. */
async function prepareArtFace(art, { src, alt = "", placeholder = false }) {
  if (!art || !src) return;
  art.classList.remove("is-fade-in", "is-fade-out");
  art.classList.toggle("is-placeholder", placeholder);
  art.hidden = true;
  art.style.opacity = "0";
  art.alt = alt;
  art.src = src;
  try {
    if (typeof art.decode === "function") await art.decode();
    else {
      await new Promise((resolve) => {
        if (art.complete) {
          resolve();
          return;
        }
        art.addEventListener("load", resolve, { once: true });
        art.addEventListener("error", resolve, { once: true });
      });
    }
  } catch {
    // Decode can reject if the node was detached; still proceed.
  }
}

/**
 * Sequential art + text fade: outgoing fully fades out, then incoming fades in.
 * `applyContent` runs while both are hidden (between the two fades).
 */
export async function crossfadeAscendancyArt({
  src,
  alt = "",
  placeholder = false,
  applyContent,
} = {}) {
  const textEl = textRoot();
  const runContent = typeof applyContent === "function" ? applyContent : null;

  if (!src) {
    runContent?.();
    return;
  }

  const from = activeArt();
  const to = inactiveArt();
  if (!to) {
    runContent?.();
    return;
  }

  const hasFrom = from && !from.hidden && from.getAttribute("src");

  await prepareArtFace(to, { src, alt, placeholder });

  if (!hasFrom || prefersReducedMotion()) {
    runContent?.();
    clearTextFade(textEl);
    to.hidden = false;
    to.style.opacity = "";
    to.style.zIndex = "";
    to.classList.remove("is-fade-in", "is-fade-out");
    clearArtFace(from);
    activeArtLayer = activeArtLayer === "a" ? "b" : "a";
    els.ascendancyPortrait = to;
    return;
  }

  // 1) Fade out current art + text fully.
  from.classList.remove("is-fade-in");
  clearTextFade(textEl);
  void from.offsetWidth;
  if (textEl) void textEl.offsetWidth;

  from.classList.add("is-fade-out");
  if (textEl) textEl.classList.add("is-fade-out");
  await waitMs(FADE_MS);

  // 2) Swap content while blank, then fade in the new face.
  clearArtFace(from);
  runContent?.();
  clearTextFade(textEl);

  to.style.zIndex = "";
  to.hidden = false;
  to.classList.remove("is-fade-out");
  void to.offsetWidth;
  if (textEl) void textEl.offsetWidth;

  to.classList.add("is-fade-in");
  to.style.opacity = "";
  if (textEl) textEl.classList.add("is-fade-in");
  await waitMs(FADE_MS);

  to.classList.remove("is-fade-in");
  clearTextFade(textEl);

  activeArtLayer = activeArtLayer === "a" ? "b" : "a";
  els.ascendancyPortrait = to;
}

/** Text-only sequential fade when art is already on the target face. */
async function crossfadeAscendancyTextOnly(applyContent) {
  const textEl = textRoot();
  if (typeof applyContent !== "function") return;

  if (!textEl || prefersReducedMotion()) {
    applyContent();
    clearTextFade(textEl);
    return;
  }

  clearTextFade(textEl);
  void textEl.offsetWidth;
  textEl.classList.add("is-fade-out");
  await waitMs(FADE_MS);
  applyContent();
  textEl.classList.remove("is-fade-out");
  void textEl.offsetWidth;
  textEl.classList.add("is-fade-in");
  await waitMs(FADE_MS);
  clearTextFade(textEl);
}

/** Show PoELab page background as the no-ascendancy / mid-roll banner. */
export function showPlaceholderArt() {
  const layers = artLayers();
  clearArtFace(layers.a);
  clearArtFace(layers.b);

  activeArtLayer = "a";
  const art = layers.a;
  if (!art) return;
  art.classList.add("is-placeholder");
  art.src = ASCENDANCY_EMPTY_ART;
  art.alt = "";
  art.hidden = false;
  art.style.opacity = "";
  els.ascendancyPortrait = art;
}

/** Crossfade result → lab map before the reel (no-op if already on the map). */
export async function prepareAscendancyRollArt() {
  const card = els.ascendancyCard;
  card?.classList.remove("is-shining");
  const applyRolling = () => {
    if (card) {
      card.classList.add("is-rolling");
      card.classList.remove("has-result", "is-waiting");
    }
    setAscendancyText({
      name: "",
      meta: "The Lady of Justice doth preside…",
    });
  };

  if (isPlaceholderArt()) {
    await crossfadeAscendancyTextOnly(applyRolling);
    return;
  }

  await crossfadeAscendancyArt({
    src: ASCENDANCY_EMPTY_ART,
    placeholder: true,
    applyContent: applyRolling,
  });
}

export function getAscendancyPool() {
  return state.ascendancyPool;
}

/**
 * Sole writer of state.ascendancyPool.
 */
export function rebuildAscendancyPool() {
  const pool = [];
  for (const entry of state.ascendancies) {
    if (state.includedAscendancyIds.has(entry.id)) pool.push(entry);
  }
  state.ascendancyPool = pool;

  if (els.ascendancyPoolCount) {
    const n = pool.length;
    els.ascendancyPoolCount.textContent = n === 1 ? "1 in pool" : `${n} in pool`;
  }

  syncAscendancyRollBar();
  syncAscendancyRollEnabled();
}

function syncAscendancyRollEnabled() {
  if (!els.rollAscendancy) return;
  els.rollAscendancy.disabled =
    state.rolling.ascendancy || state.ascendancyPool.length === 0;
}

/** Show split bar after first result; enable Exclude and Roll when valid. */
export function syncAscendancyRollBar() {
  const bar = els.ascendancyRollBar;
  const btn = els.excludeAndRollAscendancy;
  const slot = els.excludeAndRollAscendancySlot;
  if (!bar || !btn) return;

  const id = state.selectedAscendancyId;
  const stillInPool = id && state.includedAscendancyIds.has(id);
  const poolLeft = state.ascendancyPool.filter((entry) => entry.id !== id);
  const canExcludeAndRoll =
    !state.rolling.ascendancy && !!id && stillInPool && poolLeft.length > 0;

  if (id && !bar.classList.contains("is-split")) {
    slot?.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bar.classList.add("is-split");
      });
    });
  }

  btn.disabled = !canExcludeAndRoll;
  syncAscendancyRollEnabled();
}

/**
 * Remove the current ascendancy from the pool (and uncheck its filter).
 * @returns {boolean}
 */
export function excludeSelectedAscendancy() {
  const id = state.selectedAscendancyId;
  if (!id || state.rolling.ascendancy) return false;
  if (!state.includedAscendancyIds.delete(id)) {
    syncAscendancyRollBar();
    return false;
  }

  const input = els.ascendancyFilterList?.querySelector(
    `input[value="${CSS.escape(id)}"]`,
  );
  if (input) input.checked = false;

  rebuildAscendancyPool();
  return true;
}

function playAscendancyShine() {
  const card = els.ascendancyCard;
  if (!card || prefersReducedMotion()) return;

  card.classList.remove("is-shining");
  void card.offsetWidth;
  card.classList.add("is-shining");

  const onEnd = (event) => {
    if (event.target !== card || event.animationName !== "gem-header-shine") return;
    card.classList.remove("is-shining");
    card.removeEventListener("animationend", onEnd);
  };
  card.addEventListener("animationend", onEnd);
}

export async function renderAscendancyResult(entry) {
  const card = els.ascendancyCard;
  if (!card || !entry) return;

  state.selectedAscendancyId = entry.id;
  card.classList.remove("is-shining");

  const flavour = flavourForAscendancy(entry.id);
  const applyResult = () => {
    card.classList.add("has-result");
    card.classList.remove("is-waiting", "is-rolling");
    setAscendancyText({
      name: entry.name,
      meta: entry.character,
      flavour,
    });
  };

  const src = circlePathForAscendancy(entry.id);
  if (src) {
    await crossfadeAscendancyArt({
      src,
      alt: entry.name,
      placeholder: false,
      applyContent: applyResult,
    });
  } else {
    clearArtFace(els.ascendancyPortraitA);
    clearArtFace(els.ascendancyPortraitB);
    await crossfadeAscendancyTextOnly(applyResult);
  }

  playAscendancyShine();
  syncAscendancyRollBar();
}

export function showAscendancyWaiting() {
  const card = els.ascendancyCard;
  if (!card) return;
  state.selectedAscendancyId = null;
  card.classList.remove("is-shining");
  setAscendancyText({
    name: "",
    meta: "Your fate rests in her even hands.",
  });
  clearTextFade();
  showPlaceholderArt();
  card.classList.add("is-waiting");
  card.classList.remove("has-result", "is-rolling");
}

/** Seed inclusion set from catalog (all included). */
export function initAscendancyInclusion() {
  state.includedAscendancyIds.clear();
  for (const entry of state.ascendancies) {
    state.includedAscendancyIds.add(entry.id);
  }
  rebuildAscendancyPool();
}
