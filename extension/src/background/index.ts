import type {
  AnalyzeError,
  ItemAnalysisRequest,
  ItemAnalysisResponse,
  RuntimeMessage
} from "../types/messages";
import { isDev } from "../shared/isDev";

function debug(...args: unknown[]): void {
  if (isDev) {
    console.info("[background]", ...args);
  }
}

function logError(...args: unknown[]): void {
  console.error("[background]", ...args);
}

class BackendRequestError extends Error {
  public readonly retryable: boolean;

  constructor(message: string, retryable: boolean, cause?: unknown) {
    super(message);
    this.name = "BackendRequestError";
    this.retryable = retryable;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

type QueueItem = {
  request: ItemAnalysisRequest;
  tabId: number;
  frameId?: number;
  attempt: number;
};

const API_BASE_URL = "http://127.0.0.1:5000";
const ANALYZE_ENDPOINT = `${API_BASE_URL}/api/analyze`;
const REGISTER_ORIGIN_ENDPOINT = `${API_BASE_URL}/api/dev/register-extension-origin`;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;

const queue: QueueItem[] = [];
let pendingCount = 0;
let devOriginRegistered = false;
let registerOriginPromise: Promise<void> | null = null;

function enqueueJob(item: QueueItem): void {
  queue.push(item);
  debug("enqueue job", item.request.id, "attempt", item.attempt);
  void processQueue();
}

async function processQueue(): Promise<void> {
  if (pendingCount >= MAX_CONCURRENCY) {
    return;
  }

  const next = queue.shift();
  if (!next) {
    return;
  }

  pendingCount += 1;

  void (async () => {
    try {
      await handleJob(next);
    } catch (error) {
      logError("handleJob threw unexpectedly", error);
    } finally {
      pendingCount -= 1;
      void processQueue();
    }
  })();
}

async function handleJob(item: QueueItem): Promise<void> {
  try {
    const response = await sendToBackend(item.request);
    debug("job success", item.request.id);
    sendResultToTab(item.tabId, item.frameId, {
      type: "ANALYZE_RESULT",
      payload: response
    });
  } catch (error) {
    const backendError = error instanceof BackendRequestError ? error : undefined;
    const retryable = backendError?.retryable ?? false;
    const message =
      backendError?.message ??
      (error instanceof Error ? error.message : "Unknown error communicating with backend");

    if (retryable && item.attempt < MAX_RETRIES) {
      const delay = BASE_BACKOFF_MS * Math.pow(2, item.attempt);
      debug(
        "retrying job",
        item.request.id,
        "attempt",
        item.attempt + 1,
        "in",
        `${delay}ms`
      );
      setTimeout(() => {
        enqueueJob({
          ...item,
          attempt: item.attempt + 1
        });
      }, delay);
      return;
    }

    const analyzeError: AnalyzeError = {
      id: item.request.id,
      error: message,
      retryable
    };

    debug("job failed", item.request.id, "retryable:", retryable, "message:", message);
    sendResultToTab(item.tabId, item.frameId, {
      type: "ANALYZE_ERROR",
      payload: analyzeError
    });
  }
}

async function sendToBackend(request: ItemAnalysisRequest): Promise<ItemAnalysisResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    await ensureDevOriginRegistration();

    if (isDev) {
      debug("dispatching backend request", {
        id: request.id,
        textLength: request.text.length,
        hasImage: Boolean(request.image)
      });
    }

    let response: Response;
    try {
      response = await fetch(ANALYZE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });
    } catch (networkError) {
      devOriginRegistered = false;
      throw networkError;
    }

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new BackendRequestError(`Backend responded with HTTP ${response.status}`, retryable);
    }

    if (isDev) {
      debug("backend response ok", {
        id: request.id,
        status: response.status
      });
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (parseError) {
      throw new BackendRequestError("Failed to parse backend response", false, parseError);
    }

    return normalizeAnalysisResponse(data);
  } catch (error) {
    if (error instanceof BackendRequestError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BackendRequestError("Backend request timed out", true, error);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new BackendRequestError(message, true, error);
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeAnalysisResponse(data: unknown): ItemAnalysisResponse {
  if (typeof data !== "object" || data === null) {
    throw new BackendRequestError("Backend response is not an object", false);
  }

  const record = data as Record<string, unknown>;
  const id = record.id;
  const summary = record.summary;
  const isAd = record.is_ad;
  const imageTag = record.image_tag;

  if (typeof id !== "string") {
    throw new BackendRequestError("Backend response missing id", false);
  }
  if (typeof summary !== "string") {
    throw new BackendRequestError("Backend response missing summary", false);
  }
  if (typeof isAd !== "boolean") {
    throw new BackendRequestError("Backend response missing is_ad flag", false);
  }

  let normalizedImageTag: string | undefined;
  if (typeof imageTag === "string" && imageTag.length > 0) {
    normalizedImageTag = imageTag;
  }

  return {
    id,
    summary,
    image_tag: normalizedImageTag,
    is_ad: isAd
  };
}

function getExtensionId(): string | null {
  try {
    return chrome.runtime.id ?? null;
  } catch (_error) {
    return null;
  }
}

async function ensureDevOriginRegistration(): Promise<void> {
  if (devOriginRegistered) {
    return;
  }

  if (registerOriginPromise) {
    return registerOriginPromise;
  }

  const extensionId = getExtensionId();
  if (!extensionId) {
    devOriginRegistered = true;
    return;
  }

  const url = `${REGISTER_ORIGIN_ENDPOINT}?id=${encodeURIComponent(extensionId)}`;
  registerOriginPromise = fetch(url, {
    method: "POST",
    mode: "no-cors",
    keepalive: true
  })
    .then(() => {
      devOriginRegistered = true;
      if (isDev) {
        debug("requested dev origin registration", extensionId);
      }
    })
    .catch((error) => {
      devOriginRegistered = false;
      if (isDev) {
        debug("dev origin registration failed", error);
      }
    })
    .finally(() => {
      registerOriginPromise = null;
    });

  return registerOriginPromise;
}

function isValidRequest(payload: unknown): payload is ItemAnalysisRequest {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.text === "string" &&
    record.text.length > 0 &&
    (record.image === undefined || typeof record.image === "string")
  );
}

function sendResultToTab(
  tabId: number,
  frameId: number | undefined,
  message: RuntimeMessage
): void {
  const callback = (): void => {
    const err = chrome.runtime.lastError;
    if (err && isDev) {
      debug("sendMessage to tab failed:", err.message);
    }
  };

  if (frameId !== undefined) {
    chrome.tabs.sendMessage(tabId, message, { frameId }, callback);
  } else {
    chrome.tabs.sendMessage(tabId, message, callback);
  }
}

chrome.runtime.onMessage.addListener((rawMessage, sender) => {
  if (!rawMessage || typeof rawMessage !== "object") {
    return;
  }

  const message = rawMessage as RuntimeMessage;

  if (message.type !== "ANALYZE_REQUEST") {
    return;
  }

  const tabId = sender.tab?.id;
  if (tabId == null) {
    logError("Received ANALYZE_REQUEST without tabId");
    return;
  }

  if (!isValidRequest(message.payload)) {
    logError("Received invalid ANALYZE_REQUEST payload", message.payload);
    return;
  }

  if (isDev) {
    debug("received ANALYZE_REQUEST", {
      id: message.payload.id,
      tabId,
      frameId: sender.frameId
    });
  }

  enqueueJob({
    request: message.payload,
    tabId,
    frameId: sender.frameId,
    attempt: 0
  });

  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-overlays") {
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id == null) {
        return;
      }

      chrome.tabs.sendMessage(
        tab.id,
        { type: "TOGGLE_OVERLAYS" },
        undefined,
        () => {
          const err = chrome.runtime.lastError;
          if (err && isDev) {
            debug("toggle-overlays sendMessage error:", err.message);
          }
        }
      );
    });
  });
});

chrome.runtime.onInstalled.addListener(() => {
  debug("service worker installed");
});

debug("service worker initialized");
void ensureDevOriginRegistration();
