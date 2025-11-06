import { extractItems } from "./extract";
import { CANDIDATE_SELECTORS } from "./domSelectors";
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

const RESCAN_INTERVAL_MS = 5000;
let overlaysEnabled = true;

function sendAnalyzeRequest(item: ItemAnalysisRequest): void {
  const message: RuntimeMessage = {
    type: "ANALYZE_REQUEST",
    payload: item
  };

  chrome.runtime.sendMessage(message, () => {
    const err = chrome.runtime.lastError;
    if (err) {
      console.debug("[content] sendMessage error (background pending?):", err.message);
    }
  });
}

function isRuntimeMessage(message: unknown): message is RuntimeMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const candidate = message as { type?: unknown; payload?: unknown };
  if (candidate.type === "ANALYZE_REQUEST" || candidate.type === "ANALYZE_RESULT") {
    return true;
  }
  return false;
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
    console.debug("[content] no target found for overlay", payload.id);
    return;
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
  console.debug("[content] overlays", overlaysEnabled ? "enabled" : "disabled");
}

async function scanAndSend(): Promise<void> {
  try {
    const items = await extractItems(document);
    if (items.length > 0) {
      console.debug("[content] extracted items", items);
      items.forEach(sendAnalyzeRequest);
    }
  } catch (error) {
    console.error("[content] extract/send failed", error);
  }
}

// Initial scan on load.
void scanAndSend();

// Periodic rescan; later specs may swap this for a MutationObserver.
setInterval(() => {
  void scanAndSend();
}, RESCAN_INTERVAL_MS);

void (async () => {
  overlaysEnabled = await getGlobalEnabled();
  if (!overlaysEnabled) {
    console.debug("[content] overlays start disabled");
  }
})();

chrome.runtime.onMessage.addListener((message) => {
  if (
    message &&
    typeof message === "object" &&
    (message as { type?: unknown }).type === "TOGGLE_OVERLAYS"
  ) {
    void handleToggleOverlays();
    return;
  }

  if (!isRuntimeMessage(message)) {
    return;
  }

  if (message.type === "ANALYZE_RESULT") {
    void handleAnalyzeResult(message.payload);
  }
});
