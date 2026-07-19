/**
 * Smooth open/close panels driven by .is-open + grid-template-rows.
 *
 * Used by:
 * - <details class="banned"> (legacy)
 * - .skill-pool__section--collapsible (Standard / Transfigured / Painful)
 *
 * Native [open] alone can't animate height (closed content is display:none).
 * Pattern: keep content in DOM; drive height with .is-open.
 */
const ANIM_MS = 350;

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function afterTransition(el) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (event.target !== el) return;
      if (event.propertyName !== "grid-template-rows") return;
      finish();
    };
    el.addEventListener("transitionend", onEnd);
    window.setTimeout(finish, ANIM_MS + 50);
  });
}

async function openPanel(panel, body, { onOpened } = {}) {
  if (panel.dataset.animating === "1") return;
  panel.dataset.animating = "1";

  if ("open" in panel) panel.open = true;
  panel.classList.remove("is-open");
  void body.offsetHeight;

  panel.classList.add("is-open");
  onOpened?.(true);

  if (!reducedMotion()) await afterTransition(body);
  panel.dataset.animating = "0";
}

async function closePanel(panel, body, { onOpened } = {}) {
  if (panel.dataset.animating === "1") return;
  panel.dataset.animating = "1";

  panel.classList.remove("is-open");
  onOpened?.(false);

  if (!reducedMotion()) await afterTransition(body);
  if ("open" in panel) panel.open = false;
  panel.dataset.animating = "0";
}

function wireToggle(panel, toggle, body) {
  const syncAria = (open) => {
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
  };

  if (panel.classList.contains("is-open") || panel.open) {
    panel.classList.add("is-open");
    if ("open" in panel) panel.open = true;
    syncAria(true);
  } else {
    syncAria(false);
  }

  toggle.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (panel.classList.contains("is-open")) {
        closePanel(panel, body, { onOpened: syncAria });
      } else {
        openPanel(panel, body, { onOpened: syncAria });
      }
    },
    true
  );
}

function wireCollapsibleSection(section) {
  if (!section || section.dataset.animatedDetails === "1") return;
  section.dataset.animatedDetails = "1";
  const toggle = section.querySelector(":scope > .skill-pool__section-head .skill-pool__collapse");
  const body = section.querySelector(":scope > .banned__body");
  if (toggle && body) wireToggle(section, toggle, body);
}

/** Wire every details.banned under root. Idempotent per element. */
export function enableAnimatedDetails(root = document) {
  for (const details of root.querySelectorAll("details.banned")) {
    if (details.dataset.animatedDetails === "1") continue;
    details.dataset.animatedDetails = "1";

    const summary = details.querySelector(":scope > summary");
    const body = details.querySelector(":scope > .banned__body");
    if (!summary || !body) continue;

    wireToggle(details, summary, body);
  }

  for (const section of root.querySelectorAll(".skill-pool__section--collapsible")) {
    wireCollapsibleSection(section);
  }
}
