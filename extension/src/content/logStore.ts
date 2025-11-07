import { isDev } from "../shared/isDev";

export type TelemetryEventType = "scan" | "request" | "overlay-success" | "retry" | "error";

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
}

const DEFAULT_STATS: TelemetryStats = {
  scannedNodes: 0,
  requestsQueued: 0,
  overlaysResolved: 0,
  retries: 0,
  errors: 0
};

const STORAGE_KEY = "overlayTelemetryLogs";
const MAX_ENTRIES = 100;

let stats: TelemetryStats = { ...DEFAULT_STATS };
let entries: TelemetryEntry[] = [];
let initialized = false;
let storageBlocked = false;
let updateScheduled = false;
const listeners = new Set<() => void>();

const hasChromeStorage =
  typeof chrome !== "undefined" &&
  typeof chrome.storage?.session?.get === "function" &&
  typeof chrome.storage?.session?.set === "function";

type StatKey = keyof TelemetryStats;
const eventToStat: Record<TelemetryEventType, StatKey | null> = {
  scan: "scannedNodes",
  request: "requestsQueued",
  "overlay-success": "overlaysResolved",
  retry: "retries",
  error: "errors"
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
        if (isDev) {
          console.info("[content] telemetry storage blocked:", err.message);
        }
      }
    });
  } catch (error) {
    storageBlocked = true;
    if (isDev) {
      console.info("[content] telemetry storage failed:", error);
    }
  }
}

function loadFromStorage(): void {
  if (!hasChromeStorage || storageBlocked) {
    initialized = true;
    return;
  }
  try {
    chrome.storage.session.get(STORAGE_KEY, (result) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        storageBlocked = true;
        initialized = true;
        if (isDev) {
          console.info("[content] telemetry load failed:", err.message);
        }
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
    if (isDev) {
      console.info("[content] telemetry load failed:", error);
    }
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
