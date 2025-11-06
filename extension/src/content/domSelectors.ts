export const CANDIDATE_SELECTORS: string[] = [
  "article",
  "[role='article']",
  ".post",
  ".card",
  ".feed-item"
];

const EXCLUDED_TAGS = new Set(["NAV", "HEADER", "FOOTER", "ASIDE", "FORM"]);

const MIN_TEXT_LENGTH = 80;

export function isLikelyArticleElement(el: Element): boolean {
  if (EXCLUDED_TAGS.has(el.tagName)) {
    return false;
  }

  const textContent = el.textContent ?? "";
  const normalizedLength = textContent.replace(/\s+/g, " ").trim().length;

  if (normalizedLength < MIN_TEXT_LENGTH) {
    return false;
  }

  const className = el.className.toLowerCase();
  if (className.includes("nav") || className.includes("menu") || className.includes("footer")) {
    return false;
  }

  return true;
}
