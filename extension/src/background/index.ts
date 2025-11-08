import type {
  BatchAnalysisResponse,
  BatchAnalysisResult,
  AnalyzeError,
  DevTelemetryEventName,
  ItemAnalysisRequest,
  ItemAnalysisResponse,
  RuntimeMessage
} from "../types/messages";
import { SCHEMA_VERSION } from "../types/messages";
import { isDev } from "../shared/isDev";

declare const process: {
  env?: {
    ENABLE_BATCH?: string;
  };
};
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
  public readonly statusCode?: number;
  public readonly details?: string;

  constructor(
    message: string,
    options: { retryable: boolean; statusCode?: number; details?: string; cause?: unknown }
  ) {
    super(message);
    this.name = "BackendRequestError";
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
    this.details = options.details;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
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
const ANALYZE_BATCH_ENDPOINT = `${API_BASE_URL}/api/analyze/batch`;
const REGISTER_ORIGIN_ENDPOINT = `${API_BASE_URL}/api/dev/register-extension-origin`;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const MAX_BATCH_SIZE = 4;
const ENABLE_BATCH_MODE =
  typeof process !== "undefined" && process.env?.ENABLE_BATCH === "true";

const queue: QueueItem[] = [];
let pendingCount = 0;
let devOriginRegistered = false;
let registerOriginPromise: Promise<void> | null = null;
let batchEndpointAvailable = ENABLE_BATCH_MODE;

interface BackendRequestOptions {
  onForbiddenRecovery?: () => void;
}

function isForbiddenStatus(statusCode?: number): boolean {
  return statusCode === 401 || statusCode === 403;
}

function resetDevOriginState(): void {
  devOriginRegistered = false;
  registerOriginPromise = null;
}

async function withDevRegistrationRetry<T>(
  operation: () => Promise<T>,
  context: string,
  onRecovery?: () => void
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const backendError = error instanceof BackendRequestError ? error : null;
    if (!backendError || !isForbiddenStatus(backendError.statusCode)) {
      throw error;
    }

    debug("forcing dev origin re-registration after forbidden response", {
      context,
      status: backendError.statusCode
    });

    resetDevOriginState();
    await ensureDevOriginRegistration({ force: true });

    const result = await operation();
    onRecovery?.();
    return result;
  }
}

function enqueueJob(item: QueueItem): void {
  queue.push(item);
  debug("enqueue job", item.request.id, "attempt", item.attempt);
  void processQueue();
}

async function processQueue(): Promise<void> {
  if (pendingCount >= MAX_CONCURRENCY) {
    return;
  }

  if (!queue.length) {
    return;
  }

  const batchMode = shouldUseBatchProcessing();
  const jobItems = batchMode ? dequeueBatchItems() : [queue.shift()!];
  if (!jobItems.length) {
    return;
  }

  pendingCount += 1;

  void (async () => {
    try {
      if (batchMode) {
        await handleBatchJob(jobItems);
      } else {
        await handleJob(jobItems[0]);
      }
    } catch (error) {
      logError("job handler threw unexpectedly", error);
    } finally {
      pendingCount -= 1;
      void processQueue();
    }
  })();
}

function shouldUseBatchProcessing(): boolean {
  return ENABLE_BATCH_MODE && batchEndpointAvailable;
}

function dequeueBatchItems(): QueueItem[] {
  const items: QueueItem[] = [];
  const targetSize = Math.min(MAX_BATCH_SIZE, Math.max(1, queue.length));
  while (items.length < targetSize && queue.length > 0) {
    const next = queue.shift();
    if (next) {
      items.push(next);
    }
  }
  return items;
}

async function handleJob(item: QueueItem): Promise<void> {
  try {
    const response = await sendToBackend(item.request, {
      onForbiddenRecovery: () => {
        emitDevTelemetryEvent(item.tabId, item.frameId, "FORBIDDEN_RECOVERY", {
          id: item.request.id,
          mode: "single"
        });
      }
    });
    debug("job success", item.request.id);
    emitAnalyzeResult(item, response);
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
      retryable,
      statusCode: backendError?.statusCode,
      details: backendError?.details
    };

    debug("job failed", item.request.id, "retryable:", retryable, "message:", message);
    emitAnalyzeError(item, analyzeError);
  }
}

function emitAnalyzeResult(item: QueueItem, payload: ItemAnalysisResponse): void {
  sendResultToTab(item.tabId, item.frameId, {
    schemaVersion: SCHEMA_VERSION,
    type: "ANALYZE_RESULT",
    payload
  });
}

function emitAnalyzeError(item: QueueItem, payload: AnalyzeError): void {
  sendResultToTab(item.tabId, item.frameId, {
    schemaVersion: SCHEMA_VERSION,
    type: "ANALYZE_ERROR",
    payload
  });
}

async function handleBatchJob(items: QueueItem[]): Promise<void> {
  if (!items.length) {
    return;
  }

  if (!shouldUseBatchProcessing()) {
    for (const item of items) {
      await handleJob(item);
    }
    return;
  }

  try {
    const response = await sendBatchToBackend(items, {
      onForbiddenRecovery: () => {
        items.forEach((job) => {
          emitDevTelemetryEvent(job.tabId, job.frameId, "FORBIDDEN_RECOVERY", {
            id: job.request.id,
            mode: "batch"
          });
        });
      }
    });
    routeBatchResults(items, response);
  } catch (error) {
    const backendError = error instanceof BackendRequestError ? error : undefined;
    if (backendError?.statusCode === 404) {
      batchEndpointAvailable = false;
      items.forEach((item) => {
        emitDevTelemetryEvent(item.tabId, item.frameId, "BATCH_FALLBACK", {
          ids: items.map((entry) => entry.request.id)
        });
        enqueueJob(item);
      });
      return;
    }

    logError("batch request failed; falling back to single requests", error);
    for (const item of items) {
      await handleJob(item);
    }
  }
}

function routeBatchResults(items: QueueItem[], response: BatchAnalysisResponse): void {
  const entriesById = new Map<string, BatchAnalysisResult>();
  for (const entry of response.results) {
    entriesById.set(entry.id, entry);
  }

  const perTabResults = new Map<number, BatchAnalysisResult[]>();

  for (const item of items) {
    const entry = entriesById.get(item.request.id);
    if (!entry) {
      emitAnalyzeError(item, {
        id: item.request.id,
        error: "Batch response missing entry",
        retryable: false
      });
      continue;
    }

    if ("result" in entry) {
      emitAnalyzeResult(item, entry.result);
    } else {
      emitAnalyzeError(item, entry.error);
    }

    const grouped = perTabResults.get(item.tabId);
    if (grouped) {
      grouped.push(entry);
    } else {
      perTabResults.set(item.tabId, [entry]);
    }
  }

  perTabResults.forEach((results, tabId) => {
    sendResultToTab(tabId, undefined, {
      schemaVersion: SCHEMA_VERSION,
      type: "ANALYZE_BATCH_RESULT",
      payload: {
        schemaVersion: response.schemaVersion,
        results
      }
    });
  });
}

async function sendBatchToBackend(
  items: QueueItem[],
  options?: BackendRequestOptions
): Promise<BatchAnalysisResponse> {
  const context = `batch:${items.map((item) => item.request.id).join(",")}`;
  return withDevRegistrationRetry(
    () => performBatchRequest(items),
    context,
    options?.onForbiddenRecovery
  );
}

async function performBatchRequest(items: QueueItem[]): Promise<BatchAnalysisResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    await ensureDevOriginRegistration();

    const payload = {
      schemaVersion: SCHEMA_VERSION,
      items: items.map((item) => item.request)
    };

    let response: Response;
    try {
      response = await fetch(ANALYZE_BATCH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (networkError) {
      resetDevOriginState();
      throw networkError;
    }

    if (response.status === 404) {
      throw new BackendRequestError("Batch endpoint not found", {
        retryable: false,
        statusCode: response.status
      });
    }

    if (!response.ok) {
      const retryable = isForbiddenStatus(response.status)
        ? true
        : response.status >= 500 || response.status === 429;
      let details: string | undefined;
      try {
        details = (await response.text()) || undefined;
      } catch {
        details = undefined;
      }
      throw new BackendRequestError(`Batch endpoint responded with HTTP ${response.status}`, {
        retryable,
        statusCode: response.status,
        details: isForbiddenStatus(response.status) ? "FORBIDDEN_ORIGIN" : details
      });
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (parseError) {
      throw new BackendRequestError("Failed to parse batch response", {
        retryable: false,
        cause: parseError
      });
    }

    return normalizeBatchResponse(data);
  } catch (error) {
    if (error instanceof BackendRequestError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BackendRequestError("Batch request timed out", {
        retryable: true,
        cause: error
      });
    }

    const message = error instanceof Error ? error.message : "Unknown batch error";
    throw new BackendRequestError(message, {
      retryable: true,
      cause: error
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendToBackend(
  request: ItemAnalysisRequest,
  options?: BackendRequestOptions
): Promise<ItemAnalysisResponse> {
  const context = `single:${request.id}`;
  return withDevRegistrationRetry(
    () => performSingleRequest(request),
    context,
    options?.onForbiddenRecovery
  );
}

async function performSingleRequest(request: ItemAnalysisRequest): Promise<ItemAnalysisResponse> {
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
      resetDevOriginState();
      throw networkError;
    }

    if (!response.ok) {
      const retryable = isForbiddenStatus(response.status)
        ? true
        : response.status >= 500 || response.status === 429;
      let details: string | undefined;
      try {
        details = (await response.text()) || undefined;
      } catch {
        details = undefined;
      }
      throw new BackendRequestError(`Backend responded with HTTP ${response.status}`, {
        retryable,
        statusCode: response.status,
        details: isForbiddenStatus(response.status) ? "FORBIDDEN_ORIGIN" : details
      });
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
      throw new BackendRequestError("Failed to parse backend response", {
        retryable: false,
        cause: parseError
      });
    }

    return normalizeAnalysisResponse(data);
  } catch (error) {
    if (error instanceof BackendRequestError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BackendRequestError("Backend request timed out", {
        retryable: true,
        cause: error
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new BackendRequestError(message, {
      retryable: true,
      cause: error
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeAnalysisResponse(data: unknown): ItemAnalysisResponse {
  if (typeof data !== "object" || data === null) {
    throw new BackendRequestError("Backend response is not an object", {
      retryable: false
    });
  }

  const record = data as Record<string, unknown>;
  const id = record.id;
  const summary = record.summary;
  const isAd = record.is_ad;
  const imageTag = record.image_tag;

  if (typeof id !== "string") {
    throw new BackendRequestError("Backend response missing id", {
      retryable: false
    });
  }
  if (typeof summary !== "string") {
    throw new BackendRequestError("Backend response missing summary", {
      retryable: false
    });
  }
  if (typeof isAd !== "boolean") {
    throw new BackendRequestError("Backend response missing is_ad flag", {
      retryable: false
    });
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

function normalizeBatchResponse(data: unknown): BatchAnalysisResponse {
  if (typeof data !== "object" || data === null) {
    throw new BackendRequestError("Batch response is not an object", {
      retryable: false
    });
  }

  const record = data as Record<string, unknown>;
  const version = record.schemaVersion;
  if (version !== SCHEMA_VERSION) {
    throw new BackendRequestError("Batch response schema version mismatch", {
      retryable: false
    });
  }

  const rawResults = record.results;
  if (!Array.isArray(rawResults)) {
    throw new BackendRequestError("Batch response missing results array", {
      retryable: false
    });
  }

  const results = rawResults.map((entry) => normalizeBatchEntry(entry));
  return {
    schemaVersion: SCHEMA_VERSION,
    results
  };
}

function normalizeBatchEntry(entry: unknown): BatchAnalysisResult {
  if (typeof entry !== "object" || entry === null) {
    throw new BackendRequestError("Batch entry is not an object", {
      retryable: false
    });
  }
  const record = entry as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new BackendRequestError("Batch entry missing id", {
      retryable: false
    });
  }

  if ("result" in record && record.result) {
    const normalized = normalizeAnalysisResponse(record.result);
    return { id, result: normalized };
  }

  if (typeof record.error === "object" && record.error !== null) {
    const errorRecord = record.error as Record<string, unknown>;
    const message =
      typeof errorRecord.error === "string" ? errorRecord.error : "Unknown error";
    const retryable = Boolean(errorRecord.retryable);
    const statusCode =
      typeof errorRecord.statusCode === "number" ? errorRecord.statusCode : undefined;
    const details =
      typeof errorRecord.details === "string" ? errorRecord.details : undefined;

    return {
      id,
      error: {
        id,
        error: message,
        retryable,
        statusCode,
        details
      }
    };
  }

  throw new BackendRequestError("Batch entry missing result/error payload", {
    retryable: false
  });
}

function getExtensionId(): string | null {
  try {
    return chrome.runtime.id ?? null;
  } catch (_error) {
    return null;
  }
}

interface EnsureRegistrationOptions {
  force?: boolean;
}

async function ensureDevOriginRegistration(
  options: EnsureRegistrationOptions = {}
): Promise<void> {
  if (!options.force && devOriginRegistered) {
    return;
  }

  if (!options.force && registerOriginPromise) {
    return registerOriginPromise;
  }

  const extensionId = getExtensionId();
  if (!extensionId) {
    devOriginRegistered = true;
    return;
  }

  if (options.force) {
    registerOriginPromise = null;
  }

  if (registerOriginPromise) {
    return registerOriginPromise;
  }

  const url = `${REGISTER_ORIGIN_ENDPOINT}?id=${encodeURIComponent(extensionId)}`;
  registerOriginPromise = fetch(url, {
    method: "POST",
    keepalive: true
  })
    .then((response) => {
      devOriginRegistered = response.ok;
      if (isDev) {
        debug(
          response.ok ? "requested dev origin registration" : "dev origin registration failed",
          response.ok ? extensionId : response.status
        );
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
    record.schemaVersion === SCHEMA_VERSION &&
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

function emitDevTelemetryEvent(
  tabId: number,
  frameId: number | undefined,
  event: DevTelemetryEventName,
  detail?: Record<string, unknown>
): void {
  sendResultToTab(tabId, frameId, {
    schemaVersion: SCHEMA_VERSION,
    type: "DEV_TELEMETRY_EVENT",
    payload: {
      event,
      detail
    }
  });
}

chrome.runtime.onMessage.addListener((rawMessage, sender) => {
  if (!rawMessage || typeof rawMessage !== "object") {
    return;
  }

  const message = rawMessage as RuntimeMessage;

  if (message.schemaVersion !== SCHEMA_VERSION) {
    logError("Received ANALYZE_REQUEST with mismatched schemaVersion", message.schemaVersion);
    return;
  }

  if (message.type === "DEV_FORCE_REGISTER") {
    void ensureDevOriginRegistration({ force: true });
    return;
  }

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

      sendResultToTab(tab.id, undefined, {
        schemaVersion: SCHEMA_VERSION,
        type: "TOGGLE_OVERLAYS",
        payload: undefined
      });
    });
  });
});

chrome.runtime.onInstalled.addListener(() => {
  resetDevOriginState();
  debug("service worker installed");
  void ensureDevOriginRegistration({ force: true });
});

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("activate", () => {
    resetDevOriginState();
    void ensureDevOriginRegistration({ force: true });
  });
}

debug("service worker initialized");
void ensureDevOriginRegistration();
