import { OVERLAY_Z_INDEX } from "./overlay";
import { exportLogs, getStats, subscribe } from "./logStore";
import { isDev } from "../shared/isDev";

type StatKey = keyof ReturnType<typeof getStats>;

const STAT_LABELS: Record<StatKey, string> = {
  scannedNodes: "Nodes scanned",
  requestsQueued: "Requests queued",
  overlaysResolved: "Overlays resolved",
  retries: "Retries",
  errors: "Errors",
  forbiddenRecoveries: "403 recoveries",
  forbiddenErrors: "Forbidden errors",
  batchFallbacks: "Batch fallbacks",
  memoryFilters: "Memory filters",
  memoryHighlights: "Memory highlights",
  memoryAnswerFailures: "Answer failures"
};

let root: HTMLElement | null = null;
let unsubscribe: (() => void) | null = null;
const statValueEls = new Map<StatKey, HTMLElement>();

export function mountDebugHud(): void {
  if (!isDev || root) {
    return;
  }

  root = document.createElement("div");
  root.className = "llm-debug-hud";
  root.style.position = "fixed";
  root.style.top = "16px";
  root.style.right = "16px";
  root.style.zIndex = String(OVERLAY_Z_INDEX + 10);
  root.style.background = "rgba(15, 23, 42, 0.92)";
  root.style.color = "#f8fafc";
  root.style.minWidth = "220px";
  root.style.borderRadius = "10px";
  root.style.boxShadow = "0 12px 32px rgba(15, 23, 42, 0.4)";
  root.style.fontSize = "12px";
  root.style.lineHeight = "1.4";
  root.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  root.style.userSelect = "none";
  root.style.padding = "12px";

  const header = document.createElement("div");
  header.textContent = "Overlay HUD (dev)";
  header.style.fontWeight = "600";
  header.style.marginBottom = "8px";
  header.style.cursor = "move";
  root.appendChild(header);

  const statsContainer = document.createElement("div");
  statsContainer.style.display = "grid";
  statsContainer.style.gap = "4px";
  root.appendChild(statsContainer);

  (Object.keys(STAT_LABELS) as StatKey[]).forEach((key) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.gap = "8px";

    const label = document.createElement("span");
    label.textContent = STAT_LABELS[key];
    row.appendChild(label);

    const value = document.createElement("span");
    value.textContent = "0";
    value.style.fontWeight = "600";
    row.appendChild(value);

    statsContainer.appendChild(row);
    statValueEls.set(key, value);
  });

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.justifyContent = "space-between";
  actions.style.alignItems = "center";
  actions.style.marginTop = "10px";
  actions.style.gap = "8px";

  const hint = document.createElement("span");
  hint.textContent = "Alt+Shift+L → Export";
  hint.style.fontSize = "11px";
  hint.style.opacity = "0.75";
  actions.appendChild(hint);

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.textContent = "Export";
  exportBtn.style.flexShrink = "0";
  exportBtn.style.fontSize = "11px";
  exportBtn.style.fontWeight = "600";
  exportBtn.style.color = "#0f172a";
  exportBtn.style.background = "#f8fafc";
  exportBtn.style.border = "none";
  exportBtn.style.borderRadius = "999px";
  exportBtn.style.padding = "4px 10px";
  exportBtn.style.cursor = "pointer";
  exportBtn.addEventListener("click", () => {
    void exportLogs();
  });
  actions.appendChild(exportBtn);

  root.appendChild(actions);

  document.body.appendChild(root);
  enableDrag(root, header);

  const applyStats = () => {
    const next = getStats();
    (Object.keys(STAT_LABELS) as StatKey[]).forEach((key) => {
      const el = statValueEls.get(key);
      if (el) {
        el.textContent = String(next[key]);
      }
    });
  };

  applyStats();
  unsubscribe = subscribe(applyStats);
}

export function unmountDebugHud(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (root) {
    root.remove();
    root = null;
  }
  statValueEls.clear();
}

function enableDrag(container: HTMLElement, handle: HTMLElement): void {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let initialTop = 0;
  let initialLeft = 0;

  const onMouseMove = (event: MouseEvent) => {
    if (!dragging) {
      return;
    }
    event.preventDefault();
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    container.style.top = `${initialTop + deltaY}px`;
    container.style.left = `${initialLeft + deltaX}px`;
    container.style.right = "auto";
  };

  const onMouseUp = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };

  handle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    const rect = container.getBoundingClientRect();
    initialTop = rect.top;
    initialLeft = rect.left;
    container.style.left = `${rect.left}px`;
    container.style.top = `${rect.top}px`;
    container.style.right = "auto";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}
