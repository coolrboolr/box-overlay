const STABLE_TAGS = new Set(["ARTICLE", "SECTION", "MAIN", "ASIDE"]);
const STABLE_ROLES = new Set(["article", "main", "region", "complementary"]);
const MAX_ASCENT_DEPTH = 6;

const elementAnchorCache = new WeakMap<Element, Element>();
const idToAnchor = new Map<string, Element>();

function isStableAnchorCandidate(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element === document.body || element === document.documentElement) {
    return false;
  }

  if (element.id) {
    return true;
  }

  if (Object.keys(element.dataset ?? {}).length > 0) {
    return true;
  }

  if (STABLE_TAGS.has(element.tagName)) {
    return true;
  }

  const role = element.getAttribute("role");
  if (role && STABLE_ROLES.has(role.toLowerCase())) {
    return true;
  }

  if (element.offsetHeight > 120 && element.childElementCount > 0) {
    return true;
  }

  return false;
}

function pickStableAncestor(element: Element): Element {
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < MAX_ASCENT_DEPTH) {
    if (isStableAnchorCandidate(current)) {
      return current;
    }

    const parent: Element | null = current.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) {
      break;
    }
    current = parent;
    depth += 1;
  }

  return element;
}

export function resolveAnchor(element: Element): Element {
  const cached = elementAnchorCache.get(element);
  if (cached && cached.isConnected) {
    return cached;
  }

  const anchor = pickStableAncestor(element);
  elementAnchorCache.set(element, anchor);
  return anchor;
}

export function rememberAnchor(id: string, anchor: Element): void {
  if (!anchor.isConnected) {
    return;
  }
  idToAnchor.set(id, anchor);
}

export function getAnchor(id: string): Element | null {
  const anchor = idToAnchor.get(id);
  if (!anchor) {
    return null;
  }
  if (!anchor.isConnected) {
    idToAnchor.delete(id);
    return null;
  }
  return anchor;
}

export function clearAnchor(id: string): void {
  idToAnchor.delete(id);
}
