import { isLikelyArticleElement } from "./domSelectors";
import { assignIdToNode, getOrCreateItemId, isProcessed, markProcessed } from "./state";
import { rememberAnchor, resolveAnchor } from "./anchors";
import { getActiveProfile } from "./siteProfiles";
import { type ItemAnalysisRequest, SCHEMA_VERSION } from "../types/messages";

const MAX_TEXT_LENGTH = 1500;
const STRUCTURE_QUERY = "p,li";
const MEDIA_QUERY = "img,video";

const activeProfile = getActiveProfile();
const candidateSelector = activeProfile.selectors.join(",");

function matchesRelaxedPatterns(element: Element, pattern: RegExp): boolean {
  const attributesToCheck = [
    element.getAttribute("data-testid"),
    element.getAttribute("data-component"),
    element.getAttribute("data-module"),
    element.getAttribute("data-widget"),
    element.getAttribute("data-track")
  ];

  return (
    attributesToCheck.some((value) => Boolean(value && pattern.test(value))) ||
    pattern.test((element.className || "").toString())
  );
}

function hasEnoughStructure(element: Element): boolean {
  return element.querySelectorAll(STRUCTURE_QUERY).length >= 3;
}

function hasMedia(element: Element): boolean {
  return Boolean(element.querySelector(MEDIA_QUERY));
}

function computeMinTextLength(
  hasStructuredContent: boolean,
  hasMediaContent: boolean,
  base: number
): number {
  if (hasStructuredContent) {
    return Math.min(base, 20);
  }
  if (hasMediaContent) {
    return Math.min(base, 30);
  }
  return base;
}

function isNumericOrSymbolHeavy(text: string): boolean {
  const condensed = text.replace(/\s+/g, "");
  if (!condensed) {
    return true;
  }
  const nonLetters = condensed.replace(/[a-z]/gi, "");
  return nonLetters.length / condensed.length > 0.4;
}

export async function extractItems(root: Document | Element): Promise<ItemAnalysisRequest[]> {
  if (!candidateSelector) {
    return [];
  }

  const candidates = Array.from(root.querySelectorAll<Element>(candidateSelector));
  const tasks = candidates.map(async (element) => {
    const anchor = resolveAnchor(element);
    if (isProcessed(anchor)) {
      return null;
    }

    const structuredContent = hasEnoughStructure(element);
    const mediaContent = hasMedia(element);

    const passesFilters =
      structuredContent ||
      isLikelyArticleElement(element, activeProfile) ||
      matchesRelaxedPatterns(element, activeProfile.relaxedAttributePattern);
    if (!passesFilters) {
      return null;
    }

    const text = cleanText(element);
    if (!text || isNumericOrSymbolHeavy(text)) {
      return null;
    }

    const minTextLength = computeMinTextLength(
      structuredContent,
      mediaContent,
      activeProfile.minTextLength
    );
    if (text.length < minTextLength) {
      return null;
    }

    const id = getOrCreateItemId(anchor);
    if (anchor !== element) {
      assignIdToNode(element, id);
    }
    rememberAnchor(id, anchor);
    const image = await collectImageData(element);

    const sourceMeta = {
      profileName: activeProfile.name,
      anchorTag: anchor.tagName?.toLowerCase(),
      anchorStrategy: anchor === element ? "self" : "ancestor"
    };

    const item: ItemAnalysisRequest = {
      schemaVersion: SCHEMA_VERSION,
      id,
      text,
      sourceMeta
    };

    if (image) {
      item.image = image;
    }

    markProcessed(anchor);
    return item;
  });

  const items = await Promise.all(tasks);
  return items.filter(
    (item: ItemAnalysisRequest | null): item is ItemAnalysisRequest => item !== null
  );
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
