export const CANDIDATE_SELECTORS: string[] = [
  "article",
  "[role='article']",
  "section[data-component*='card']",
  "[data-testid*='card']",
  "[data-testid*='tile']",
  "[data-testid*='product']",
  "[data-module*='card']",
  "[data-widget*='story']",
  "div[class*='card']",
  "div[class*='tile']",
  ".post",
  ".feed-item",
  ".feed-card",
  ".story-card",
  ".product-card",
  ".listing-card"
];

const EXCLUDED_TAGS = new Set(["NAV", "HEADER", "FOOTER", "ASIDE", "FORM"]);
const MIN_TEXT_LENGTH = 50;

export function isLikelyArticleElement(el: Element): boolean {
  if (EXCLUDED_TAGS.has(el.tagName)) {
    return false;
  }

  const textContent = el.textContent ?? "";
  const normalizedLength = textContent.replace(/\s+/g, " ").trim().length;

  if (normalizedLength < MIN_TEXT_LENGTH) {
    return false;
  }

  const className = (el.className || "").toString().toLowerCase();
  if (
    className.includes("nav") ||
    className.includes("menu") ||
    className.includes("footer") ||
    className.includes("filter") ||
    className.includes("breadcrumb")
  ) {
    return false;
  }

  const isHidden = el instanceof HTMLElement && (el.offsetParent === null || el.hidden);
  if (isHidden) {
    return false;
  }

  return true;
}
