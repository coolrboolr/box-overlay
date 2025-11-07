import type { ItemAnalysisResponse } from "../types/messages";
import {
  type OverlayStatus,
  getOverlay,
  markDismissed,
  registerOverlay,
  removeOverlayRecord,
  updateOverlayRecord
} from "./uiState";
import { clearAnchor } from "./anchors";
import { recordEvent } from "./logStore";

export const OVERLAY_Z_INDEX = 2147483000;
const DEFAULT_TAG_LABEL = "Uncategorized";
const PLACEHOLDER_SUMMARY = "Analyzing…";

export interface OverlayRenderOptions {
  status?: OverlayStatus;
  errorMessage?: string;
  onRetry?: (() => void) | null;
}

let overlayOrderCounter = 0;

function shouldDock(): boolean {
  return document.body?.dataset.llmDock === "true";
}

function trackOverlaySuccess(
  id: string,
  nextStatus: OverlayStatus | undefined,
  previousStatus?: OverlayStatus
): void {
  if (nextStatus === "resolved" && previousStatus !== "resolved") {
    recordEvent("overlay-success", { id });
  }
}

function applyDockState(wrapper: HTMLElement): void {
  wrapper.classList.toggle("llm-overlay-wrapper--dock", shouldDock());
}

function ensureStatusElement(card: HTMLElement): HTMLElement {
  let statusEl = card.querySelector<HTMLElement>(".llm-overlay-status");
  if (!statusEl) {
    statusEl = document.createElement("div");
    statusEl.className = "llm-overlay-status";
    card.appendChild(statusEl);
  }
  return statusEl;
}

function removeElement(selector: string, root: HTMLElement): void {
  const el = root.querySelector(selector);
  if (el) {
    el.remove();
  }
}

function applyCardState(card: HTMLElement, record: ReturnType<typeof getOverlay>): void {
  if (!record) {
    return;
  }

  const data = record.data;
  const status = record.status;

  const summaryEl = card.querySelector<HTMLElement>(".llm-overlay-summary");
  const metaEl = card.querySelector<HTMLElement>(".llm-overlay-meta");
  if (!summaryEl || !metaEl) {
    return;
  }

  const statusEl = ensureStatusElement(card);
  statusEl.textContent = "";

  removeElement(".llm-overlay-spinner", statusEl);
  removeElement(".llm-overlay-retry", card);

  if (status === "pending") {
    summaryEl.textContent = PLACEHOLDER_SUMMARY;
    metaEl.hidden = true;

    const spinner = document.createElement("span");
    spinner.className = "llm-overlay-spinner";
    statusEl.appendChild(spinner);
    statusEl.appendChild(document.createTextNode("Analyzing…"));

    card.classList.add("llm-overlay-card--pending");
    card.classList.remove("llm-overlay-card--error");
    return;
  }

  if (status === "error") {
    summaryEl.textContent = record.errorMessage ?? "We couldn't analyze this content.";
    metaEl.hidden = true;
    statusEl.textContent = record.errorMessage ?? "Try again in a moment.";

    if (record.onRetry) {
      const retryButton = document.createElement("button");
      retryButton.type = "button";
      retryButton.className = "llm-overlay-retry";
      retryButton.textContent = "Retry";
      retryButton.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
        record.onRetry?.();
      });
      statusEl.appendChild(retryButton);
    }

    card.classList.add("llm-overlay-card--error");
    card.classList.remove("llm-overlay-card--pending");
    return;
  }

  // Resolved state
  card.classList.remove("llm-overlay-card--pending", "llm-overlay-card--error");
  metaEl.hidden = false;
  statusEl.textContent = "";

  const isOrganic = !data.is_ad && Boolean(data.image_tag);
  const isUncategorized = !data.is_ad && !data.image_tag;

  summaryEl.textContent = data.summary;

  card.classList.toggle("llm-overlay-card--ad", data.is_ad);
  card.classList.toggle("llm-overlay-card--organic", isOrganic);
  card.classList.toggle("llm-overlay-card--uncategorized", isUncategorized);

  const tagText = data.image_tag ?? (isUncategorized ? DEFAULT_TAG_LABEL : "");
  let tagEl = metaEl.querySelector<HTMLElement>(".llm-overlay-tag");
  if (tagText) {
    if (!tagEl) {
      tagEl = document.createElement("span");
      tagEl.className = "llm-overlay-tag";
      metaEl.prepend(tagEl);
    }
    tagEl.textContent = tagText;
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

export function renderOverlay(
  target: Element,
  data: ItemAnalysisResponse,
  options: OverlayRenderOptions = {}
): void {
  const existing = getOverlay(data.id);
  const previousStatus = existing?.status;
  if (existing) {
    removeOverlay(data.id, { releaseAnchor: false });
  }

  const computed = window.getComputedStyle(target);
  if (computed.position === "static") {
    (target as HTMLElement).style.position = "relative";
  }

  const wrapper = document.createElement("div");
  wrapper.className = "llm-overlay-wrapper";
  wrapper.dataset.overlayId = data.id;
  wrapper.style.setProperty("--llm-overlay-order", `${overlayOrderCounter++}`);
  applyDockState(wrapper);
  wrapper.setAttribute("role", "note");
  wrapper.setAttribute("aria-live", "polite");
  wrapper.style.zIndex = `${OVERLAY_Z_INDEX}`;

  const card = document.createElement("div");
  card.className = "llm-overlay-card";

  const summaryEl = document.createElement("div");
  summaryEl.className = "llm-overlay-summary";
  summaryEl.textContent = data.summary;
  card.appendChild(summaryEl);

  const metaEl = document.createElement("div");
  metaEl.className = "llm-overlay-meta";
  card.appendChild(metaEl);

  const statusEl = document.createElement("div");
  statusEl.className = "llm-overlay-status";
  card.appendChild(statusEl);

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

  registerOverlay({
    id: data.id,
    target,
    container: wrapper,
    data,
    dismissed: false,
    status: options.status ?? "resolved",
    errorMessage: options.errorMessage,
    onRetry: options.onRetry ?? null
  });

  const record = getOverlay(data.id);
  applyCardState(card, record);
  trackOverlaySuccess(data.id, record?.status, previousStatus);
}

export function updateOverlay(
  id: string,
  data: ItemAnalysisResponse,
  options: OverlayRenderOptions = {}
): void {
  const previousStatus = getOverlay(id)?.status;
  const record = updateOverlayRecord(id, {
    data,
    status: options.status,
    errorMessage: options.errorMessage,
    onRetry: options.onRetry ?? null
  });
  if (!record) {
    return;
  }
  const card = record.container.querySelector<HTMLElement>(".llm-overlay-card");
  if (card) {
    applyCardState(card, record);
  }
  trackOverlaySuccess(id, record.status, previousStatus);
}

export function updateOverlayStatus(
  id: string,
  status: OverlayStatus,
  extras: { errorMessage?: string; onRetry?: (() => void) | null } = {}
): void {
  const previousStatus = getOverlay(id)?.status;
  const record = updateOverlayRecord(id, {
    status,
    errorMessage: extras.errorMessage,
    onRetry: extras.onRetry ?? null
  });
  if (!record) {
    return;
  }
  const card = record.container.querySelector<HTMLElement>(".llm-overlay-card");
  if (card) {
    applyCardState(card, record);
  }
  trackOverlaySuccess(id, record.status, previousStatus);
}

export function removeOverlay(id: string, options?: { releaseAnchor?: boolean }): void {
  const record = getOverlay(id);
  if (!record) {
    return;
  }
  record.container.remove();
  removeOverlayRecord(id);
  if (options?.releaseAnchor !== false) {
    clearAnchor(id);
  }
}
