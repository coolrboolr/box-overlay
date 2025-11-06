let nodeToId = new WeakMap<Element, string>();
let processedNodes = new WeakSet<Element>();

let idCounter = 0;

function nextId(): string {
  idCounter += 1;
  return `item-${idCounter}`;
}

export function getOrCreateItemId(node: Element): string {
  const existing = nodeToId.get(node);
  if (existing) {
    return existing;
  }
  const id = nextId();
  nodeToId.set(node, id);
  return id;
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
