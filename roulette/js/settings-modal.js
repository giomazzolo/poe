/**
 * Settings dialogs (gear button → modal).
 */
export function initSettingsModal() {
  initDialog({
    dialogId: "skill-settings",
    openBtnId: "skill-settings-toggle",
  });
  initDialog({
    dialogId: "ascendancy-settings",
    openBtnId: "ascendancy-settings-toggle",
  });
  initInfoTips();
}

function initDialog({ dialogId, openBtnId }) {
  const dialog = document.getElementById(dialogId);
  const openBtn = document.getElementById(openBtnId);
  if (!dialog || !openBtn || typeof dialog.showModal !== "function") return;

  const open = () => {
    if (dialog.open) return;
    dialog.showModal();
    openBtn.setAttribute("aria-expanded", "true");
  };

  const close = () => {
    if (!dialog.open) return;
    dialog.close();
  };

  openBtn.addEventListener("click", open);
  for (const btn of dialog.querySelectorAll("[data-close-modal]")) {
    btn.addEventListener("click", close);
  }

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  dialog.addEventListener("close", () => {
    openBtn.setAttribute("aria-expanded", "false");
    openBtn.focus();
    for (const panel of document.querySelectorAll(".info-tip__panel:popover-open")) {
      panel.hidePopover?.();
    }
  });
}

/** Position info popovers near their trigger (top-layer, escapes modal overflow). */
function initInfoTips() {
  const tips = [
    ["info-tip-roll-trans", "info-roll-transfigured"],
    ["info-tip-painful", "info-painful-skills"],
  ];

  for (const [btnId, panelId] of tips) {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel || typeof panel.showPopover !== "function") continue;

    panel.addEventListener("toggle", () => {
      if (!panel.matches(":popover-open")) return;
      const rect = btn.getBoundingClientRect();
      const gap = 8;
      const width = panel.offsetWidth || 280;
      const left = Math.min(
        Math.max(12, rect.left + rect.width / 2 - width / 2),
        window.innerWidth - width - 12,
      );
      let top = rect.bottom + gap;
      if (top + panel.offsetHeight > window.innerHeight - 12) {
        top = Math.max(12, rect.top - panel.offsetHeight - gap);
      }
      panel.style.top = `${top}px`;
      panel.style.left = `${left}px`;
    });
  }
}
