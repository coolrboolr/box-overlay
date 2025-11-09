import { resolveAnchor, rememberAnchor } from "./anchors";
import {
  cleanText,
  computeMinTextLength,
  hasEnoughStructure,
  hasMedia,
  isNumericOrSymbolHeavy,
  matchesRelaxedPatterns
} from "./extract";
import { isLikelyArticleElement } from "./domSelectors";
import { getActiveProfile } from "./siteProfiles";
import { getOrCreateItemId } from "./state";
import { recordEvent } from "./logStore";
import { isDev } from "../shared/isDev";
import {
  MEMORY_SCHEMA_VERSION,
  SCHEMA_VERSION,
  type MemoryIndexItem,
  type MemoryIndexResponse,
  type RuntimeMessage
} from "../types/messages";

declare const process: {
  env?: {
    MEMORY_CAPTURE_DEFAULT?: string;
  };
};

const MEMORY_SOURCE_ATTR = "data-llm-memory-source";
const MEMORY_INDEXED_ATTR = "data-llm-memory-indexed";
const MEMORY_INITIAL_DELAY_MS = 3_000;
const MEMORY_HARVEST_DEBOUNCE_MS = 1_500;
const MAX_ITEMS_PER_PAYLOAD = 5;
const MAX_ITEMS_PER_PASS = 20;
const MEMORY_TEXT_MAX_LENGTH = 2_000;
const MEMORY_CAPTURE_ENABLED_KEY = "memoryCaptureEnabled";
const DEFAULT_MEMORY_CAPTURE_ENABLED = Boolean(
  typeof process !== "undefined" && process.env?.MEMORY_CAPTURE_DEFAULT === "true"
);

const activeProfile = getActiveProfile();
const candidateSelector = activeProfile.selectors.join(",");

interface HarvestOptions {
  force?: boolean;
  flush?: boolean;
}

export interface MemoryCaptureController {
  notifyScan(batchSize: number): void;
  handleCaptureCommand(options?: { force?: boolean }): void;
  handleResult(response: MemoryIndexResponse): void;
}

export function createMemoryCaptureController(): MemoryCaptureController {
  const controller = new MemoryCaptureController();
  controller.init();
  return controller;
}

class MemoryCaptureController {
  private enabled = false;
  private readyAt = 0;
  private harvestTimer: number | null = null;
  private harvesting = false;
  private pendingHarvest: HarvestOptions | null = null;
  private destroyed = false;

  init(): void {
    if (this.destroyed) {
      return;
    }
    if (isIncognitoContext()) {
      this.enabled = false;
      return;
    }
    void this.loadInitialState();
  }

  notifyScan(batchSize: number): void {
    if (!this.enabled || batchSize === 0) {
      return;
    }
    this.scheduleHarvest({});
  }

  handleCaptureCommand(options?: { force?: boolean }): void {
    if (!this.enabled) {
      if (isDev) {
        console.info("[content] memory capture command ignored; feature disabled");
      }
      return;
    }
    this.scheduleHarvest({ force: true, flush: true, ...options });
  }

  handleResult(response: MemoryIndexResponse): void {
    if (!this.enabled) {
      return;
    }
    if (isDev) {
      debug("memory result", response.counts);
    }
    recordEvent("memory-index-result", {
      ...response.counts
    });
    response.results.forEach((result) => {
      const status = result.status;
      if (status === "failed") {
        clearMemoryMarker(result.id);
      } else {
        markMemoryStored(result.id);
      }
    });
  }

  private async loadInitialState(): Promise<void> {
    const stored = await readMemoryFlag();
    this.enabled = stored;
    if (!this.enabled) {
      return;
    }
    this.readyAt = Date.now() + MEMORY_INITIAL_DELAY_MS;
    this.scheduleHarvest({});
  }

  private scheduleHarvest(options: HarvestOptions): void {
    if (!this.enabled) {
      return;
    }
    const now = Date.now();
    const earliest = options.force ? now : Math.max(this.readyAt, now);
    const delay = options.force ? 0 : Math.max(earliest - now, MEMORY_HARVEST_DEBOUNCE_MS);

    if (this.harvesting) {
      this.pendingHarvest = {
        force: this.pendingHarvest?.force || options.force,
        flush: this.pendingHarvest?.flush || options.flush
      };
      return;
    }

    if (this.harvestTimer !== null) {
      window.clearTimeout(this.harvestTimer);
    }
    this.harvestTimer = window.setTimeout(() => {
      this.harvestTimer = null;
      void this.harvest(options);
    }, delay);
  }

  private async harvest(options: HarvestOptions): Promise<void> {
    if (!this.enabled) {
      return;
    }
    if (!candidateSelector) {
      return;
    }

    this.harvesting = true;
    try {
      const items = buildMemoryItems({ force: options.force });
      if (!items.length) {
        return;
      }
      recordEvent("memory-index", {
        count: items.length,
        flush: Boolean(options.flush)
      });
      const chunks = chunk(items, MAX_ITEMS_PER_PAYLOAD);
      for (const chunkItems of chunks) {
        sendMemoryRequest(chunkItems, Boolean(options.flush));
      }
    } finally {
      this.harvesting = false;
      if (this.pendingHarvest) {
        const pending = this.pendingHarvest;
        this.pendingHarvest = null;
        this.scheduleHarvest(pending);
      }
    }
  }
}

function debug(...args: unknown[]): void {
  if (isDev) {
    console.info("[content][memory]", ...args);
  }
}

function isIncognitoContext(): boolean {
  try {
    return Boolean(chrome?.extension?.inIncognitoContext);
  } catch {
    return false;
  }
}

function readMemoryFlag(): Promise<boolean> {
  if (!chrome?.storage?.sync?.get) {
    return Promise.resolve(DEFAULT_MEMORY_CAPTURE_ENABLED);
  }
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(MEMORY_CAPTURE_ENABLED_KEY, (result) => {
        const err = chrome.runtime?.lastError;
        if (err) {
          if (isDev) {
            console.warn("[content] memory flag read failed", err);
          }
          resolve(DEFAULT_MEMORY_CAPTURE_ENABLED);
          return;
        }
        const value = result?.[MEMORY_CAPTURE_ENABLED_KEY];
        if (typeof value === "boolean") {
          resolve(value);
        } else {
          resolve(DEFAULT_MEMORY_CAPTURE_ENABLED);
        }
      });
    } catch (error) {
      if (isDev) {
        console.warn("[content] memory flag read threw", error);
      }
      resolve(DEFAULT_MEMORY_CAPTURE_ENABLED);
    }
  });
}

function buildMemoryItems(options: { force?: boolean }): MemoryIndexItem[] {
  if (!candidateSelector) {
    return [];
  }
  const nodes = Array.from(document.querySelectorAll<Element>(candidateSelector));
  if (!nodes.length) {
    return [];
  }

  const pageUrl = window.location.href;
  const pageTitle = document.title?.trim() || undefined;
  const pageLanguage = document.documentElement?.lang || navigator.language || undefined;
  const captureTimestamp = new Date().toISOString();

  const items: MemoryIndexItem[] = [];

  for (const element of nodes) {
    const anchor = resolveAnchor(element);
    const alreadyIndexed = anchor.getAttribute(MEMORY_INDEXED_ATTR);
    if (!options.force && alreadyIndexed) {
      continue;
    }

    const structuredContent = hasEnoughStructure(element);
    const mediaContent = hasMedia(element);
    const passesFilters =
      structuredContent ||
      isLikelyArticleElement(element, activeProfile) ||
      matchesRelaxedPatterns(element, activeProfile.relaxedAttributePattern);
    if (!passesFilters) {
      continue;
    }

    const text = cleanText(element, MEMORY_TEXT_MAX_LENGTH);
    if (!text) {
      continue;
    }
    if (!options.force && isNumericOrSymbolHeavy(text)) {
      continue;
    }

    const minTextLength = computeMinTextLength(
      structuredContent,
      mediaContent,
      activeProfile.minTextLength
    );
    if (!options.force && text.length < minTextLength) {
      continue;
    }

    const sourceId = getOrCreateItemId(anchor);
    rememberAnchor(sourceId, anchor);

    const item: MemoryIndexItem = {
      id: sourceId,
      sourceId,
      text,
      url: pageUrl,
      title: pageTitle,
      contentType: activeProfile.name,
      capturedAt: captureTimestamp,
      language: pageLanguage
    };

    const imageTag = extractImageTag(element);
    if (imageTag) {
      item.imageTag = imageTag;
    }

    markMemoryPending(anchor, sourceId);
    items.push(item);

    if (items.length >= MAX_ITEMS_PER_PASS) {
      break;
    }
  }

  return items;
}

function extractImageTag(element: Element): string | undefined {
  const img = element.querySelector<HTMLImageElement>("img[alt]");
  const alt = img?.alt?.trim();
  if (alt) {
    return alt;
  }
  const figureCaption = element.querySelector<HTMLParagraphElement>("figcaption, [data-caption]");
  const captionText = figureCaption?.textContent?.trim();
  return captionText || undefined;
}

function markMemoryPending(anchor: Element, id: string): void {
  anchor.setAttribute(MEMORY_SOURCE_ATTR, id);
  anchor.setAttribute(MEMORY_INDEXED_ATTR, "pending");
}

function markMemoryStored(id: string): void {
  const target = findElementByMemoryId(id);
  if (!target) {
    return;
  }
  target.setAttribute(MEMORY_INDEXED_ATTR, "stored");
}

function clearMemoryMarker(id: string): void {
  const target = findElementByMemoryId(id);
  if (!target) {
    return;
  }
  target.removeAttribute(MEMORY_INDEXED_ATTR);
}

function findElementByMemoryId(id: string): Element | null {
  if (!id) {
    return null;
  }
  const selectorValue = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
  return document.querySelector(`[${MEMORY_SOURCE_ATTR}="${selectorValue}"]`);
}

function sendMemoryRequest(items: MemoryIndexItem[], flush: boolean): void {
  if (!items.length) {
    return;
  }
  const message: RuntimeMessage = {
    schemaVersion: SCHEMA_VERSION,
    type: "MEMORY_INDEX_REQUEST",
    payload: {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      items,
      flush
    }
  };

  chrome.runtime.sendMessage(message, () => {
    const err = chrome.runtime.lastError;
    if (err && isDev) {
      console.warn("[content] memory request failed to queue", err.message);
    }
  });
}

export function __testBuildMemoryItems(options?: { force?: boolean }): MemoryIndexItem[] {
  return buildMemoryItems(options ?? {});
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}
