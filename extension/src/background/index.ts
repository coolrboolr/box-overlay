import type {
  BatchAnalysisResponse,
  BatchAnalysisResult,
  AnalyzeError,
  DevTelemetryEventName,
  ItemAnalysisRequest,
  ItemAnalysisResponse,
  MemoryIndexItem,
  MemoryIndexRequest,
  MemoryIndexResponse,
  RuntimeMessage
} from "../types/messages";
import { SCHEMA_VERSION, MEMORY_SCHEMA_VERSION } from "../types/messages";
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
const MEMORY_INDEX_ENDPOINT = `${API_BASE_URL}/api/memory/index`;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const MAX_BATCH_SIZE = 4;
const ENABLE_BATCH_MODE =
  typeof process !== "undefined" && process.env?.ENABLE_BATCH === "true";
const MEMORY_MIN_READY_DELAY_MS = 3_000;
const MEMORY_FLUSH_DEBOUNCE_MS = 1_500;
const MEMORY_BATCH_SIZE = 5;
const MEMORY_QUEUE_LIMIT = 30;
const MEMORY_BACKOFF_BASE_MS = 2_000;
const MEMORY_BACKOFF_MAX_MS = 60_000;

const queue: QueueItem[] = [];
let pendingCount = 0;
let devOriginRegistered = false;
let registerOriginPromise: Promise<void> | null = null;
let batchEndpointAvailable = ENABLE_BATCH_MODE;

type MemoryQueueItem = {
  item: MemoryIndexItem;
  enqueuedAt: number;
};

interface MemoryQueueState {
  items: MemoryQueueItem[];
  readyAt: number;
  inFlight: boolean;
  flushTimer?: number;
  failureCount: number;
}

const memoryQueues = new Map<number, MemoryQueueState>();

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

function getOrCreateMemoryState(tabId: number): MemoryQueueState {
  let state = memoryQueues.get(tabId);
  if (!state) {
    state = {
      items: [],
      readyAt: Date.now() + MEMORY_MIN_READY_DELAY_MS,
      inFlight: false,
      failureCount: 0
    };
    memoryQueues.set(tabId, state);
  }
  return state;
}

function enqueueMemoryItems(tabId: number, payload: MemoryIndexRequest): void {
  const state = getOrCreateMemoryState(tabId);
  const now = Date.now();
  payload.items.forEach((item) => {
    state.items.push({ item, enqueuedAt: now });
  });

  if (state.items.length > MEMORY_QUEUE_LIMIT) {
    const overflow = state.items.length - MEMORY_QUEUE_LIMIT;
    const dropped = state.items.splice(0, overflow);
    if (dropped.length) {
      if (isDev) {
        debug("memory queue overflow", { tabId, dropped: dropped.length });
      }
      sendResultToTab(tabId, undefined, {
        schemaVersion: SCHEMA_VERSION,
        type: "MEMORY_INDEX_RESULT",
        payload: {
          schemaVersion: MEMORY_SCHEMA_VERSION,
          counts: { indexed: 0, duplicate: 0, failed: dropped.length },
          results: dropped.map(({ item }) => ({
            id: item.id,
            status: "failed",
            message: "queue-overflow"
          }))
        }
      });
    }
  }

  if (payload.flush) {
    state.readyAt = Date.now();
  }

  scheduleMemoryFlush(tabId, { force: Boolean(payload.flush) });
}

function scheduleMemoryFlush(tabId: number, options: { force?: boolean } = {}): void {
  const state = memoryQueues.get(tabId);
  if (!state || !state.items.length || state.inFlight) {
    return;
  }

  const now = Date.now();
  const delay = options.force ? 0 : Math.max(state.readyAt - now, MEMORY_FLUSH_DEBOUNCE_MS);

  if (state.flushTimer !== undefined) {
    clearTimeout(state.flushTimer);
  }

  state.flushTimer = setTimeout(() => {
    state.flushTimer = undefined;
    void flushMemoryQueue(tabId, state, options);
  }, Math.max(delay, 0));
}

async function flushMemoryQueue(
  tabId: number,
  state: MemoryQueueState,
  options: { force?: boolean } = {}
): Promise<void> {
  if (!state.items.length || state.inFlight) {
    return;
  }

  const now = Date.now();
  if (!options.force && now < state.readyAt) {
    scheduleMemoryFlush(tabId);
    return;
  }

  const batchEntries = state.items.splice(0, MEMORY_BATCH_SIZE);
  if (!batchEntries.length) {
    return;
  }

  state.inFlight = true;

  try {
    const response = await sendMemoryIndexRequest({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      items: batchEntries.map((entry) => entry.item)
    });

    sendResultToTab(tabId, undefined, {
      schemaVersion: SCHEMA_VERSION,
      type: "MEMORY_INDEX_RESULT",
      payload: response
    });

    state.failureCount = 0;
    state.readyAt = Date.now() + MEMORY_MIN_READY_DELAY_MS;
  } catch (error) {
    state.failureCount += 1;
    const backoff = Math.min(
      MEMORY_BACKOFF_BASE_MS * Math.pow(2, state.failureCount - 1),
      MEMORY_BACKOFF_MAX_MS
    );
    state.readyAt = Date.now() + backoff;
    state.items.unshift(...batchEntries);
    logError("memory index request failed", error);
  } finally {
    state.inFlight = false;
    if (state.items.length) {
      scheduleMemoryFlush(tabId);
    }
  }
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

async function sendMemoryIndexRequest(
  payload: MemoryIndexRequest,
  options?: BackendRequestOptions
): Promise<MemoryIndexResponse> {
  return withDevRegistrationRetry(
    () => performMemoryIndexRequest(payload),
    "memory",
    options?.onForbiddenRecovery
  );
}

async function performMemoryIndexRequest(payload: MemoryIndexRequest): Promise<MemoryIndexResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    await ensureDevOriginRegistration();

    const requestBody = {
      schemaVersion: payload.schemaVersion,
      items: payload.items
    };

    let response: Response;
    try {
      response = await fetch(MEMORY_INDEX_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
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
      throw new BackendRequestError(`Memory endpoint responded with HTTP ${response.status}`, {
        retryable,
        statusCode: response.status,
        details
      });
    }

    const data = await response.json();
    return normalizeMemoryIndexResponse(data);
  } catch (error) {
    if (error instanceof BackendRequestError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BackendRequestError("Memory request timed out", {
        retryable: true,
        cause: error
      });
    }
    throw new BackendRequestError(error instanceof Error ? error.message : String(error), {
      retryable: true,
      cause: error
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeMemoryIndexResponse(data: unknown): MemoryIndexResponse {
  if (typeof data !== "object" || data === null) {
    throw new BackendRequestError("Memory response is not an object", {
      retryable: false
    });
  }

  const record = data as Record<string, unknown>;
  if (record.schemaVersion !== MEMORY_SCHEMA_VERSION) {
    throw new BackendRequestError("Memory response schema mismatch", {
      retryable: false
    });
  }

  const counts = record.counts as Record<string, unknown> | undefined;
  if (!counts) {
    throw new BackendRequestError("Memory response missing counts", {
      retryable: false
    });
  }

  const results = record.results;
  if (!Array.isArray(results)) {
    throw new BackendRequestError("Memory response missing results array", {
      retryable: false
    });
  }

  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    counts: {
      indexed: Number(counts.indexed ?? 0) || 0,
      duplicate: Number(counts.duplicate ?? 0) || 0,
      failed: Number(counts.failed ?? 0) || 0
    },
    results: results.map((entry) => normalizeMemoryResult(entry))
  };
}

function normalizeMemoryResult(entry: unknown): MemoryIndexResponse["results"][number] {
  if (typeof entry !== "object" || entry === null) {
    throw new BackendRequestError("Memory result entry invalid", {
      retryable: false
    });
  }
  const record = entry as Record<string, unknown>;
  const id = record.id;
  const status = record.status;
  if (typeof id !== "string" || !id) {
    throw new BackendRequestError("Memory result missing id", {
      retryable: false
    });
  }
  if (status !== "indexed" && status !== "duplicate" && status !== "failed") {
    throw new BackendRequestError("Memory result has invalid status", {
      retryable: false
    });
  }
  const message = typeof record.message === "string" ? record.message : undefined;
  const storedIds = Array.isArray(record.storedIds)
    ? record.storedIds.filter((value): value is string => typeof value === "string" && value.length > 0)
    : undefined;
  return {
    id,
    status,
    message,
    storedIds
  };
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

function isValidMemoryIndexPayload(payload: unknown): payload is MemoryIndexRequest {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const record = payload as MemoryIndexRequest;
  if (record.schemaVersion !== MEMORY_SCHEMA_VERSION) {
    return false;
  }
  if (!Array.isArray(record.items) || record.items.length === 0) {
    return false;
  }
  return record.items.every((item) => isValidMemoryIndexItem(item));
}

function isValidMemoryIndexItem(item: unknown): item is MemoryIndexItem {
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const record = item as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.text === "string" &&
    record.text.length > 0
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

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  if (!rawMessage || typeof rawMessage !== "object") {
    return false;
  }

  const message = rawMessage as RuntimeMessage;

  if (message.schemaVersion !== SCHEMA_VERSION) {
    logError("Received ANALYZE_REQUEST with mismatched schemaVersion", message.schemaVersion);
    return false;
  }

  switch (message.type) {
    case "DEV_FORCE_REGISTER":
      void ensureDevOriginRegistration({ force: true });
      sendResponse?.({ status: "re-registering" });
      return false;
    case "ANALYZE_REQUEST":
      return handleAnalyzeMessage(message.payload, sender, sendResponse);
    case "MEMORY_INDEX_REQUEST":
      return handleMemoryIndexMessage(message.payload, sender, sendResponse);
    default:
      return false;
  }
});

function handleAnalyzeMessage(
  payload: ItemAnalysisRequest,
  sender: chrome.runtime.MessageSender,
  sendResponse?: (response?: unknown) => void
): boolean {
  const tabId = sender.tab?.id;
  if (tabId == null) {
    logError("Received ANALYZE_REQUEST without tabId");
    return false;
  }

  if (!isValidRequest(payload)) {
    logError("Received invalid ANALYZE_REQUEST payload", payload);
    return false;
  }

  if (isDev) {
    debug("received ANALYZE_REQUEST", {
      id: payload.id,
      tabId,
      frameId: sender.frameId
    });
  }

  enqueueJob({
    request: payload,
    tabId,
    frameId: sender.frameId,
    attempt: 0
  });

  sendResponse?.({ accepted: true });
  return false;
}

function handleMemoryIndexMessage(
  payload: MemoryIndexRequest,
  sender: chrome.runtime.MessageSender,
  sendResponse?: (response?: unknown) => void
): boolean {
  const tabId = sender.tab?.id;
  if (tabId == null) {
    logError("Received MEMORY_INDEX_REQUEST without tabId");
    return false;
  }

  if (!isValidMemoryIndexPayload(payload)) {
    logError("Received invalid MEMORY_INDEX_REQUEST payload", payload);
    return false;
  }

  enqueueMemoryItems(tabId, payload);
  sendResponse?.({ accepted: true });
  return false;
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-overlays") {
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
    return;
  }

  if (command === "save-to-memory") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id == null) {
          return;
        }

        sendResultToTab(tab.id, undefined, {
          schemaVersion: SCHEMA_VERSION,
          type: "MEMORY_CAPTURE_NOW",
          payload: { force: true }
        });
      });
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  resetDevOriginState();
  debug("service worker installed");
  void ensureDevOriginRegistration({ force: true });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const state = memoryQueues.get(tabId);
  if (state?.flushTimer !== undefined) {
    clearTimeout(state.flushTimer);
  }
  memoryQueues.delete(tabId);
});

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("activate", () => {
    resetDevOriginState();
    void ensureDevOriginRegistration({ force: true });
  });
}

debug("service worker initialized");
void ensureDevOriginRegistration();
