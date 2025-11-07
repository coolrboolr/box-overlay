const OVERLAY_DATA_ID_ATTR = "data-llm-overlay-id";

let nodeToId = new WeakMap<Element, string>();
let processedNodes = new WeakSet<Element>();
let idCounter = 0;

function nextId(): string {
  idCounter += 1;
  return `item-${idCounter}`;
}

function setNodeId(node: Element, id: string): void {
  nodeToId.set(node, id);
  node.setAttribute(OVERLAY_DATA_ID_ATTR, id);
}

export function getOrCreateItemId(node: Element): string {
  const existingAttr = node.getAttribute(OVERLAY_DATA_ID_ATTR);
  if (existingAttr) {
    nodeToId.set(node, existingAttr);
    return existingAttr;
  }

  const existing = nodeToId.get(node);
  if (existing) {
    node.setAttribute(OVERLAY_DATA_ID_ATTR, existing);
    return existing;
  }

  const id = nextId();
  setNodeId(node, id);
  return id;
}

export function assignIdToNode(node: Element, id: string): void {
  setNodeId(node, id);
}

export function markProcessed(node: Element): void {
  processedNodes.add(node);
}

export function isProcessed(node: Element): boolean {
  return processedNodes.has(node);
}

export function resetProcessed(): void {
  nodeToId = new WeakMap<Element, string>();
  processedNodes = new WeakSet<Element>();
  idCounter = 0;
}
