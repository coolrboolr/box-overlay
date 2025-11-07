import type { ItemAnalysisRequest } from "../types/messages";
import { extractItems } from "./extract";
import { recordEvent } from "./logStore";

const SCAN_DEBOUNCE_MS = 250;
const INITIAL_SCAN_DELAY_MS = 120;
const MAX_ITEMS_PER_SCAN = 40;
const MAX_ITEMS_PER_BATCH = 8;

let observer: MutationObserver | null = null;
let scheduled = false;
let debounceHandle: number | null = null;
let cleanupHandle: (() => void) | null = null;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function isExtensionContextInvalid(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof (error as { message?: unknown }).message === "string"
          ? String((error as { message: unknown }).message)
          : "";
  return message.toLowerCase().includes("extension context invalidated");
}

function stopScanner(): void {
  cleanupHandle?.();
  cleanupHandle = null;
}

async function runScan(callback: (batch: ItemAnalysisRequest[]) => void): Promise<void> {
  scheduled = false;
  try {
    const items = await extractItems(document);
    recordEvent("scan", { count: items.length });
    if (!items.length) {
      return;
    }
    const limited = items.slice(0, MAX_ITEMS_PER_SCAN);
    for (const group of chunk(limited, MAX_ITEMS_PER_BATCH)) {
      callback(group);
    }
  } catch (error) {
    if (isExtensionContextInvalid(error)) {
      console.info("[content] scanner stopped: extension context invalidated");
      stopScanner();
      return;
    }
    console.error("[content] scan failed", error);
  }
}

function scheduleScan(callback: (batch: ItemAnalysisRequest[]) => void, delay = SCAN_DEBOUNCE_MS): void {
  if (scheduled) {
    return;
  }
  scheduled = true;
  if (debounceHandle !== null) {
    window.clearTimeout(debounceHandle);
  }
  debounceHandle = window.setTimeout(() => {
    debounceHandle = null;
    void runScan(callback);
  }, delay);
}

export function initializeScanner(
  callback: (batch: ItemAnalysisRequest[]) => void
): () => void {
  const target = document.body ?? document.documentElement;
  if (!target) {
    throw new Error("Unable to initialize scanner: document has no body");
  }

  scheduleScan(callback, INITIAL_SCAN_DELAY_MS);

  observer = new MutationObserver(() => {
    scheduleScan(callback);
  });

  observer.observe(target, {
    subtree: true,
    childList: true,
    characterData: false
  });

  window.addEventListener("pageshow", () => {
    scheduleScan(callback, INITIAL_SCAN_DELAY_MS);
  });

  const teardown = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (debounceHandle !== null) {
      window.clearTimeout(debounceHandle);
      debounceHandle = null;
    }
    scheduled = false;
  };

  cleanupHandle = teardown;

  return () => {
    if (cleanupHandle === teardown) {
      cleanupHandle = null;
    }
    teardown();
  };
}

export { isExtensionContextInvalid };
