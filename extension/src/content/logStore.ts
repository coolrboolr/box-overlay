import { isDev } from "../shared/isDev";

export type TelemetryEventType =
  | "scan"
  | "request"
  | "overlay-success"
  | "retry"
  | "error"
  | "forbidden-recovery"
  | "forbidden-error"
  | "batch-fallback";

export interface TelemetryEntry {
  type: TelemetryEventType;
  timestamp: number;
  detail?: Record<string, unknown>;
}

export interface TelemetryStats {
  scannedNodes: number;
  requestsQueued: number;
  overlaysResolved: number;
  retries: number;
  errors: number;
  forbiddenRecoveries: number;
  forbiddenErrors: number;
  batchFallbacks: number;
}

const DEFAULT_STATS: TelemetryStats = {
  scannedNodes: 0,
  requestsQueued: 0,
  overlaysResolved: 0,
  retries: 0,
  errors: 0,
  forbiddenRecoveries: 0,
  forbiddenErrors: 0,
  batchFallbacks: 0
};

const STORAGE_KEY = "overlayTelemetryLogs";
const MAX_ENTRIES = 100;

let stats: TelemetryStats = { ...DEFAULT_STATS };
let entries: TelemetryEntry[] = [];
let initialized = false;
let storageBlocked = false;
let updateScheduled = false;
let storageWarningLogged = false;
const listeners = new Set<() => void>();

const hasChromeStorage =
  typeof chrome !== "undefined" &&
  typeof chrome.storage?.session?.get === "function" &&
  typeof chrome.storage?.session?.set === "function";

function logStorageFallback(message: string, error?: unknown): void {
  if (!isDev) {
    return;
  }
  if (storageWarningLogged) {
    return;
  }
  storageWarningLogged = true;
  if (error) {
    console.debug("[content] telemetry storage fallback:", message, error);
  } else {
    console.debug("[content] telemetry storage fallback:", message);
  }
}

type StatKey = keyof TelemetryStats;
const eventToStat: Record<TelemetryEventType, StatKey | null> = {
  scan: "scannedNodes",
  request: "requestsQueued",
  "overlay-success": "overlaysResolved",
  retry: "retries",
  error: "errors",
  "forbidden-recovery": "forbiddenRecoveries",
  "forbidden-error": "forbiddenErrors",
  "batch-fallback": "batchFallbacks"
};

function scheduleNotify(): void {
  if (updateScheduled) {
    return;
  }
  updateScheduled = true;
  const schedule =
    typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (cb: FrameRequestCallback) => setTimeout(cb, 0);
  schedule(() => {
    updateScheduled = false;
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    });
  });
}

function persist(): void {
  if (!hasChromeStorage || storageBlocked) {
    if (!hasChromeStorage) {
      logStorageFallback("chrome.storage.session not available");
    }
    return;
  }
  const payload = {
    stats,
    entries
  };
  try {
    chrome.storage.session.set({ [STORAGE_KEY]: payload }, () => {
      const err = chrome.runtime?.lastError;
      if (err) {
        storageBlocked = true;
        logStorageFallback("session storage rejected writes", err);
      }
    });
  } catch (error) {
    storageBlocked = true;
    logStorageFallback("session storage threw synchronously", error);
  }
}

function loadFromStorage(): void {
  if (!hasChromeStorage || storageBlocked) {
    if (!hasChromeStorage) {
      storageBlocked = true;
      logStorageFallback("chrome.storage.session not available");
    }
    initialized = true;
    return;
  }
  try {
    chrome.storage.session.get(STORAGE_KEY, (result) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        storageBlocked = true;
        initialized = true;
        logStorageFallback("session storage get failed", err);
        return;
      }
      const stored = result?.[STORAGE_KEY];
      if (stored) {
        if (stored.stats) {
          stats = { ...DEFAULT_STATS, ...stored.stats };
        }
        if (Array.isArray(stored.entries)) {
          entries = stored.entries.slice(-MAX_ENTRIES);
        }
      }
      initialized = true;
      scheduleNotify();
    });
  } catch (error) {
    storageBlocked = true;
    initialized = true;
    logStorageFallback("session storage get threw", error);
  }
}

export function initTelemetryStore(): void {
  if (initialized || !isDev) {
    return;
  }
  loadFromStorage();
}

export function getStats(): TelemetryStats {
  return stats;
}

export function getEntries(): TelemetryEntry[] {
  return entries;
}

export function recordEvent(type: TelemetryEventType, detail?: Record<string, unknown>): void {
  if (!isDev) {
    return;
  }

  const statKey = eventToStat[type];
  if (statKey) {
    const increment = type === "scan" ? Number(detail?.count ?? 0) : 1;
    stats = {
      ...stats,
      [statKey]: Math.max(0, stats[statKey] + increment)
    };
  }

  entries = [
    ...entries,
    {
      type,
      timestamp: Date.now(),
      detail
    }
  ].slice(-MAX_ENTRIES);

  scheduleNotify();
  persist();
}

export function __resetTelemetryStoreForTests(): void {
  stats = { ...DEFAULT_STATS };
  entries = [];
  initialized = false;
  storageBlocked = false;
  storageWarningLogged = false;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function exportLogs(): Promise<string> {
  const payload = JSON.stringify(
    {
      stats,
      entries
    },
    null,
    2
  );

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(payload);
      console.info("[content] telemetry copied to clipboard");
      return payload;
    } catch (error) {
      console.warn("[content] failed to copy telemetry; falling back to console", error);
    }
  }

  console.info("[content] telemetry export\n", payload);
  return payload;
}
