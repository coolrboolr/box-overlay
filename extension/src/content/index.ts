import { CANDIDATE_SELECTORS } from "./domSelectors";
import { initializeScanner } from "./domScan";
import { getOrCreateItemId } from "./state";
import {
  clearDismissed,
  forEachOverlay,
  getGlobalEnabled,
  getLastPayload,
  getOverlay,
  toggleGlobalEnabled,
  wasDismissed
} from "./uiState";
import { renderOverlay, removeOverlay, updateOverlay } from "./overlay";
import type {
  ItemAnalysisRequest,
  ItemAnalysisResponse,
  RuntimeMessage
} from "../types/messages";
import { isDev } from "../shared/isDev";

let overlaysEnabled = true;

function debug(...args: unknown[]): void {
  if (isDev) {
    console.info("[content]", ...args);
  }
}

debug("loaded", window.location.href);

function shouldIgnoreKeyEvent(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return false;
  }
  const tagName = target.tagName?.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return false;
}

function sendAnalyzeRequest(item: ItemAnalysisRequest): void {
  if (isDev) {
    debug("send analyze", {
      id: item.id,
      textLength: item.text.length,
      hasImage: Boolean(item.image)
    });
  }
  const message: RuntimeMessage = {
    type: "ANALYZE_REQUEST",
    payload: item
  };

  chrome.runtime.sendMessage(message, () => {
    const err = chrome.runtime.lastError;
    if (err && isDev) {
      debug("sendMessage error (background pending?):", err.message);
    }
  });
}

function isRuntimeMessage(message: unknown): message is RuntimeMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const candidate = message as { type?: unknown };
  return (
    candidate.type === "ANALYZE_REQUEST" ||
    candidate.type === "ANALYZE_RESULT" ||
    candidate.type === "ANALYZE_ERROR" ||
    candidate.type === "TOGGLE_OVERLAYS"
  );
}

function findTargetElementById(id: string): Element | null {
  const selector = CANDIDATE_SELECTORS.join(",");
  if (!selector) {
    return null;
  }
  const candidates = document.querySelectorAll<Element>(selector);
  for (const candidate of candidates) {
    const candidateId = getOrCreateItemId(candidate);
    if (candidateId === id) {
      return candidate;
    }
  }
  return null;
}

function hasPayloadChanged(
  previous: ItemAnalysisResponse | undefined,
  next: ItemAnalysisResponse
): boolean {
  if (!previous) {
    return true;
  }
  return (
    previous.summary !== next.summary ||
    previous.image_tag !== next.image_tag ||
    previous.is_ad !== next.is_ad
  );
}

async function handleAnalyzeResult(payload: ItemAnalysisResponse): Promise<void> {
  const existing = getOverlay(payload.id);
  const target = existing?.target ?? findTargetElementById(payload.id);

  if (!target) {
    if (isDev) {
      debug("no target found for overlay", payload.id);
    }
    return;
  }

  if (isDev) {
    debug("handle result", {
      id: payload.id,
      hasExisting: Boolean(existing)
    });
  }

  const lastPayload = getLastPayload(payload.id);
  const payloadChanged = hasPayloadChanged(lastPayload, payload);

  if (existing) {
    if (existing.dismissed && !payloadChanged) {
      return;
    }

    if (existing.dismissed && payloadChanged) {
      clearDismissed(payload.id);
      removeOverlay(payload.id);
      renderOverlay(target, payload);
      return;
    }

    updateOverlay(payload.id, payload);
    return;
  }

  if (!overlaysEnabled) {
    return;
  }

  if (wasDismissed(payload.id) && !payloadChanged) {
    return;
  }

  renderOverlay(target, payload);
}

async function handleToggleOverlays(): Promise<void> {
  overlaysEnabled = await toggleGlobalEnabled();
  forEachOverlay((record) => {
    const shouldShow = overlaysEnabled && !record.dismissed;
    record.container.classList.toggle("llm-overlay-hidden", !shouldShow);
  });
  if (isDev) {
    debug("overlays", overlaysEnabled ? "enabled" : "disabled");
  }
}

void (async () => {
  try {
    overlaysEnabled = await getGlobalEnabled();
    if (!overlaysEnabled && isDev) {
      debug("overlays start disabled");
    }
  } catch (error) {
    if (isDev) {
      console.warn("[content] failed to read overlay toggle state; defaulting to enabled", error);
    }
    overlaysEnabled = true;
  }
})();

debug("initializeScanner start");

initializeScanner((batch) => {
  if (isDev && batch.length) {
    debug("extracted batch", batch);
  }
  batch.forEach(sendAnalyzeRequest);
});

window.addEventListener("keydown", (event) => {
  // Require only Alt/Option
  if (!event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) {
    return;
  }

  // Use physical key so layouts/modifiers (e.g., Option+L => "¬" on macOS) still work.
  if (event.code !== "KeyL") {
    return;
  }

  if (shouldIgnoreKeyEvent(event)) {
    return;
  }

  event.preventDefault();
  void handleToggleOverlays();
});

chrome.runtime.onMessage.addListener((message) => {
  if (!isRuntimeMessage(message)) {
    return;
  }

  switch (message.type) {
    case "TOGGLE_OVERLAYS":
      void handleToggleOverlays();
      break;
    case "ANALYZE_RESULT":
      void handleAnalyzeResult(message.payload);
      break;
    case "ANALYZE_ERROR":
      debug("analyze error", message.payload);
      break;
    default:
      break;
  }
});
