import { initializeScanner } from "./domScan";
import { getOrCreateItemId, markProcessed, resetProcessed } from "./state";
import { extractItems } from "./extract";
import { getActiveProfile } from "./siteProfiles";
import {
  clearDismissed,
  clearLastRequestPayload,
  forEachOverlay,
  getDockMode,
  getGlobalEnabled,
  getLastPayload,
  getLastRequestPayload,
  getOverlay,
  rememberRequestPayload,
  markDismissed,
  toggleDockMode as toggleDockModeSetting,
  toggleGlobalEnabled,
  wasDismissed
} from "./uiState";
import { renderOverlay, removeOverlay, updateOverlay, updateOverlayStatus } from "./overlay";
import { clearAnchor, getAnchor } from "./anchors";
import {
  SCHEMA_VERSION,
  type ItemAnalysisRequest,
  type ItemAnalysisResponse,
  type AnalyzeError,
  type RuntimeMessage,
  type DevTelemetryEventPayload,
  type MemoryIndexResponse
} from "../types/messages";
import { isDev } from "../shared/isDev";
import { exportLogs, initTelemetryStore, recordEvent } from "./logStore";
import { mountDebugHud, unmountDebugHud } from "./debugHud";
import { createMemoryCaptureController } from "./memoryCapture";

const activeProfile = getActiveProfile();
const candidateSelector = activeProfile.selectors.join(",");

const PENDING_SUMMARY = "Analyzing…";
const memoryCapture = createMemoryCaptureController();

let overlaysEnabled = true;
let dockEnabled = false;
const anchorRetryIds = new Set<string>();
const anchorRetryAttempts = new Map<string, number>();
let anchorRetryCount = 0;
let rescanInFlight: Promise<boolean> = Promise.resolve(false);
const MAX_ANCHOR_RECOVER_ATTEMPTS = 3;

function debug(...args: unknown[]): void {
  if (isDev) {
    console.info("[content]", ...args);
  }
}

debug("loaded", window.location.href);

if (isDev) {
  initTelemetryStore();
  mountDebugHud();
  const teardownHud = () => {
    unmountDebugHud();
  };
  window.addEventListener("pagehide", teardownHud);
  window.addEventListener("beforeunload", teardownHud);
}

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
  rememberRequestPayload(item.id, item);
  ensurePendingOverlay(item);
  recordEvent("request", {
    id: item.id,
    textLength: item.text.length,
    hasImage: Boolean(item.image)
  });
  if (isDev) {
    debug("send analyze", {
      id: item.id,
      textLength: item.text.length,
      hasImage: Boolean(item.image)
    });
  }
  const message: RuntimeMessage = {
    schemaVersion: SCHEMA_VERSION,
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
  const candidate = message as { type?: unknown; schemaVersion?: unknown };
  if (candidate.schemaVersion !== SCHEMA_VERSION) {
    return false;
  }
  return (
    candidate.type === "ANALYZE_REQUEST" ||
    candidate.type === "ANALYZE_RESULT" ||
    candidate.type === "ANALYZE_ERROR" ||
    candidate.type === "ANALYZE_BATCH_RESULT" ||
    candidate.type === "TOGGLE_OVERLAYS" ||
    candidate.type === "DEV_TELEMETRY_EVENT" ||
    candidate.type === "MEMORY_INDEX_RESULT" ||
    candidate.type === "MEMORY_CAPTURE_NOW"
  );
}

function findTargetElementById(id: string): Element | null {
  if (!candidateSelector) {
    return null;
  }
  const candidates = document.querySelectorAll<Element>(candidateSelector);
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
  const prevTag = previous.image?.kind === "tag" ? previous.image.tag : "";
  const nextTag = next.image?.kind === "tag" ? next.image.tag : "";
  return (
    previous.summary !== next.summary ||
    prevTag !== nextTag ||
    previous.isAd !== next.isAd
  );
}

async function handleAnalyzeResult(payload: ItemAnalysisResponse): Promise<void> {
  const existing = getOverlay(payload.id);
  const persistedTarget =
    existing?.target && existing.target.isConnected ? existing.target : null;
  const anchor = persistedTarget ?? getAnchor(payload.id);
  const anchorMissing = !anchor || !anchor.isConnected;
  let target = anchor && anchor.isConnected ? anchor : null;

  if (!target) {
    target = findTargetElementById(payload.id);
  }

  if (!target) {
    if (existing) {
      removeOverlay(payload.id);
    }
    await recoverMissingOverlayTarget(payload.id);
    return;
  }

  anchorRetryIds.delete(payload.id);
  anchorRetryAttempts.delete(payload.id);

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
      removeOverlay(payload.id, { releaseAnchor: false });
      renderOverlay(target, payload);
      return;
    }

    updateOverlay(payload.id, payload, { status: "resolved" });
    hideOverlayIfDisabled(payload.id);
    return;
  }

  if (!overlaysEnabled) {
    return;
  }

  if (wasDismissed(payload.id) && !payloadChanged) {
    return;
  }

  renderOverlay(target, payload);
  hideOverlayIfDisabled(payload.id);
  clearLastRequestPayload(payload.id);

  if (anchorMissing) {
    await recoverMissingOverlayTarget(payload.id);
  }
}

function handleAnalyzeError(payload: AnalyzeError): void {
  recordEvent("error", {
    id: payload.id,
    retryable: payload.retryable,
    message: payload.error,
    statusCode: payload.statusCode,
    details: payload.details
  });

  if (payload.details === "FORBIDDEN_ORIGIN") {
    recordEvent("forbidden-error", {
      id: payload.id,
      statusCode: payload.statusCode
    });
  }
  const target = getAnchor(payload.id) ?? findTargetElementById(payload.id);
  if (!target) {
    if (isDev) {
      debug("missing target for error payload", payload.id);
    }
    return;
  }

  const existing = getLastPayload(payload.id);
  const fallback: ItemAnalysisResponse = existing ?? {
    id: payload.id,
    summary: formatErrorMessage(payload),
    isAd: false
  };

  const request = getLastRequestPayload(payload.id);
  const onRetry =
    payload.retryable && request
      ? () => {
          recordEvent("retry", { reason: "user", id: payload.id });
          ensurePendingOverlay(request);
          sendAnalyzeRequest(request);
        }
      : undefined;

  const errorMessage = formatErrorMessage(payload);

  renderOverlay(target, fallback, {
    status: "error",
    errorMessage,
    onRetry: onRetry ?? null
  });
  hideOverlayIfDisabled(payload.id);
}

function formatErrorMessage(payload: AnalyzeError): string {
  let message = payload.error;
  if (payload.statusCode) {
    message = `${message} (HTTP ${payload.statusCode})`;
  }
  if (payload.details) {
    message = `${message} – ${payload.details}`;
  }
  return message;
}

async function recoverMissingOverlayTarget(id: string): Promise<void> {
  const attempts = anchorRetryAttempts.get(id) ?? 0;
  if (attempts >= MAX_ANCHOR_RECOVER_ATTEMPTS) {
    if (isDev) {
      console.warn("[content] anchor-miss-cap", { id, attempts });
    }
    return;
  }

  if (anchorRetryIds.has(id)) {
    return;
  }

  const nextAttempt = attempts + 1;
  anchorRetryIds.add(id);
  anchorRetryAttempts.set(id, nextAttempt);
  anchorRetryCount += 1;
  recordEvent("retry", { reason: "anchor", id, attempt: nextAttempt });
  if (isDev) {
    debug("anchor retry", { id, count: anchorRetryCount, attempt: nextAttempt });
  }

  clearAnchor(id);

  try {
    const recovered = await queueRescanForIds([id]);
    if (recovered) {
      anchorRetryAttempts.delete(id);
      return;
    }

    if (isDev) {
      console.warn("[content] anchor-miss", { id, attempt: nextAttempt });
    }

    if (nextAttempt >= MAX_ANCHOR_RECOVER_ATTEMPTS) {
      removeOverlay(id);
      markDismissed(id);
      recordEvent("error", { id, reason: "anchor-miss-max" });
    }
  } finally {
    anchorRetryIds.delete(id);
  }
}

function queueRescanForIds(ids: string[]): Promise<boolean> {
  const idSet = new Set(ids);
  const job = async (): Promise<boolean> => {
    resetProcessed();
    forEachOverlay((record) => {
      markProcessed(record.target);
    });

    const items = await extractItems(document);
    let matched = false;
    for (const item of items) {
      if (idSet.has(item.id)) {
        matched = true;
        sendAnalyzeRequest(item);
      }
    }
    return matched;
  };

  rescanInFlight = rescanInFlight.then(job, job);
  rescanInFlight = rescanInFlight.catch((error) => {
    console.error("[content] rescan failed", error);
    return false;
  });
  return rescanInFlight;
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

function hideOverlayIfDisabled(id: string): void {
  if (overlaysEnabled) {
    return;
  }
  const record = getOverlay(id);
  record?.container.classList.add("llm-overlay-hidden");
}

function ensurePendingOverlay(item: ItemAnalysisRequest): void {
  if (wasDismissed(item.id)) {
    return;
  }

  const existing = getOverlay(item.id);
  const target =
    existing?.target ??
    getAnchor(item.id) ??
    findTargetElementById(item.id);

  if (!target) {
    return;
  }

  if (existing) {
    updateOverlayStatus(item.id, "pending");
    hideOverlayIfDisabled(item.id);
    return;
  }

  renderOverlay(
    target,
    {
      id: item.id,
      summary: PENDING_SUMMARY,
      isAd: false
    },
    { status: "pending" }
  );
  hideOverlayIfDisabled(item.id);
}

async function handleDockToggle(): Promise<void> {
  dockEnabled = await toggleDockModeSetting();
  applyDockMode(dockEnabled);
  if (isDev) {
    debug("dock mode", dockEnabled ? "enabled" : "disabled");
  }
}

function applyDockMode(enabled: boolean): void {
  if (enabled) {
    document.body.dataset.llmDock = "true";
  } else {
    delete document.body.dataset.llmDock;
  }
  forEachOverlay((record) => {
    record.container.classList.toggle("llm-overlay-wrapper--dock", enabled);
  });
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

void (async () => {
  try {
    dockEnabled = await getDockMode();
  } catch (error) {
    if (isDev) {
      console.warn("[content] failed to read dock mode state; defaulting to float", error);
    }
    dockEnabled = false;
  }
  applyDockMode(dockEnabled);
})();

debug("initializeScanner start");

initializeScanner((batch) => {
  if (isDev && batch.length) {
    debug("extracted batch", batch);
  }
  batch.forEach(sendAnalyzeRequest);
  memoryCapture.notifyScan(batch.length);
});

window.addEventListener("keydown", (event) => {
  const isDockShortcut =
    event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyD";
  if (isDockShortcut) {
    if (shouldIgnoreKeyEvent(event)) {
      return;
    }
    event.preventDefault();
    void handleDockToggle();
    return;
  }

  const isExportShortcut =
    isDev && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyL";
  if (isExportShortcut) {
    if (shouldIgnoreKeyEvent(event)) {
      return;
    }
    event.preventDefault();
    void exportLogs();
    return;
  }

  const isMemoryShortcut =
    event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyM";
  if (isMemoryShortcut) {
    if (shouldIgnoreKeyEvent(event)) {
      return;
    }
    event.preventDefault();
    memoryCapture.handleCaptureCommand({ force: true });
    return;
  }

  if (!event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) {
    return;
  }

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
    case "ANALYZE_BATCH_RESULT":
      if (isDev) {
        debug("batch result summary", message.payload);
      }
      break;
    case "ANALYZE_RESULT":
      void handleAnalyzeResult(message.payload);
      break;
    case "ANALYZE_ERROR":
      handleAnalyzeError(message.payload);
      break;
    case "DEV_TELEMETRY_EVENT":
      handleDevTelemetryEvent(message.payload);
      break;
    case "MEMORY_INDEX_RESULT":
      memoryCapture.handleResult(message.payload as MemoryIndexResponse);
      break;
    case "MEMORY_CAPTURE_NOW":
      memoryCapture.handleCaptureCommand(message.payload ?? { force: true });
      break;
    default:
      break;
  }
});
function handleDevTelemetryEvent(payload: DevTelemetryEventPayload): void {
  switch (payload.event) {
    case "FORBIDDEN_RECOVERY":
      recordEvent("forbidden-recovery", payload.detail);
      break;
    case "BATCH_FALLBACK":
      recordEvent("batch-fallback", payload.detail);
      break;
    default:
      break;
  }
}
