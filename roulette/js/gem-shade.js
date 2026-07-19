/**
 * Game-accurate crystal tint for transfigured gems.
 * Matches PShad_AlternateSkillGemEffect + zao's SHADE_LUT
 * (https://gist.github.com/zao/08878df57aba605e5fa1e6373f2dce02).
 *
 * attr × variant: str/dex/int × 1/2 ≈ TRANSFIGURED_X / TRANSFIGURED_Y
 */

const ATTR_BY_COLOR = {
  strength: "str",
  dexterity: "dex",
  intelligence: "int",
};

/** @type {Record<string, Record<string, { hue: number, sat: number, val: number, lum: number }>>} */
export const SHADE_LUT = {
  str: {
    1: { hue: -0.051, sat: -0.064, val: 0.282, lum: 0.612 },
    2: { hue: -0.204, sat: 0.248, val: -0.35, lum: 0.798 },
  },
  dex: {
    1: { hue: -0.15, sat: -0.052, val: 0.214, lum: 0.776 },
    2: { hue: 0.26, sat: 0.08, val: -0.586, lum: 0.726 },
  },
  int: {
    1: { hue: -0.11, sat: -0.22, val: -0.04, lum: 1.0 },
    2: { hue: 0.06, sat: 0.04, val: -0.08, lum: 1.0 },
  },
};

const cache = new Map();
const sheetCache = new Map();
/** Cap shaded PNG data-URLs — unbounded growth causes GC hitch after many rolls. */
const SHADE_CACHE_MAX = 80;
const SHEET_CACHE_MAX = 120;

const shadeWorkQueue = [];
let shadeWorkerRunning = false;

function setLru(map, key, value, max) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    map.delete(map.keys().next().value);
  }
}

function enqueueShadeWork(fn) {
  return new Promise((resolve, reject) => {
    shadeWorkQueue.push({ fn, resolve, reject });
    pumpShadeWork();
  });
}

async function pumpShadeWork() {
  if (shadeWorkerRunning) return;
  shadeWorkerRunning = true;
  while (shadeWorkQueue.length) {
    const { fn, resolve, reject } = shadeWorkQueue.shift();
    try {
      await new Promise((r) => requestAnimationFrame(r));
      resolve(await fn());
    } catch (err) {
      reject(err);
    }
  }
  shadeWorkerRunning = false;
}

export function isTrarthusSkill(skill) {
  return Boolean(skill?.name && /of Trarthus/i.test(skill.name));
}

export function altLetterFromId(id) {
  return id?.match(/_alt_([xyz])$/)?.[1] || null;
}

export function baseIdFromGemId(id) {
  return id ? id.replace(/_alt_[xyz]$/, "") : id;
}

export function shadeParamsFor(color, altLetter) {
  const attr = ATTR_BY_COLOR[color];
  const variant = altLetter === "x" ? "1" : altLetter === "y" ? "2" : null;
  if (!attr || !variant) return null;
  return SHADE_LUT[attr]?.[variant] || null;
}

function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function shadePixel(r, g, b, a, params) {
  if (a === 0) return [0, 0, 0, 0];

  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);

  const lum = lr * 0.299 + lg * 0.587 + lb * 0.114;
  const luminanceInfluence = lum ** 0.02;

  const [h, s, v] = rgbToHsv(lr, lg, lb);
  let h2 = h + params.hue;
  h2 = h2 - Math.floor(h2);
  h2 = Math.max(h2, 0.024);
  const s2 = Math.min(1, Math.max(0, s + params.sat));
  const v2 = Math.min(1, Math.max(0, v + params.val));

  const [mr, mg, mb] = hsvToRgb(h2, s2, v2);
  const mix = luminanceInfluence * (1 - params.lum);
  const fr = mr * (1 - mix) + lr * mix;
  const fg = mg * (1 - mix) + lg * mix;
  const fb = mb * (1 - mix) + lb * mix;

  return [
    Math.round(Math.min(255, Math.max(0, linearToSrgb(fr) * 255))),
    Math.round(Math.min(255, Math.max(0, linearToSrgb(fg) * 255))),
    Math.round(Math.min(255, Math.max(0, linearToSrgb(fb) * 255))),
    a,
  ];
}

export function loadImage(url) {
  if (sheetCache.has(url)) {
    const hit = sheetCache.get(url);
    // Refresh LRU order on hit.
    sheetCache.delete(url);
    sheetCache.set(url, hit);
    return hit;
  }
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load gem sheet: ${url}`));
    img.src = url;
  });
  setLru(sheetCache, url, promise, SHEET_CACHE_MAX);
  return promise;
}

/**
 * Returns a data URL of the shaded crystal cell (right third of the sheet),
 * or null if shade params / sheet are unavailable.
 *
 * Sheets are often 236×80 (not clean 234×78). Crop must match CSS
 * `background-size: 300%; background-position: 100% 0` (true right third),
 * then scale to 78×78 to match wiki inventory icons.
 */
export async function shadedCrystalUrl(sheetUrl, color, altLetter) {
  const params = shadeParamsFor(color, altLetter);
  if (!params || !sheetUrl) return null;

  const key = `${sheetUrl}|${color}|${altLetter}|v2`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  try {
    const dataUrl = await enqueueShadeWork(async () => {
      const img = await loadImage(sheetUrl);
      const srcX = (img.width * 2) / 3;
      const srcW = img.width / 3;
      const srcH = img.height;
      const out = 78;
      const canvas = document.createElement("canvas");
      canvas.width = out;
      canvas.height = out;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // Right third of [deco | empty | crystal], same mapping as CSS sheet layers.
      ctx.drawImage(img, srcX, 0, srcW, srcH, 0, 0, out, out);
      const imageData = ctx.getImageData(0, 0, out, out);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const [nr, ng, nb, na] = shadePixel(d[i], d[i + 1], d[i + 2], d[i + 3], params);
        d[i] = nr;
        d[i + 1] = ng;
        d[i + 2] = nb;
        d[i + 3] = na;
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL("image/png");
    });
    setLru(cache, key, dataUrl, SHADE_CACHE_MAX);
    return dataUrl;
  } catch {
    setLru(cache, key, null, SHADE_CACHE_MAX);
    return null;
  }
}
