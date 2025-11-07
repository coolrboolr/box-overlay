import type { ItemAnalysisRequest, ItemAnalysisResponse } from "../types/messages";
import { isDev } from "../shared/isDev";

export type OverlayStatus = "pending" | "resolved" | "error";

export interface OverlayRecord {
  id: string;
  target: Element;
  container: HTMLElement;
  data: ItemAnalysisResponse;
  dismissed: boolean;
  status: OverlayStatus;
  errorMessage?: string;
  onRetry?: (() => void) | null;
}

interface OverlayRecordUpdate {
  data?: Partial<ItemAnalysisResponse>;
  status?: OverlayStatus;
  errorMessage?: string;
  onRetry?: (() => void) | null;
}

const overlayMap = new Map<string, OverlayRecord>();
const dismissedIds = new Set<string>();
const lastPayloadById = new Map<string, ItemAnalysisResponse>();
const lastRequestById = new Map<string, ItemAnalysisRequest>();

const OVERLAY_ENABLED_KEY = "overlayEnabled";
const DOCK_MODE_KEY = "overlayDockMode";

let storageAccessBlocked = false;
let storageWarningLogged = false;

function isStorageAccessForbidden(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof (error as { message?: unknown }).message === "string"
          ? String((error as { message: unknown }).message)
          : undefined;
  if (!message) {
    return false;
  }
  return message.toLowerCase().includes("access to storage is not allowed");
}

function storageUnavailableWarning(action: string, error: unknown): void {
  const blocked = isStorageAccessForbidden(error);
  if (blocked) {
    storageAccessBlocked = true;
    return;
  }
  if (!isDev || storageWarningLogged) {
    return;
  }

  const info =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error;

  console.info(`[content] storage.${action} unavailable; falling back`, info);
  storageWarningLogged = true;
}

export async function setGlobalEnabled(enabled: boolean): Promise<void> {
  if (storageAccessBlocked) {
    return;
  }
  if (!chrome.storage?.session?.set) {
    storageUnavailableWarning("set", "session storage API missing");
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      chrome.storage.session.set({ [OVERLAY_ENABLED_KEY]: enabled }, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          storageUnavailableWarning("set", err.message);
        }
        resolve();
      });
    } catch (error) {
      storageUnavailableWarning("set", error);
      resolve();
    }
  });
}

export async function getGlobalEnabled(): Promise<boolean> {
  if (storageAccessBlocked) {
    return true;
  }
  if (!chrome.storage?.session?.get) {
    storageUnavailableWarning("get", "session storage API missing");
    return true;
  }

  return new Promise((resolve) => {
    try {
      chrome.storage.session.get(OVERLAY_ENABLED_KEY, (result) => {
        const err = chrome.runtime.lastError;
        if (err) {
          storageUnavailableWarning("get", err.message);
          resolve(true);
          return;
        }
        const value = result?.[OVERLAY_ENABLED_KEY];
        resolve(value === undefined ? true : Boolean(value));
      });
    } catch (error) {
      storageUnavailableWarning("get", error);
      resolve(true);
    }
  });
}

export async function toggleGlobalEnabled(): Promise<boolean> {
  const current = await getGlobalEnabled();
  const next = !current;
  await setGlobalEnabled(next);
  return next;
}

async function setDockModeInternal(enabled: boolean): Promise<void> {
  if (storageAccessBlocked) {
    return;
  }
  if (!chrome.storage?.session?.set) {
    storageUnavailableWarning("set", "session storage API missing");
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      chrome.storage.session.set({ [DOCK_MODE_KEY]: enabled }, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          storageUnavailableWarning("set", err.message);
        }
        resolve();
      });
    } catch (error) {
      storageUnavailableWarning("set", error);
      resolve();
    }
  });
}

export async function getDockMode(): Promise<boolean> {
  if (storageAccessBlocked) {
    return false;
  }
  if (!chrome.storage?.session?.get) {
    storageUnavailableWarning("get", "session storage API missing");
    return false;
  }
  return new Promise((resolve) => {
    try {
      chrome.storage.session.get(DOCK_MODE_KEY, (result) => {
        const err = chrome.runtime.lastError;
        if (err) {
          storageUnavailableWarning("get", err.message);
          resolve(false);
          return;
        }
        const value = result?.[DOCK_MODE_KEY];
        resolve(value === undefined ? false : Boolean(value));
      });
    } catch (error) {
      storageUnavailableWarning("get", error);
      resolve(false);
    }
  });
}

export async function toggleDockMode(): Promise<boolean> {
  const current = await getDockMode();
  const next = !current;
  await setDockModeInternal(next);
  return next;
}

export function registerOverlay(record: OverlayRecord): void {
  const normalized: OverlayRecord = {
    ...record,
    dismissed: false,
    status: record.status ?? "resolved",
    onRetry: record.onRetry ?? null
  };
  overlayMap.set(record.id, normalized);
  dismissedIds.delete(record.id);
  if (normalized.status === "resolved") {
    lastPayloadById.set(record.id, normalized.data);
  }
}

export function getOverlay(id: string): OverlayRecord | undefined {
  return overlayMap.get(id);
}

export function updateOverlayRecord(id: string, updates: OverlayRecordUpdate = {}): OverlayRecord | undefined {
  const record = overlayMap.get(id);
  if (!record) {
    return undefined;
  }

  if (updates.data) {
    record.data = { ...record.data, ...updates.data };
  }
  if (updates.status) {
    record.status = updates.status;
    if (updates.status !== "error") {
      record.errorMessage = undefined;
      record.onRetry = null;
    }
  }
  if (updates.errorMessage !== undefined) {
    record.errorMessage = updates.errorMessage;
  }
  if (updates.onRetry !== undefined) {
    record.onRetry = updates.onRetry;
  }

  overlayMap.set(id, record);

  if (record.status === "resolved") {
    lastPayloadById.set(id, record.data);
  }

  return record;
}

export function markDismissed(id: string): void {
  const record = overlayMap.get(id);
  if (record) {
    record.dismissed = true;
    overlayMap.set(id, record);
  }
  dismissedIds.add(id);
}

export function removeOverlayRecord(id: string): void {
  overlayMap.delete(id);
}

export function forEachOverlay(fn: (record: OverlayRecord) => void): void {
  overlayMap.forEach(fn);
}

export function wasDismissed(id: string): boolean {
  return dismissedIds.has(id);
}

export function clearDismissed(id: string): void {
  dismissedIds.delete(id);
  const record = overlayMap.get(id);
  if (record) {
    record.dismissed = false;
    overlayMap.set(id, record);
  }
}

export function getLastPayload(id: string): ItemAnalysisResponse | undefined {
  return lastPayloadById.get(id);
}

export function rememberRequestPayload(id: string, payload: ItemAnalysisRequest): void {
  lastRequestById.set(id, payload);
}

export function getLastRequestPayload(id: string): ItemAnalysisRequest | undefined {
  return lastRequestById.get(id);
}

export function clearLastRequestPayload(id: string): void {
  lastRequestById.delete(id);
}
