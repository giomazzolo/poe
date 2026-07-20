/**
 * Horizontal ascendancy portrait reel — same motion pattern as the skill gem reel,
 * but cells are ascendancy class portraits.
 */
import { els } from "./state.js";
import { iconPathForAscendancy } from "./ascendancy-pool.js";

const IDLE_CELLS = 20;
const SPIN_APPEND = 56;
const LAND_FROM_END = 7;
const SPIN_MS = 6200;
const CENTER_MS = 480;
const REEL_KEEP_CELLS = 14;
const CELL_POOL_MAX = SPIN_APPEND + REEL_KEEP_CELLS + 4;
const SHRINK_MS = 220;
const DISAPPEAR_MS = 200;
/** Native face art is 110×80; reel shows ~19% larger (15% under prior size). */
const CELL_W = 131;
const CELL_H = 95;
const CELL_GAP = 0;

let offsetX = 0;
let cellStep = CELL_W + CELL_GAP;
let rafId = 0;
let spinning = false;
let runId = 0;

/** @type {HTMLElement[]} */
const cellPool = [];

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function applyOffset(track) {
  track.style.transform = `translateX(${offsetX}px)`;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function measureCellStep(track) {
  if (track.children.length < 2) return CELL_W + CELL_GAP;
  return track.children[1].offsetLeft - track.children[0].offsetLeft;
}

/** Land 1px inside the winner's left or right edge (50/50). */
function landOffsetForCell(viewport, cell) {
  if (!cell) return 0;
  const pickX =
    Math.random() < 0.5
      ? cell.offsetLeft + 1
      : cell.offsetLeft + cell.offsetWidth - 1;
  return viewport.clientWidth / 2 - pickX;
}

function centerOffsetForCell(viewport, cell) {
  if (!cell) return 0;
  const cellCenter = cell.offsetLeft + cell.offsetWidth / 2;
  return viewport.clientWidth / 2 - cellCenter;
}

function clearWinnerMarks(track) {
  for (const cell of track.children) {
    cell.classList.remove("is-winner");
  }
}

function createCellShell() {
  const cell = document.createElement("div");
  cell.className = "ascendancy-reel__cell";
  const img = document.createElement("img");
  img.alt = "";
  img.width = CELL_W;
  img.height = CELL_H;
  img.draggable = false;
  cell.append(img);
  cell._img = img;
  return cell;
}

function fillCell(cell, entry) {
  cell.classList.remove("is-winner", "is-departing");
  cell.title = entry.name || entry.id;
  cell.dataset.id = entry.id;
  const src = iconPathForAscendancy(entry.id);
  if (src) {
    cell._img.src = src;
    cell._img.hidden = false;
  } else {
    cell._img.removeAttribute("src");
    cell._img.hidden = true;
  }
}

function acquireCell(entry) {
  const cell = cellPool.pop() || createCellShell();
  fillCell(cell, entry);
  return cell;
}

function releaseCell(cell) {
  if (!cell) return;
  cell.classList.remove("is-winner", "is-departing");
  cell.removeAttribute("title");
  delete cell.dataset.id;
  cell._img?.removeAttribute("src");
  cell.remove();
  if (cellPool.length < CELL_POOL_MAX) cellPool.push(cell);
}

function waitMs(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Before a re-roll spin:
 * - normal: shrink the expanded winner back, keep the face
 * - exclude: fade the face out and leave an empty gap until it scrolls away
 * @param {{ exclude?: boolean }} [opts]
 */
export async function prepareAscendancyReelForReroll({ exclude = false } = {}) {
  const track = els.ascendancyReelTrack;
  if (!track) return;

  const winners = [
    ...track.querySelectorAll(".ascendancy-reel__cell.is-winner"),
  ];
  if (!winners.length) return;

  if (exclude) {
    for (const cell of winners) {
      cell.classList.remove("is-winner");
      cell.classList.add("is-departing");
    }
    void track.offsetWidth;
    if (!prefersReducedMotion()) await waitMs(DISAPPEAR_MS);
    return;
  }

  for (const cell of winners) {
    cell.classList.remove("is-winner");
  }
  void track.offsetWidth;
  if (!prefersReducedMotion()) await waitMs(SHRINK_MS);
}

function mountStrip(track, entries) {
  while (track.firstChild) releaseCell(track.firstChild);
  const frag = document.createDocumentFragment();
  for (const entry of entries) frag.append(acquireCell(entry));
  track.append(frag);
  cellStep = measureCellStep(track);
}

function buildStrip(pool, focus, length, landIndex) {
  if (!pool.length) return [focus];
  const others = pool.filter((entry) => entry.id !== focus.id);
  shuffleInPlace(others);
  const targetLen = Math.min(Math.max(length, 1), Math.max(pool.length, length));
  const land = Math.min(Math.max(landIndex, 0), targetLen - 1);
  const strip = [];
  let next = 0;
  for (let i = 0; i < targetLen; i++) {
    if (i === land) strip.push(focus);
    else strip.push(others[next++ % Math.max(others.length, 1)] || focus);
  }
  return strip;
}

function trimOffscreenLeft(track) {
  while (track.children.length > 4) {
    const first = track.children[0];
    const rightEdge = offsetX + first.offsetLeft + first.offsetWidth;
    if (rightEdge >= -8) break;
    const step =
      track.children.length > 1
        ? track.children[1].offsetLeft - first.offsetLeft
        : first.offsetWidth || cellStep;
    releaseCell(first);
    offsetX += step;
  }
  cellStep = measureCellStep(track);
  applyOffset(track);
}

function pruneAround(track, winnerCell, keep = REEL_KEEP_CELLS) {
  if (!track || !winnerCell?.isConnected) return;
  const kids = [...track.children];
  const idx = kids.indexOf(winnerCell);
  if (idx < 0) return;

  const half = Math.floor(keep / 2);
  let start = Math.max(0, idx - half);
  let end = Math.min(kids.length, start + keep);
  start = Math.max(0, end - keep);

  for (let i = kids.length - 1; i >= end; i--) releaseCell(kids[i]);

  let removed = 0;
  while (removed < start && track.children.length) {
    const first = track.children[0];
    const step =
      track.children.length > 1
        ? track.children[1].offsetLeft - first.offsetLeft
        : first.offsetWidth || cellStep;
    releaseCell(first);
    offsetX += step;
    removed += 1;
  }

  cellStep = measureCellStep(track);
  applyOffset(track);
}

function cyclePicker(entries) {
  const bag = entries.length ? entries.slice() : [];
  shuffleInPlace(bag);
  let i = 0;
  return () => {
    if (!bag.length) return null;
    if (i >= bag.length) {
      shuffleInPlace(bag);
      i = 0;
    }
    return bag[i++];
  };
}

/** Replace strip faces that are no longer in the roll pool (e.g. just excluded). */
function scrubTrackToPool(track, pool) {
  if (!track?.children.length || !pool?.length) return;
  const allowed = new Set(pool.map((entry) => entry.id));
  const next = cyclePicker(pool);
  for (const cell of track.children) {
    if (cell.classList.contains("is-departing")) continue;
    if (allowed.has(cell.dataset.id)) continue;
    const entry = next() || pool[0];
    if (entry) fillCell(cell, entry);
  }
}

function animateOffsetTo(track, targetX, ms) {
  return new Promise((resolve) => {
    if (prefersReducedMotion() || Math.abs(targetX - offsetX) < 0.5) {
      offsetX = targetX;
      applyOffset(track);
      resolve();
      return;
    }

    const startX = offsetX;
    const startedAt = performance.now();
    spinning = true;

    const tick = (now) => {
      if (!spinning) {
        resolve();
        return;
      }
      const t = Math.min(1, (now - startedAt) / ms);
      offsetX = startX + (targetX - startX) * easeOutCubic(t);
      applyOffset(track);
      if (t >= 1) {
        offsetX = targetX;
        applyOffset(track);
        spinning = false;
        rafId = 0;
        resolve();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
  });
}

function cancelSpin() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  spinning = false;
}

export function initAscendancyReel(pool) {
  cancelSpin();
  if (!pool?.length) return;

  const reel = els.ascendancyReel;
  const track = els.ascendancyReelTrack;
  if (!reel || !track) return;

  const viewport = reel.querySelector(".ascendancy-reel__viewport");
  const focus = pickOne(pool);
  const count = Math.min(IDLE_CELLS, Math.max(pool.length, IDLE_CELLS));
  const land = Math.min(5, count - 1);
  const strip = buildStrip(pool, focus, count, land);

  track.classList.remove("is-spinning");
  track.style.transition = "none";
  mountStrip(track, strip);
  clearWinnerMarks(track);

  offsetX = landOffsetForCell(viewport, track.children[land]);
  applyOffset(track);
  reel.classList.remove("is-landed");
  reel.hidden = false;
}

/**
 * @param {{ pool: object[], winner: object, onDone: (info?: object) => void }} opts
 */
export function runAscendancyReel({ pool, winner, onDone }) {
  cancelSpin();
  const myRun = ++runId;

  const reel = els.ascendancyReel;
  const track = els.ascendancyReelTrack;
  if (!reel || !track || !pool?.length || !winner) {
    onDone?.({});
    return;
  }

  if (!pool.some((entry) => entry.id === winner.id)) {
    onDone?.({});
    return;
  }

  const viewport = reel.querySelector(".ascendancy-reel__viewport");
  track.style.transition = "none";
  track.classList.add("is-spinning");
  reel.classList.remove("is-landed");
  reel.hidden = false;
  clearWinnerMarks(track);

  if (!track.children.length) {
    const seed = buildStrip(
      pool,
      winner,
      Math.min(IDLE_CELLS, pool.length),
      Math.min(2, Math.max(0, pool.length - 1)),
    );
    mountStrip(track, seed);
    offsetX = centerOffsetForCell(viewport, track.children[0]);
    applyOffset(track);
  } else {
    scrubTrackToPool(track, pool);
  }

  trimOffscreenLeft(track);
  cellStep = measureCellStep(track);

  const others = pool.filter((entry) => entry.id !== winner.id);
  const nextOther = cyclePicker(others);
  const landIndexInAppend = SPIN_APPEND - LAND_FROM_END;

  void (async () => {
    const frag = document.createDocumentFragment();
    const acquired = [];
    for (let i = 0; i < SPIN_APPEND; i++) {
      if (myRun !== runId) {
        for (const cell of acquired) releaseCell(cell);
        return;
      }
      const entry = i === landIndexInAppend ? winner : nextOther() || winner;
      const cell = acquireCell(entry);
      acquired.push(cell);
      frag.append(cell);
      if (i % 10 === 9) await new Promise((r) => requestAnimationFrame(r));
    }
    if (myRun !== runId) {
      for (const cell of acquired) releaseCell(cell);
      return;
    }

    track.append(frag);

    const landIndex = track.children.length - SPIN_APPEND + landIndexInAppend;
    const winnerCell = track.children[landIndex];
    const startX = offsetX;
    const endX = landOffsetForCell(viewport, winnerCell);

    if (prefersReducedMotion()) {
      offsetX = endX;
      applyOffset(track);
      winnerCell.classList.add("is-winner");
      track.classList.remove("is-spinning");
      reel.classList.add("is-landed");
      trimOffscreenLeft(track);
      pruneAround(track, winnerCell);
      offsetX = centerOffsetForCell(viewport, winnerCell);
      applyOffset(track);
      onDone?.({ winnerCell, winner });
      return;
    }

    spinning = true;
    const startedAt = performance.now();

    const tick = (now) => {
      if (!spinning || myRun !== runId) return;

      const t = Math.min(1, (now - startedAt) / SPIN_MS);
      offsetX = startX + (endX - startX) * easeOutCubic(t);
      applyOffset(track);

      if (t >= 1) {
        offsetX = endX;
        applyOffset(track);
        spinning = false;
        rafId = 0;
        winnerCell.classList.add("is-winner");
        track.classList.remove("is-spinning");
        reel.classList.add("is-landed");
        trimOffscreenLeft(track);
        pruneAround(track, winnerCell);
        animateOffsetTo(
          track,
          centerOffsetForCell(viewport, winnerCell),
          CENTER_MS,
        ).then(() => {
          if (myRun !== runId) return;
          onDone?.({ winnerCell, winner });
        });
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
  })();
}
