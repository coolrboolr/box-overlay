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

declare const process: {
  env?: {
    NODE_ENV?: string;
  };
};

const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

let overlaysEnabled = true;

function sendAnalyzeRequest(item: ItemAnalysisRequest): void {
  const message: RuntimeMessage = {
    type: "ANALYZE_REQUEST",
    payload: item
  };

  chrome.runtime.sendMessage(message, () => {
    const err = chrome.runtime.lastError;
    if (err && isDev) {
      console.debug("[content] sendMessage error (background pending?):", err.message);
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
      console.debug("[content] no target found for overlay", payload.id);
    }
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
  if (isDev) {
    console.debug("[content] overlays", overlaysEnabled ? "enabled" : "disabled");
  }
}

void (async () => {
  overlaysEnabled = await getGlobalEnabled();
  if (!overlaysEnabled && isDev) {
    console.debug("[content] overlays start disabled");
  }
})();

initializeScanner((batch) => {
  if (isDev && batch.length) {
    console.debug("[content] extracted batch", batch);
  }
  batch.forEach(sendAnalyzeRequest);
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
      if (isDev) {
        console.debug("[content] analyze error", message.payload);
      }
      break;
    default:
      break;
  }
});
