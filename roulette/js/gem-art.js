/**
 * Gem inventory art renderer — isolated from tooltip / roulette / pool logic.
 *
 * Modes:
 * - Trarthus: base sheet + SparkleBackground underlay
 * - Transfigured X/Y: sheet + HSV crystal shade (gem-shade.js)
 * - Fallback: precomposed inv icon, else plain sheet
 *
 * Sheet layers (deco + crystal) are shifted so the combined alpha silhouette
 * is centered in the frame — decorations are often authored off-center in-cell.
 *
 * DOM contract (all optional except frame):
 *   frame, sparkle, inventory, base, deco
 */
import {
  altLetterFromId,
  baseIdFromGemId,
  isTrarthusSkill,
  loadImage,
  shadedCrystalUrl,
  shadeParamsFor,
} from "./gem-shade.js";

const alignCache = new Map();
const ALPHA_MIN = 12;
const ALIGN_CACHE_MAX = 150;
/** In-flight sheet aligns — awaited once during boot, ignored after. */
const pendingSheetAligns = new Set();

function setAlignLru(key, value) {
  if (alignCache.has(key)) alignCache.delete(key);
  alignCache.set(key, value);
  while (alignCache.size > ALIGN_CACHE_MAX) {
    alignCache.delete(alignCache.keys().next().value);
  }
}

/** One heavy canvas align at a time so roll spins don’t jank the main thread. */
const alignWorkQueue = [];
let alignWorkerRunning = false;

function enqueueAlignWork(fn) {
  return new Promise((resolve, reject) => {
    alignWorkQueue.push({ fn, resolve, reject });
    pumpAlignWork();
  });
}

async function pumpAlignWork() {
  if (alignWorkerRunning) return;
  alignWorkerRunning = true;
  while (alignWorkQueue.length) {
    const { fn, resolve, reject } = alignWorkQueue.shift();
    try {
      // Yield a frame between jobs so the reel animation can paint.
      await new Promise((r) => requestAnimationFrame(r));
      resolve(await fn());
    } catch (err) {
      reject(err);
    }
  }
  alignWorkerRunning = false;
}

/** Resolves when current sheet-align work finishes (boot only). */
export function whenGemSheetsAligned(timeoutMs = 4000) {
  if (!pendingSheetAligns.size) return Promise.resolve();
  return Promise.race([
    Promise.all([...pendingSheetAligns]),
    new Promise((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

function cssUrl(path) {
  if (!path) return null;
  try {
    return `url("${new URL(path, document.baseURI).href}")`;
  } catch {
    return `url("${path}")`;
  }
}

function resolveSheetUrl(skill, iconsById) {
  const entry = iconsById?.[skill.id] || {};
  if (entry.gem) return entry.gem;
  const baseId = baseIdFromGemId(skill.id);
  if (baseId !== skill.id) {
    const baseGem = iconsById?.[baseId]?.gem;
    if (baseGem) return baseGem;
  }
  return null;
}

/** Alpha bounds of one sheet cell, in cell-local coordinates. */
function cellAlphaBounds(data, sheetW, sheetH, x0, x1) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < sheetH; y++) {
    for (let x = x0; x < x1; x++) {
      if (data[(y * sheetW + x) * 4 + 3] < ALPHA_MIN) continue;
      const lx = x - x0;
      if (lx < minX) minX = lx;
      if (y < minY) minY = y;
      if (lx > maxX) maxX = lx;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * CSS translate % so sheet layers sit centered in the frame.
 * Percentages are relative to the layer box (same size as the frame).
 *
 * Modes:
 * - "composite" (default): center on deco+crystal silhouette (tooltip / variants)
 * - "crystal": center on the crystal only (deco follows)
 * - "balanced": midpoint of crystal + deco centers (both axes)
 * - "crystal-x" / "crystal-y": center one axis on crystal, composite on the other
 * @returns {Promise<{ x: string, y: string }>}
 */
function computeAlignFromImage(img, mode = "composite") {
  const sheetW = img.width;
  const sheetH = img.height;
  const cellW = sheetW / 3;
  const canvas = document.createElement("canvas");
  canvas.width = sheetW;
  canvas.height = sheetH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, sheetW, sheetH);

  const deco = cellAlphaBounds(data, sheetW, sheetH, 0, cellW);
  const gem = cellAlphaBounds(data, sheetW, sheetH, (sheetW * 2) / 3, sheetW);

  const gemCx = gem ? (gem.minX + gem.maxX) / 2 : cellW / 2;
  const gemCy = gem ? (gem.minY + gem.maxY) / 2 : sheetH / 2;
  const decoCx = deco ? (deco.minX + deco.maxX) / 2 : cellW / 2;
  const decoCy = deco ? (deco.minY + deco.maxY) / 2 : sheetH / 2;
  const compositeCx =
    deco && gem
      ? (Math.min(deco.minX, gem.minX) + Math.max(deco.maxX, gem.maxX)) / 2
      : deco
        ? decoCx
        : gemCx;
  const compositeCy =
    deco && gem
      ? (Math.min(deco.minY, gem.minY) + Math.max(deco.maxY, gem.maxY)) / 2
      : deco
        ? decoCy
        : gemCy;

  let cx = compositeCx;
  let cy = compositeCy;

  if (mode === "crystal") {
    cx = gemCx;
    cy = gemCy;
  } else if (mode === "balanced") {
    cx = deco && gem ? (gemCx + decoCx) / 2 : gem ? gemCx : decoCx;
    cy = deco && gem ? (gemCy + decoCy) / 2 : gem ? gemCy : decoCy;
  } else if (mode === "crystal-x") {
    cx = gemCx;
    cy = compositeCy;
  } else if (mode === "crystal-y") {
    cx = compositeCx;
    cy = gemCy;
  }

  return {
    x: `${(0.5 - cx / cellW) * 100}%`,
    y: `${(0.5 - cy / sheetH) * 100}%`,
  };
}

async function sheetAlignTranslate(sheetUrl, mode = "composite") {
  const cacheKey = `${sheetUrl}|${mode}`;
  if (alignCache.has(cacheKey)) {
    const hit = alignCache.get(cacheKey);
    alignCache.delete(cacheKey);
    alignCache.set(cacheKey, hit);
    return hit;
  }

  // Decode can run in parallel; pixel scans are serialized so spins stay smooth.
  const promise = (async () => {
    const img = await loadImage(sheetUrl);
    return enqueueAlignWork(() => computeAlignFromImage(img, mode));
  })().catch(() => ({ x: "0%", y: "0%" }));

  setAlignLru(cacheKey, promise);
  return promise;
}

/**
 * @param {{
 *   frame: HTMLElement | null,
 *   sparkle?: HTMLElement | null,
 *   inventory?: HTMLImageElement | null,
 *   base?: HTMLElement | null,
 *   deco?: HTMLElement | null,
 * }} dom
 * @param {{
 *   onChange?: () => void,
 *   alignMode?: "composite" | "crystal" | "balanced" | "crystal-x" | "crystal-y",
 *   preferSheet?: boolean,
 *   alignCacheOnly?: boolean,
 * }} [options]
 */
export function createGemArtRenderer(dom, options = {}) {
  const {
    onChange,
    alignMode = "composite",
    preferSheet = false,
    alignCacheOnly = false,
  } = options;
  let token = 0;

  function notify() {
    onChange?.();
  }

  function setSparkle(on) {
    if (!dom.sparkle) return;
    dom.sparkle.hidden = !on;
  }

  function resetBaseLayer() {
    if (!dom.base) return;
    dom.base.classList.remove("is-shaded");
    dom.base.style.removeProperty("background-image");
    dom.base.style.removeProperty("background-size");
    dom.base.style.removeProperty("background-position");
  }

  function setAlign(x = "0%", y = "0%") {
    if (!dom.frame) return;
    dom.frame.style.setProperty("--gem-align-x", x);
    dom.frame.style.setProperty("--gem-align-y", y);
  }

  function clearAlign() {
    if (!dom.frame) return;
    dom.frame.style.removeProperty("--gem-align-x");
    dom.frame.style.removeProperty("--gem-align-y");
  }

  function setAligning(on) {
    if (!dom.frame) return;
    // Only hide-until-aligned during the initial page boot.
    if (on && document.documentElement.classList.contains("is-ready")) {
      dom.frame.classList.remove("is-aligning");
      return;
    }
    dom.frame.classList.toggle("is-aligning", on);
  }

  function clear() {
    token += 1;
    if (!dom.frame) return;
    dom.frame.hidden = true;
    dom.frame.style.removeProperty("--gem-sheet");
    clearAlign();
    setAligning(false);
    setSparkle(false);
    resetBaseLayer();
    if (dom.inventory) {
      dom.inventory.hidden = true;
      dom.inventory.removeAttribute("src");
      dom.inventory.onload = null;
      dom.inventory.onerror = null;
    }
    if (dom.base) dom.base.hidden = true;
    if (dom.deco) dom.deco.hidden = true;
    notify();
  }

  function setInventory(url) {
    if (!dom.frame || !dom.inventory || !url) return false;

    const img = dom.inventory;
    img.onload = null;
    img.onerror = null;

    dom.frame.style.removeProperty("--gem-sheet");
    clearAlign();
    setAligning(false);
    setSparkle(false);
    resetBaseLayer();
    if (dom.base) dom.base.hidden = true;
    if (dom.deco) dom.deco.hidden = true;

    dom.frame.hidden = false;
    img.hidden = false;
    img.onerror = () => {
      img.hidden = true;
      img.removeAttribute("src");
      img.onerror = null;
      notify();
    };
    img.onload = () => {
      img.hidden = false;
      notify();
    };
    img.src = url;
    notify();
    return true;
  }

  /**
   * @param {string} url sheet PNG
   * @param {{ sparkle?: boolean, shade?: { color: string, alt: string } }} [opts]
   */
  function setSheet(url, opts = {}) {
    if (!dom.frame) return;
    if (!url) {
      clear();
      return;
    }

    const paintToken = ++token;

    if (dom.inventory) {
      dom.inventory.hidden = true;
      dom.inventory.removeAttribute("src");
    }

    dom.frame.style.setProperty("--gem-sheet", cssUrl(url));
    setAlign("0%", "0%");
    dom.frame.hidden = false;
    if (dom.base) dom.base.hidden = false;
    if (dom.deco) dom.deco.hidden = false;
    setSparkle(Boolean(opts.sparkle));
    resetBaseLayer();
    notify();

    const cacheKey = `${url}|${alignMode}`;
    const cachedAlign = alignCache.get(cacheKey);
    const deferNewAlign =
      alignCacheOnly && document.documentElement.classList.contains("is-ready");

    if (cachedAlign) {
      // Instant apply from cache (no canvas work).
      setAligning(!document.documentElement.classList.contains("is-ready"));
      const alignDone = cachedAlign.then((align) => {
        if (paintToken !== token) return;
        setAlign(align.x, align.y);
        setAligning(false);
      });
      pendingSheetAligns.add(alignDone);
      alignDone.finally(() => pendingSheetAligns.delete(alignDone));
    } else if (deferNewAlign) {
      // Show immediately; many sheets are authored off-center and look empty at 0,0
      // until align runs — compute in the background without blocking the spin.
      setAligning(false);
      const alignDone = sheetAlignTranslate(url, alignMode).then((align) => {
        if (paintToken !== token) return;
        setAlign(align.x, align.y);
      });
      pendingSheetAligns.add(alignDone);
      alignDone.finally(() => pendingSheetAligns.delete(alignDone));
    } else {
      setAligning(true);
      const alignDone = sheetAlignTranslate(url, alignMode).then((align) => {
        if (paintToken !== token) return;
        setAlign(align.x, align.y);
        setAligning(false);
      });
      pendingSheetAligns.add(alignDone);
      alignDone.finally(() => pendingSheetAligns.delete(alignDone));
    }

    if (!opts.shade) return;
    const { color, alt } = opts.shade;
    if (!shadeParamsFor(color, alt)) return;

    shadedCrystalUrl(url, color, alt).then((crystalUrl) => {
      if (paintToken !== token) return;
      if (!crystalUrl || !dom.base) return;
      dom.base.classList.add("is-shaded");
      dom.base.style.backgroundImage = cssUrl(crystalUrl);
      dom.base.style.backgroundSize = "100% 100%";
      dom.base.style.backgroundPosition = "0 0";
    });
  }

  /**
   * Paint inventory gem art for a skill. Does not touch skill-bar icons.
   * @param {{ id: string, name?: string, color?: string }} skill
   * @param {Record<string, { gem?: string, inv?: string }>} iconsById
   */
  function render(skill, iconsById) {
    if (!dom.frame) return;

    const entry = iconsById?.[skill.id] || {};
    const invUrl = entry.inv || null;
    const sheetUrl = resolveSheetUrl(skill, iconsById);
    const trarthus = isTrarthusSkill(skill);
    const alt = altLetterFromId(skill.id);

    if (trarthus && sheetUrl) {
      setSheet(sheetUrl, { sparkle: true });
    } else if ((alt === "x" || alt === "y") && sheetUrl && shadeParamsFor(skill.color, alt)) {
      setSheet(sheetUrl, { shade: { color: skill.color, alt } });
    } else if (preferSheet && sheetUrl) {
      // Reel: keep crystal + decoration as layered sheet art for consistent align.
      setSheet(sheetUrl);
    } else if (invUrl) {
      setInventory(invUrl);
    } else if (sheetUrl) {
      setSheet(sheetUrl);
    } else {
      clear();
    }

    const label = `${skill.name || skill.id} gem`;
    if (dom.inventory) dom.inventory.alt = label;
    if (dom.deco) dom.deco.setAttribute("aria-label", label);
  }

  /** Card dataset helpers for CSS hooks (optional). */
  function applyCardDatasets(cardEl, skill) {
    if (!cardEl || !skill) return;
    const alt = altLetterFromId(skill.id);
    if (alt) cardEl.dataset.alt = alt;
    else delete cardEl.dataset.alt;
    if (isTrarthusSkill(skill)) cardEl.dataset.trarthus = "1";
    else delete cardEl.dataset.trarthus;
  }

  return {
    clear,
    render,
    applyCardDatasets,
    /** @deprecated use render */
    setSheet,
    setInventory,
  };
}

export { isTrarthusSkill, altLetterFromId, baseIdFromGemId } from "./gem-shade.js";
