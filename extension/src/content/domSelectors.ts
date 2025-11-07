import type { SiteProfile } from "./siteProfiles";

const EXCLUDED_TAGS = new Set(["NAV", "HEADER", "FOOTER", "ASIDE", "FORM"]);

export function isLikelyArticleElement(el: Element, profile: SiteProfile): boolean {
  if (EXCLUDED_TAGS.has(el.tagName)) {
    return false;
  }

  const textContent = el.textContent ?? "";
  const normalizedLength = textContent.replace(/\s+/g, " ").trim().length;

  if (normalizedLength < profile.minTextLength / 1.2) {
    return false;
  }

  const className = (el.className || "").toString().toLowerCase();
  if (
    profile.blockedClassFragments.some((fragment: string) => className.includes(fragment))
  ) {
    return false;
  }

  if (el instanceof HTMLElement) {
    if (!el.isConnected || el.hidden) {
      return false;
    }
    const style = typeof window !== "undefined" && window.getComputedStyle
      ? window.getComputedStyle(el)
      : null;
    if (style) {
      const hiddenByStyle =
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number.parseFloat(style.opacity ?? "1") === 0;
      if (hiddenByStyle) {
        return false;
      }
    }
  }

  return true;
}
