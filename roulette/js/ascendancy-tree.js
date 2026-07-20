/**
 * Ascendancy passive tree viewer — view only, hover/click for node tooltips.
 */
import { els, state } from "./state.js";

const NODE_R = { start: 22, notable: 18, choice: 16, normal: 12 };

let currentTree = null;
let pinnedNodeId = null;
let panX = 0;
let panY = 0;
let scale = 1;
let dragging = false;
let dragLastX = 0;
let dragLastY = 0;
let didDrag = false;

function treeById(id) {
  return state.ascendancyTreesById?.[id] || null;
}

function syncTreeButton() {
  const btn = els.ascendancyTreeBtn;
  if (!btn) return;
  const id = state.selectedAscendancyId;
  const has = Boolean(id && treeById(id));
  btn.hidden = !has;
  btn.disabled = !has;
}

function closeTree() {
  const dialog = els.ascendancyTreeDialog;
  if (!dialog?.open) return;
  dialog.close();
}

function clearTooltip() {
  pinnedNodeId = null;
  const tip = els.ascendancyTreeTooltip;
  if (!tip) return;
  tip.hidden = true;
  tip.replaceChildren();
  for (const node of els.ascendancyTreeSvg?.querySelectorAll(".ascendancy-tree__node.is-selected") || []) {
    node.classList.remove("is-selected");
  }
}

function showTooltip(node, clientX, clientY, { pin = false } = {}) {
  const tip = els.ascendancyTreeTooltip;
  const viewport = els.ascendancyTreeViewport;
  if (!tip || !viewport || !node) return;

  if (pin) {
    pinnedNodeId = node.id;
    for (const el of els.ascendancyTreeSvg?.querySelectorAll(".ascendancy-tree__node") || []) {
      el.classList.toggle("is-selected", el.dataset.id === node.id);
    }
  }

  tip.replaceChildren();
  const title = document.createElement("strong");
  title.className = "ascendancy-tree__tip-name";
  title.textContent = node.name;
  tip.append(title);

  const stats = node.stats || [];
  if (stats.length) {
    for (const line of stats) {
      const p = document.createElement("p");
      p.className = "ascendancy-tree__tip-stat";
      p.textContent = line;
      tip.append(p);
    }
  } else {
    const p = document.createElement("p");
    p.className = "ascendancy-tree__tip-reminder";
    p.textContent = "Ascendancy start node.";
    tip.append(p);
  }

  for (const line of node.reminder || []) {
    const p = document.createElement("p");
    p.className = "ascendancy-tree__tip-reminder";
    p.textContent = line;
    tip.append(p);
  }

  tip.hidden = false;
  const pad = 12;
  const vr = viewport.getBoundingClientRect();
  let left = clientX - vr.left + pad;
  let top = clientY - vr.top + pad;
  tip.style.left = "0";
  tip.style.top = "0";
  const tw = tip.offsetWidth || 260;
  const th = tip.offsetHeight || 80;
  if (left + tw > vr.width - 8) left = clientX - vr.left - tw - pad;
  if (top + th > vr.height - 8) top = clientY - vr.top - th - pad;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

function applyTransform() {
  const world = els.ascendancyTreeWorld;
  if (!world) return;
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
}

function fitTree() {
  const viewport = els.ascendancyTreeViewport;
  if (!viewport || !currentTree) return;
  const pad = 32;
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  if (vw < 1 || vh < 1) return;
  const sx = (vw - pad * 2) / Math.max(currentTree.width, 1);
  const sy = (vh - pad * 2) / Math.max(currentTree.height, 1);
  scale = Math.min(1.2, Math.max(0.3, Math.min(sx, sy)));
  panX = (vw - currentTree.width * scale) / 2;
  panY = (vh - currentTree.height * scale) / 2;
  applyTransform();
}

function sizeWorld() {
  const world = els.ascendancyTreeWorld;
  const svg = els.ascendancyTreeSvg;
  const bg = els.ascendancyTreeBg;
  if (!world || !svg || !currentTree) return;

  const w = currentTree.width;
  const h = currentTree.height;
  world.style.width = `${w}px`;
  world.style.height = `${h}px`;
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  if (bg) {
    bg.style.width = `${w}px`;
    bg.style.height = `${h}px`;
  }
}

function paintTree() {
  const svg = els.ascendancyTreeSvg;
  if (!svg || !currentTree) return;

  sizeWorld();
  svg.replaceChildren();

  const ns = "http://www.w3.org/2000/svg";
  const edges = document.createElementNS(ns, "g");
  edges.setAttribute("class", "ascendancy-tree__edges");
  const nodesG = document.createElementNS(ns, "g");
  nodesG.setAttribute("class", "ascendancy-tree__nodes");

  const drawn = new Set();
  for (const node of currentTree.nodes) {
    for (const targetId of node.out || []) {
      const key = node.id < targetId ? `${node.id}|${targetId}` : `${targetId}|${node.id}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const target = currentTree._byId.get(targetId);
      if (!target) continue;
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", node.x);
      line.setAttribute("y1", node.y);
      line.setAttribute("x2", target.x);
      line.setAttribute("y2", target.y);
      edges.append(line);
    }
  }

  for (const node of currentTree.nodes) {
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", `ascendancy-tree__node is-${node.type}`);
    g.dataset.id = node.id;

    const r = NODE_R[node.type] || NODE_R.normal;
    const hit = document.createElementNS(ns, "circle");
    hit.setAttribute("cx", node.x);
    hit.setAttribute("cy", node.y);
    hit.setAttribute("r", r + 8);
    hit.setAttribute("class", "ascendancy-tree__hit");
    g.append(hit);

    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", node.x);
    circle.setAttribute("cy", node.y);
    circle.setAttribute("r", r);
    circle.setAttribute("class", "ascendancy-tree__dot");
    g.append(circle);

    if (node.isNotable || node.isStart || node.type === "start") {
      const ring = document.createElementNS(ns, "circle");
      ring.setAttribute("cx", node.x);
      ring.setAttribute("cy", node.y);
      ring.setAttribute("r", r + 4);
      ring.setAttribute("class", "ascendancy-tree__ring");
      g.append(ring);
    }

    g.addEventListener("pointerenter", (event) => {
      if (pinnedNodeId && pinnedNodeId !== node.id) return;
      g.classList.add("is-hover");
      showTooltip(node, event.clientX, event.clientY);
    });
    g.addEventListener("pointermove", (event) => {
      if (pinnedNodeId && pinnedNodeId !== node.id) return;
      showTooltip(node, event.clientX, event.clientY);
    });
    g.addEventListener("pointerleave", () => {
      g.classList.remove("is-hover");
      if (pinnedNodeId === node.id) return;
      clearTooltip();
    });
    g.addEventListener("click", (event) => {
      event.stopPropagation();
      if (didDrag) return;
      if (pinnedNodeId === node.id) {
        clearTooltip();
        return;
      }
      showTooltip(node, event.clientX, event.clientY, { pin: true });
    });

    nodesG.append(g);
  }

  svg.append(edges, nodesG);
}

export function openAscendancyTree(ascendancyId = state.selectedAscendancyId) {
  const dialog = els.ascendancyTreeDialog;
  const tree = treeById(ascendancyId);
  if (!dialog || !tree || typeof dialog.showModal !== "function") return;

  currentTree = {
    ...tree,
    _byId: new Map(tree.nodes.map((n) => [n.id, n])),
  };
  pinnedNodeId = null;
  clearTooltip();

  if (els.ascendancyTreeTitle) {
    els.ascendancyTreeTitle.textContent = `${tree.name} Tree`;
  }
  if (els.ascendancyTreeBg) {
    els.ascendancyTreeBg.src = tree.background || "";
    els.ascendancyTreeBg.hidden = !tree.background;
  }

  dialog.showModal();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fitTree();
      paintTree();
    });
  });
}

export function syncAscendancyTreeButton() {
  syncTreeButton();
}

export function initAscendancyTree() {
  syncTreeButton();

  els.ascendancyTreeBtn?.addEventListener("click", () => {
    openAscendancyTree(state.selectedAscendancyId);
  });

  const dialog = els.ascendancyTreeDialog;
  if (!dialog) return;

  for (const btn of dialog.querySelectorAll("[data-close-tree]")) {
    btn.addEventListener("click", closeTree);
  }

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeTree();
  });

  dialog.addEventListener("close", () => {
    clearTooltip();
    currentTree = null;
    panX = 0;
    panY = 0;
    scale = 1;
  });

  const viewport = els.ascendancyTreeViewport;
  if (!viewport) return;

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest(".ascendancy-tree__node") && event.button === 0) return;
    dragging = true;
    didDrag = false;
    dragLastX = event.clientX;
    dragLastY = event.clientY;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-panning");
  });

  viewport.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragLastX;
    const dy = event.clientY - dragLastY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
    panX += dx;
    panY += dy;
    dragLastX = event.clientX;
    dragLastY = event.clientY;
    applyTransform();
  });

  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    viewport.classList.remove("is-panning");
    try {
      viewport.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  viewport.addEventListener("click", (event) => {
    if (event.target.closest(".ascendancy-tree__node")) return;
    if (didDrag) return;
    clearTooltip();
  });

  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const before = scale;
      const next = Math.min(2.4, Math.max(0.25, scale * (event.deltaY < 0 ? 1.1 : 0.9)));
      const wx = (mx - panX) / before;
      const wy = (my - panY) / before;
      scale = next;
      panX = mx - wx * scale;
      panY = my - wy * scale;
      applyTransform();
    },
    { passive: false },
  );
}
