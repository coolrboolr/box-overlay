import { extractItems } from "./extract";
import type { ItemAnalysisRequest } from "../types/messages";

interface AnalyzeRequestMessage {
  type: "ANALYZE_REQUEST";
  payload: ItemAnalysisRequest;
}

const RESCAN_INTERVAL_MS = 5000;

function sendAnalyzeRequest(item: ItemAnalysisRequest): void {
  const message: AnalyzeRequestMessage = {
    type: "ANALYZE_REQUEST",
    payload: item
  };

  chrome.runtime.sendMessage(message, () => {
    const err = chrome.runtime.lastError;
    if (err) {
      console.debug("[content] sendMessage error (background pending?):", err.message);
    }
  });
}

async function scanAndSend(): Promise<void> {
  try {
    const items = await extractItems(document);
    if (items.length > 0) {
      console.debug("[content] extracted items", items);
      items.forEach(sendAnalyzeRequest);
    }
  } catch (error) {
    console.error("[content] extract/send failed", error);
  }
}

// Initial scan on load.
void scanAndSend();

// Periodic rescan; later specs may swap this for a MutationObserver.
setInterval(() => {
  void scanAndSend();
}, RESCAN_INTERVAL_MS);
