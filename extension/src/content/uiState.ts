import type { ItemAnalysisResponse } from "../types/messages";

export interface OverlayRecord {
  id: string;
  target: Element;
  container: HTMLElement;
  data: ItemAnalysisResponse;
  dismissed: boolean;
}

const overlayMap = new Map<string, OverlayRecord>();
const dismissedIds = new Set<string>();
const lastPayloadById = new Map<string, ItemAnalysisResponse>();

const OVERLAY_ENABLED_KEY = "overlayEnabled";

export async function setGlobalEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.session.set({ [OVERLAY_ENABLED_KEY]: enabled });
}

export async function getGlobalEnabled(): Promise<boolean> {
  const result = await chrome.storage.session.get(OVERLAY_ENABLED_KEY);
  const value = result[OVERLAY_ENABLED_KEY];
  return value === undefined ? true : Boolean(value);
}

export async function toggleGlobalEnabled(): Promise<boolean> {
  const current = await getGlobalEnabled();
  const next = !current;
  await setGlobalEnabled(next);
  return next;
}

export function registerOverlay(record: OverlayRecord): void {
  overlayMap.set(record.id, { ...record, dismissed: false });
  dismissedIds.delete(record.id);
  lastPayloadById.set(record.id, record.data);
}

export function getOverlay(id: string): OverlayRecord | undefined {
  return overlayMap.get(id);
}

export function updateOverlayRecord(id: string, data: Partial<ItemAnalysisResponse>): void {
  const record = overlayMap.get(id);
  if (!record) {
    return;
  }
  record.data = { ...record.data, ...data };
  overlayMap.set(id, record);
  lastPayloadById.set(id, record.data);
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
