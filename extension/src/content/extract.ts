import { CANDIDATE_SELECTORS, isLikelyArticleElement } from "./domSelectors";
import { getOrCreateItemId, isProcessed, markProcessed } from "./state";
import type { ItemAnalysisRequest } from "../types/messages";

const MAX_TEXT_LENGTH = 1500;
const MIN_TEXT_LENGTH = 40;

export async function extractItems(root: Document | Element): Promise<ItemAnalysisRequest[]> {
  const selector = CANDIDATE_SELECTORS.join(",");
  if (!selector) {
    return [];
  }

  const candidates = Array.from(root.querySelectorAll<Element>(selector));
  const tasks = candidates.map(async (element) => {
    if (isProcessed(element)) {
      return null;
    }

    if (!isLikelyArticleElement(element)) {
      return null;
    }

    const text = cleanText(element);
    if (text.length < MIN_TEXT_LENGTH) {
      return null;
    }

    const id = getOrCreateItemId(element);
    const image = await collectImageData(element);

    const item: ItemAnalysisRequest = image
      ? { id, text, image }
      : { id, text };

    markProcessed(element);
    return item;
  });

  const items = await Promise.all(tasks);
  return items.filter((item): item is ItemAnalysisRequest => item !== null);
}

export function cleanText(node: Element): string {
  const raw = node.textContent ?? "";
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TEXT_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, MAX_TEXT_LENGTH);
}

export async function collectImageData(node: Element): Promise<string | undefined> {
  const img = node.querySelector<HTMLImageElement>("img");
  if (!img) {
    return undefined;
  }

  const src = img.currentSrc || img.src;
  if (!src) {
    return undefined;
  }

  if (src.startsWith("data:")) {
    return src;
  }

  if (img.offsetParent === null) {
    return undefined;
  }

  try {
    const response = await fetch(src);
    if (!response.ok) {
      return undefined;
    }
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch (error) {
    console.debug("[content] collectImageData failed", error);
    return undefined;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("Failed to convert blob to data URL"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unknown FileReader error"));
    reader.readAsDataURL(blob);
  });
}
