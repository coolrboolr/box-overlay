import { getAnchor } from "./anchors";

const HIGHLIGHT_CLASS = "llm-memory-highlight";
const HIGHLIGHT_STYLE_ID = "llm-memory-highlight-style";
const CLEAR_DELAY_MS = 5000;

let activeHighlight: HTMLElement | null = null;
let activeTarget: HTMLElement | null = null;
let clearTimer: number | null = null;

export function renderHighlight(payload: { sourceId?: string; snippet: string }): boolean {
  clearHighlight();
  ensureHighlightStyles();

  let target: HTMLElement | null = null;

  if (payload.sourceId) {
    target = (getAnchor(payload.sourceId) as HTMLElement | null) ?? null;
    if (!target) {
      target =
        document.querySelector<HTMLElement>(`[data-llm-memory-source="${payload.sourceId}"]`) ??
        document.getElementById(payload.sourceId);
    }
  }

  if (target) {
    target.classList.add(HIGHLIGHT_CLASS);
    activeTarget = target;
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    scheduleClear();
    return true;
  }

  const range = findTextRange(payload.snippet);
  if (range) {
    try {
      const mark = document.createElement("mark");
      mark.className = HIGHLIGHT_CLASS;
      range.surroundContents(mark);
      activeHighlight = mark;
      activeTarget = mark;
      if (typeof mark.scrollIntoView === "function") {
        mark.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      scheduleClear();
      return true;
    } catch {
      try {
        const mark = document.createElement("mark");
        mark.className = HIGHLIGHT_CLASS;
        const fragment = range.extractContents();
        mark.appendChild(fragment);
        range.insertNode(mark);
        activeHighlight = mark;
        activeTarget = mark;
        if (typeof mark.scrollIntoView === "function") {
          mark.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        scheduleClear();
        return true;
      } catch {
        // fall through to failure path
      }
    }
  }

  return false;
}

export function clearHighlight(): void {
  if (clearTimer) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }
  if (activeHighlight && activeHighlight.parentNode) {
    const parent = activeHighlight.parentNode;
    while (activeHighlight.firstChild) {
      parent.insertBefore(activeHighlight.firstChild, activeHighlight);
    }
    parent.removeChild(activeHighlight);
  }
  if (activeTarget) {
    activeTarget.classList.remove(HIGHLIGHT_CLASS);
  }
  activeHighlight = null;
  activeTarget = null;
}

function ensureHighlightStyles(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background: rgba(37, 99, 235, 0.22) !important;
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.35);
      border-radius: 4px;
      transition: background 160ms ease;
    }
  `;
  document.head.appendChild(style);
}

function scheduleClear(): void {
  clearTimer = window.setTimeout(() => clearHighlight(), CLEAR_DELAY_MS);
}

function findTextRange(snippet: string): Range | null {
  const needle = snippet.trim().slice(0, 120).toLowerCase();
  if (!needle) {
    return null;
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  while (current) {
    const text = current.textContent ?? "";
    const index = text.toLowerCase().indexOf(needle);
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(current, Math.max(0, index));
      range.setEnd(current, Math.min(index + needle.length, text.length));
      return range;
    }
    current = walker.nextNode();
  }

  return null;
}
