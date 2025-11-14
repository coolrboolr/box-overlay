import {
  MEMORY_SCHEMA_VERSION,
  type MemoryQueryHit,
  type MemoryQueryResponseMessage,
  type RuntimeMessage,
  SCHEMA_VERSION
} from "../types/messages";

interface FiltersState {
  domain?: string;
  since?: string;
}

export class PopupController {
  private queryInput: HTMLInputElement;
  private searchButton: HTMLButtonElement;
  private statusEl: HTMLElement;
  private resultsEl: HTMLElement;
  private answerEl: HTMLElement;
  private errorEl: HTMLElement;
  private domainFilterBtn: HTMLButtonElement;
  private recentFilterBtn: HTMLButtonElement;
  private activeDomain?: string;
  private filters: FiltersState = {};

  constructor(private readonly doc: Document = document) {
    this.queryInput = this.require<HTMLInputElement>("query-input");
    this.searchButton = this.require<HTMLButtonElement>("search-button");
    this.statusEl = this.require<HTMLElement>("status");
    this.resultsEl = this.require<HTMLElement>("results");
    this.answerEl = this.require<HTMLElement>("answer");
    this.errorEl = this.require<HTMLElement>("error");
    this.domainFilterBtn = this.require<HTMLButtonElement>("filter-domain");
    this.recentFilterBtn = this.require<HTMLButtonElement>("filter-recent");

    this.doc.getElementById("query-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitQuery();
    });

    this.searchButton.addEventListener("click", (event) => {
      event.preventDefault();
      this.submitQuery();
    });

    this.domainFilterBtn.addEventListener("click", () => {
      if (!this.activeDomain) {
        return;
      }
      if (this.filters.domain) {
        delete this.filters.domain;
        this.domainFilterBtn.classList.remove("active");
      } else {
        this.filters.domain = this.activeDomain;
        this.domainFilterBtn.classList.add("active");
      }
    });

    this.recentFilterBtn.addEventListener("click", () => {
      if (this.filters.since) {
        delete this.filters.since;
        this.recentFilterBtn.classList.remove("active");
      } else {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        this.filters.since = since;
        this.recentFilterBtn.classList.add("active");
      }
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (!this.isRuntimeMessage(message)) {
        return;
      }
      switch (message.type) {
        case "MEMORY_QUERY_RESULT":
          this.renderResults(message.payload);
          break;
        case "MEMORY_QUERY_ERROR":
          this.setError(message.payload.message);
          break;
        default:
          break;
      }
    });

    this.populateActiveTabDomain();
  }

  private require<T extends HTMLElement>(id: string): T {
    const el = this.doc.getElementById(id);
    if (!el) {
      throw new Error(`Element #${id} not found`);
    }
    return el as T;
  }

  private populateActiveTabDomain(): void {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      if (!url) {
        return;
      }
      try {
        const hostname = new URL(url).hostname;
        this.activeDomain = hostname;
        this.domainFilterBtn.textContent = `This domain (${hostname})`;
      } catch {
        // ignore
      }
    });
  }

  private submitQuery(): void {
    const query = this.queryInput.value.trim();
    if (!query) {
      this.setError("Enter a question to search your memory.");
      return;
    }
    this.setLoading();
    chrome.runtime.sendMessage({
      schemaVersion: SCHEMA_VERSION,
      type: "MEMORY_QUERY",
      payload: {
        query,
        topK: 5,
        filters: this.filters
      }
    }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        this.setError(err.message ?? "Unable to issue query");
      }
    });
  }

  private setLoading(): void {
    this.statusEl.textContent = "Searching...";
    this.statusEl.dataset.state = "loading";
    this.resultsEl.innerHTML = "";
    this.answerEl.hidden = true;
    this.errorEl.textContent = "";
  }

  private setError(message: string): void {
    this.errorEl.textContent = message;
    this.statusEl.textContent = "";
    this.statusEl.dataset.state = "error";
  }

  private renderResults(response: MemoryQueryResponseMessage): void {
    this.errorEl.textContent = "";
    this.statusEl.dataset.state = "ready";
    this.statusEl.textContent = response.results.length
      ? `${response.results.length} result${response.results.length === 1 ? "" : "s"}`
      : "No matching memories";

    this.resultsEl.innerHTML = "";
    response.results.forEach((hit) => {
      this.resultsEl.appendChild(this.renderResultCard(hit));
    });

    if (response.answer) {
      this.answerEl.hidden = false;
      this.answerEl.querySelector("p")!.textContent = response.answer.text;
      const list = this.answerEl.querySelector("ul");
      if (list) {
        list.innerHTML = "";
        response.answer.sources.forEach((source) => {
          const li = this.doc.createElement("li");
          li.textContent = source;
          list.appendChild(li);
        });
      }
    } else {
      this.answerEl.hidden = true;
    }
  }

  private renderResultCard(hit: MemoryQueryHit): HTMLElement {
    const card = this.doc.createElement("article");
    card.className = "result";

    const title = this.doc.createElement("h3");
    title.textContent = hit.title || hit.url || "Untitled";
    card.appendChild(title);

    const meta = this.doc.createElement("p");
    meta.className = "meta";
    const parts: string[] = [];
    if (hit.url) {
      try {
        parts.push(new URL(hit.url).hostname);
      } catch {
        parts.push(hit.url);
      }
    }
    if (hit.capturedAt) {
      parts.push(this.describeRelativeTime(hit.capturedAt));
    }
    parts.push(`${Math.round(hit.similarity * 100)}% match`);
    meta.textContent = parts.join(" • ");
    card.appendChild(meta);

    const snippet = this.doc.createElement("p");
    snippet.textContent = hit.snippet;
    card.appendChild(snippet);

    const actions = this.doc.createElement("div");
    actions.className = "actions";

    const openBtn = this.doc.createElement("button");
    openBtn.textContent = "Open";
    openBtn.type = "button";
    openBtn.addEventListener("click", () => {
      if (hit.url) {
        chrome.tabs.create({ url: hit.url });
      }
    });
    actions.appendChild(openBtn);

    const copyBtn = this.doc.createElement("button");
    copyBtn.textContent = "Copy snippet";
    copyBtn.type = "button";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(hit.snippet);
        copyBtn.textContent = "Copied";
        setTimeout(() => {
          copyBtn.textContent = "Copy snippet";
        }, 1000);
      } catch {
        copyBtn.textContent = "Unable to copy";
      }
    });
    actions.appendChild(copyBtn);

    card.appendChild(actions);
    return card;
  }

  private describeRelativeTime(timestamp: string): string {
    try {
      const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
      const deltaMs = Date.now() - Date.parse(timestamp);
      const deltaDays = Math.round(deltaMs / (24 * 60 * 60 * 1000));
      return formatter.format(-deltaDays, "day");
    } catch {
      return timestamp;
    }
  }

  private isRuntimeMessage(message: unknown): message is RuntimeMessage {
    if (typeof message !== "object" || message === null) {
      return false;
    }
    const candidate = message as RuntimeMessage;
    return candidate.schemaVersion === SCHEMA_VERSION;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    try {
      new PopupController();
    } catch (error) {
      console.error("Failed to initialize popup", error);
    }
  });
}
