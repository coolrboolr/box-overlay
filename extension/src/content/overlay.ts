import type { ItemAnalysisResponse } from "../types/messages";
import {
  getOverlay,
  markDismissed,
  registerOverlay,
  removeOverlayRecord,
  updateOverlayRecord
} from "./uiState";

export const OVERLAY_Z_INDEX = 2147483000;

function applyCardState(card: HTMLElement, data: ItemAnalysisResponse): void {
  card.classList.toggle("llm-overlay-card--ad", data.is_ad);
  card.classList.toggle("llm-overlay-card--organic", !data.is_ad);

  const summaryEl = card.querySelector<HTMLElement>(".llm-overlay-summary");
  if (summaryEl) {
    summaryEl.textContent = data.summary;
  }

  const metaEl = card.querySelector<HTMLElement>(".llm-overlay-meta");
  if (!metaEl) {
    return;
  }

  let tagEl = metaEl.querySelector<HTMLElement>(".llm-overlay-tag");
  if (data.image_tag) {
    if (!tagEl) {
      tagEl = document.createElement("span");
      tagEl.className = "llm-overlay-tag";
      metaEl.prepend(tagEl);
    }
    tagEl.textContent = data.image_tag;
  } else if (tagEl) {
    tagEl.remove();
  }

  let badgeEl = metaEl.querySelector<HTMLElement>(".llm-overlay-badge");
  if (data.is_ad) {
    if (!badgeEl) {
      badgeEl = document.createElement("span");
      badgeEl.className = "llm-overlay-badge";
      metaEl.appendChild(badgeEl);
    }
    badgeEl.textContent = "Ad";
  } else if (badgeEl) {
    badgeEl.remove();
  }
}

export function renderOverlay(target: Element, data: ItemAnalysisResponse): void {
  const existing = getOverlay(data.id);
  if (existing) {
    existing.container.remove();
    removeOverlayRecord(data.id);
  }

  const computed = window.getComputedStyle(target);
  if (computed.position === "static") {
    (target as HTMLElement).style.position = "relative";
  }

  const wrapper = document.createElement("div");
  wrapper.className = "llm-overlay-wrapper";
  wrapper.dataset.overlayId = data.id;
  wrapper.setAttribute("role", "note");
  wrapper.setAttribute("aria-live", "polite");

  const card = document.createElement("div");
  card.className = "llm-overlay-card";

  const summaryEl = document.createElement("div");
  summaryEl.className = "llm-overlay-summary";
  summaryEl.textContent = data.summary;
  card.appendChild(summaryEl);

  const metaEl = document.createElement("div");
  metaEl.className = "llm-overlay-meta";
  card.appendChild(metaEl);

  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.className = "llm-overlay-dismiss";
  dismissButton.setAttribute("aria-label", "Dismiss overlay");
  dismissButton.textContent = "×";
  dismissButton.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    markDismissed(data.id);
    removeOverlay(data.id);
  });
  card.appendChild(dismissButton);

  wrapper.appendChild(card);
  target.appendChild(wrapper);

  applyCardState(card, data);

  registerOverlay({
    id: data.id,
    target,
    container: wrapper,
    data,
    dismissed: false
  });
}

export function updateOverlay(id: string, data: ItemAnalysisResponse): void {
  const record = getOverlay(id);
  if (!record) {
    return;
  }

  const card = record.container.querySelector<HTMLElement>(".llm-overlay-card");
  if (!card) {
    return;
  }

  applyCardState(card, data);
  updateOverlayRecord(id, data);
}

export function removeOverlay(id: string): void {
  const record = getOverlay(id);
  if (!record) {
    return;
  }
  record.container.remove();
  removeOverlayRecord(id);
}
