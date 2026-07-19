/**
 * Persistent skill-gem reel.
 * Idle: random skill under the arrow (no tooltip).
 * Spin: keep the current strip (no wipe/snap), append a long run from the
 * *current* filtered pool only, ease to the winner.
 *
 * Cells are recycled from a pool so rolls don’t allocate/GC dozens of gem
 * frames every time (that was hitching after many rolls).
 */
import { els, state } from "./state.js";
import { createGemArtRenderer } from "./gem-art.js";

const IDLE_CELLS = 14;
const SPIN_APPEND = 72;
const LAND_FROM_END = 8;
const SPIN_MS = 6200;
const CENTER_MS = 480;
/** Hard cap on reel DOM after each land — prevents growth across many rolls. */
const REEL_KEEP_CELLS = 16;
const CELL_POOL_MAX = SPIN_APPEND + REEL_KEEP_CELLS + 4;

let offsetX = 0;
let cellStep = 78;
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

/** Unique strip helper (also used by smoke tests). */
export function buildReelStrip(pool, winner, length = IDLE_CELLS, landIndex = 6) {
  if (!pool.length) return [winner];

  const others = pool.filter((skill) => skill.id !== winner.id);
  shuffleInPlace(others);

  const targetLen = Math.min(length, pool.length);
  const land = Math.min(Math.max(landIndex, 0), targetLen - 1);
  const fillers = others.slice(0, Math.max(0, targetLen - 1));

  const strip = [];
  let next = 0;
  for (let i = 0; i < targetLen; i++) {
    if (i === land) strip.push(winner);
    else strip.push(fillers[next++]);
  }
  return strip;
}

function createCellShell() {
  const cell = document.createElement("div");
  cell.className = "skill-reel__cell";

  const frame = document.createElement("div");
  frame.className = "gem__art-frame";

  const sparkle = document.createElement("div");
  sparkle.className = "gem__sparkle";
  sparkle.hidden = true;
  sparkle.setAttribute("aria-hidden", "true");

  const inventory = document.createElement("img");
  inventory.className = "gem__inventory";
  inventory.alt = "";
  inventory.width = 92;
  inventory.height = 92;
  inventory.hidden = true;

  const base = document.createElement("div");
  base.className = "gem__art gem__art--base";
  base.setAttribute("aria-hidden", "true");

  const deco = document.createElement("div");
  deco.className = "gem__art gem__art--deco";
  deco.setAttribute("role", "img");

  frame.append(sparkle, inventory, base, deco);
  cell.append(frame);

  cell._gemArt = createGemArtRenderer(
    { frame, sparkle, inventory, base, deco },
    {
      alignMode: "balanced",
      // Prefer precomposed inv icons on the reel — always framed correctly.
      // Sheets (transfigured / fallback) still align in the background.
      preferSheet: false,
      alignCacheOnly: true,
    },
  );
  return cell;
}

function fillCell(cell, skill) {
  cell.classList.remove("is-winner", "is-departing");
  cell.title = skill.name || skill.id;
  cell.dataset.id = skill.id;
  cell._gemArt.applyCardDatasets(cell, skill);
  cell._gemArt.render(skill, state.iconsById);
}

function acquireCell(skill) {
  const cell = cellPool.pop() || createCellShell();
  fillCell(cell, skill);
  return cell;
}

/** Return a cell to the pool instead of GC’ing its gem art renderer. */
function releaseCell(cell) {
  if (!cell) return;
  cell.classList.remove("is-winner", "is-departing");
  cell.removeAttribute("title");
  delete cell.dataset.id;
  cell._gemArt?.clear?.();
  cell.remove();
  if (cellPool.length < CELL_POOL_MAX) cellPool.push(cell);
  else cell._gemArt = null;
}

function destroyCell(cell) {
  if (!cell) return;
  cell._gemArt?.clear?.();
  cell._gemArt = null;
  cell.remove();
}

function drainCellPool() {
  while (cellPool.length) {
    const cell = cellPool.pop();
    cell._gemArt?.clear?.();
    cell._gemArt = null;
  }
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function measureCellStep(track) {
  if (track.children.length < 2) return 78;
  return track.children[1].offsetLeft - track.children[0].offsetLeft;
}

function applyOffset(track) {
  track.style.transform = `translateX(${offsetX}px)`;
}

/**
 * Land under the arrow at a random spot on the cell.
 * ~25% near center; otherwise toward an edge.
 */
function landOffsetForCell(viewport, cell) {
  const viewportMid = viewport.clientWidth / 2;
  const width = cell.offsetWidth;
  const inset = Math.max(5, width * 0.07);
  const minX = cell.offsetLeft + inset;
  const maxX = cell.offsetLeft + width - inset;
  const span = Math.max(1, maxX - minX);
  const center = (minX + maxX) / 2;
  const centerHalf = span * 0.14;

  let pickX;
  if (Math.random() < 0.25) {
    pickX = center - centerHalf + Math.random() * (centerHalf * 2);
  } else if (Math.random() < 0.5) {
    pickX = minX + Math.random() * Math.max(1, center - centerHalf - minX);
  } else {
    pickX = center + centerHalf + Math.random() * Math.max(1, maxX - (center + centerHalf));
  }

  return viewportMid - pickX;
}

function centerOffsetForCell(viewport, cell) {
  if (!cell) return 0;
  const cellCenter = cell.offsetLeft + cell.offsetWidth / 2;
  return viewport.clientWidth / 2 - cellCenter;
}

function clearWinnerMarks(track) {
  // Keep is-departing holes (exclude-and-roll) until the cell scrolls off / is recycled.
  for (const cell of track.children) {
    cell.classList.remove("is-winner");
  }
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
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

function mountStrip(track, skills) {
  while (track.firstChild) releaseCell(track.firstChild);
  const frag = document.createDocumentFragment();
  for (const skill of skills) frag.append(acquireCell(skill));
  track.append(frag);
  cellStep = measureCellStep(track);
}

/** Drop cells fully left of the viewport; keep offset visually stable. */
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

/** Keep only a window of cells around the winner so the strip cannot grow forever. */
function pruneReelAround(track, winnerCell, keep = REEL_KEEP_CELLS) {
  if (!track || !winnerCell || !winnerCell.isConnected) return;
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

function cyclePicker(skills) {
  const bag = skills.length ? skills.slice() : [];
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

/**
 * Show the reel with a random skill under the arrow (no selection / no tooltip).
 */
export function initSkillReel(pool) {
  cancelSpin();
  if (!pool?.length) return;

  const reel = els.skillReel;
  const track = els.skillReelTrack;
  if (!reel || !track) return;

  const viewport = reel.querySelector(".skill-reel__viewport");
  const focus = pickOne(pool);
  const count = Math.min(IDLE_CELLS, pool.length);
  const land = Math.min(6, count - 1);
  const strip = buildReelStrip(pool, focus, count, land);

  track.classList.remove("is-spinning");
  track.style.transition = "none";
  mountStrip(track, strip);
  clearWinnerMarks(track);

  offsetX = landOffsetForCell(viewport, track.children[land]);
  applyOffset(track);
  // Idle only — nothing is selected until the first roll completes.
  reel.classList.remove("is-landed");
  reel.hidden = false;
}

/**
 * @param {{ pool: object[], winner: object, onDone: () => void }} opts
 */
export function runSkillReel({ pool, winner, onDone }) {
  cancelSpin();
  const myRun = ++runId;

  const reel = els.skillReel;
  const track = els.skillReelTrack;
  if (!reel || !track || !pool?.length || !winner) {
    onDone?.({});
    return;
  }

  if (!pool.some((skill) => skill.id === winner.id)) {
    onDone?.({});
    return;
  }

  const viewport = reel.querySelector(".skill-reel__viewport");
  track.style.transition = "none";
  track.classList.add("is-spinning");
  reel.classList.remove("is-landed");
  reel.hidden = false;
  clearWinnerMarks(track);

  // Seed only when empty — never wipe an existing strip mid-reroll (that snaps).
  if (!track.children.length) {
    const seed = buildReelStrip(
      pool,
      winner,
      Math.min(IDLE_CELLS, pool.length),
      Math.min(2, Math.max(0, pool.length - 1)),
    );
    mountStrip(track, seed);
    offsetX = centerOffsetForCell(viewport, track.children[0]);
    applyOffset(track);
  }

  trimOffscreenLeft(track);
  cellStep = measureCellStep(track);

  const others = pool.filter((skill) => skill.id !== winner.id);
  const nextOther = cyclePicker(others);
  const landIndexInAppend = SPIN_APPEND - LAND_FROM_END;

  void (async () => {
    // Reuse pooled cells across frames so rolls don’t allocate a full strip each time.
    const frag = document.createDocumentFragment();
    const acquired = [];
    for (let i = 0; i < SPIN_APPEND; i++) {
      if (myRun !== runId) {
        for (const cell of acquired) releaseCell(cell);
        return;
      }
      const skill = i === landIndexInAppend ? winner : nextOther() || winner;
      const cell = acquireCell(skill);
      acquired.push(cell);
      frag.append(cell);
      if (i % 10 === 9) {
        await new Promise((r) => requestAnimationFrame(r));
      }
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
      pruneReelAround(track, winnerCell);
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
        pruneReelAround(track, winnerCell);
        animateOffsetTo(track, centerOffsetForCell(viewport, winnerCell), CENTER_MS).then(() => {
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

/** Tear down reel (rarely needed). */
export function resetSkillReel() {
  cancelSpin();
  const reel = els.skillReel;
  const track = els.skillReelTrack;
  if (track) {
    track.classList.remove("is-spinning");
    track.style.transition = "none";
    track.style.transform = "";
    while (track.firstChild) destroyCell(track.firstChild);
  }
  drainCellPool();
  offsetX = 0;
  if (reel) {
    reel.classList.remove("is-landed");
    reel.hidden = true;
  }
}
