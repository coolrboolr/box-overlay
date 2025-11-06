import type { ItemAnalysisResponse } from "../types/messages";
import {
  getOverlay,
  markDismissed,
  registerOverlay,
  removeOverlayRecord,
  updateOverlayRecord
} from "./uiState";

export const OVERLAY_Z_INDEX = 2147483000;

const OVERLAY_STYLE_TEXT = `
.llm-overlay-wrapper {
  pointer-events: none;
  max-width: min(320px, 60vw);
}

.llm-overlay-card {
  background: rgba(17, 24, 39, 0.92);
  color: #f9fafb;
  font-size: 13px;
  line-height: 1.3;
  border-radius: 8px;
  padding: 8px 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.3);
  display: grid;
  gap: 6px;
  pointer-events: auto;
  position: relative;
  transition: transform 180ms ease, opacity 180ms ease;
}

.llm-overlay-card--organic {
  border-left: 3px solid #34d399;
}

.llm-overlay-card--ad {
  border-left: 3px solid #f87171;
  box-shadow: 0 8px 24px rgba(127, 29, 29, 0.35);
}

.llm-overlay-summary {
  font-weight: 500;
  word-break: break-word;
}

.llm-overlay-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.llm-overlay-tag {
  background: rgba(59, 130, 246, 0.18);
  color: #bfdbfe;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.llm-overlay-badge {
  background: rgba(248, 113, 113, 0.16);
  color: #fecaca;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.llm-overlay-dismiss {
  position: absolute;
  top: 4px;
  right: 6px;
  background: transparent;
  border: none;
  color: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.7;
  padding: 2px;
  transition: opacity 120ms ease;
}

.llm-overlay-dismiss:hover,
.llm-overlay-dismiss:focus {
  opacity: 1;
}

.llm-overlay-hidden {
  display: none !important;
}
`.trim();

let stylesInjected = false;

function ensureOverlayStylesInjected(): void {
  if (stylesInjected) {
    return;
  }
  const styleEl = document.createElement("style");
  styleEl.id = "llm-overlay-styles";
  styleEl.textContent = OVERLAY_STYLE_TEXT;
  document.head.appendChild(styleEl);
  stylesInjected = true;
}

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
  ensureOverlayStylesInjected();

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
  wrapper.style.position = "absolute";
  wrapper.style.bottom = "8px";
  wrapper.style.right = "8px";
  wrapper.style.pointerEvents = "none";
  wrapper.style.zIndex = String(OVERLAY_Z_INDEX);

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
