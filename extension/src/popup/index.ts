import {
  type MemoryQueryHit,
  type MemoryQueryResponseMessage,
  type RuntimeMessage,
  SCHEMA_VERSION
} from "../types/messages";

interface FiltersState {
  domain?: string;
  since?: string;
  entityTypes?: string[];
  conceptIds?: string[];
  tags?: string[];
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
  private entityFilterBtn: HTMLButtonElement;
  private conceptFilterBtn: HTMLButtonElement;
  private tabSearchBtn: HTMLButtonElement;
  private tabChatBtn: HTMLButtonElement;
  private searchView: HTMLElement;
  private chatView: HTMLElement;
  private chatLog: HTMLElement;
  private chatForm: HTMLFormElement;
  private chatInput: HTMLInputElement;
  private chatResetBtn: HTMLButtonElement;
  private activeTab: "search" | "chat" = "search";
  private conversationId: string =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `conv-${Date.now()}`;
  private chatHistory: Array<{ role: "user" | "assistant"; content: string; sourceIds?: string[] }> = [];
  private chatPendingBubble?: HTMLElement;
  private chatAwaiting = false;
  private activeDomain?: string;
  private filters: FiltersState = {};
  private entityOptions = ["article", "product", "person", "brand", "unknown"] as const;
  private entityIndex = -1;

  constructor(private readonly doc: Document = document) {
    this.queryInput = this.require<HTMLInputElement>("query-input");
    this.searchButton = this.require<HTMLButtonElement>("search-button");
    this.statusEl = this.require<HTMLElement>("status");
    this.resultsEl = this.require<HTMLElement>("results");
    this.answerEl = this.require<HTMLElement>("answer");
    this.errorEl = this.require<HTMLElement>("error");
    this.domainFilterBtn = this.require<HTMLButtonElement>("filter-domain");
    this.recentFilterBtn = this.require<HTMLButtonElement>("filter-recent");
    this.entityFilterBtn = this.require<HTMLButtonElement>("filter-entity");
    this.conceptFilterBtn = this.require<HTMLButtonElement>("filter-concept");
    this.tabSearchBtn = this.require<HTMLButtonElement>("tab-search");
    this.tabChatBtn = this.require<HTMLButtonElement>("tab-chat");
    this.searchView = this.require<HTMLElement>("search-view");
    this.chatView = this.require<HTMLElement>("chat-view");
    this.chatLog = this.require<HTMLElement>("chat-log");
    this.chatForm = this.require<HTMLFormElement>("chat-form");
    this.chatInput = this.require<HTMLInputElement>("chat-input");
    this.chatResetBtn = this.require<HTMLButtonElement>("chat-reset");

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

    this.entityFilterBtn.addEventListener("click", () => {
      this.cycleEntityFilter();
    });

    this.conceptFilterBtn.addEventListener("click", () => {
      this.toggleConceptFilter();
    });

    this.tabSearchBtn.addEventListener("click", () => this.switchTab("search"));
    this.tabChatBtn.addEventListener("click", () => this.switchTab("chat"));

    this.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitChat();
    });

    this.chatResetBtn.addEventListener("click", () => {
      this.resetChat();
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (!this.isRuntimeMessage(message)) {
        return;
      }
      switch (message.type) {
        case "MEMORY_QUERY_RESULT":
          if (this.activeTab === "chat" && this.chatAwaiting) {
            this.renderChatResponse(message.payload);
          } else {
            this.renderResults(message.payload);
          }
          break;
        case "MEMORY_QUERY_ERROR":
          if (this.activeTab === "chat") {
            this.renderChatError(message.payload.message);
          } else {
            this.setError(message.payload.message);
          }
          break;
        case "MEMORY_UPDATE_ERROR":
          this.setError(`Update failed: ${message.payload.message}`);
          break;
        case "MEMORY_UPDATE_RESULT":
          this.statusEl.textContent = "Saved";
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

  private cycleEntityFilter(): void {
    this.entityIndex += 1;
    if (this.entityIndex >= this.entityOptions.length) {
      this.entityIndex = -1;
      delete this.filters.entityTypes;
      this.entityFilterBtn.textContent = "All entities";
      this.entityFilterBtn.classList.remove("active");
      return;
    }
    const selected = this.entityOptions[this.entityIndex];
    this.filters.entityTypes = [selected];
    this.entityFilterBtn.textContent = `Entity: ${selected}`;
    this.entityFilterBtn.classList.add("active");
  }

  private toggleConceptFilter(): void {
    if (this.filters.conceptIds?.length) {
      delete this.filters.conceptIds;
      this.conceptFilterBtn.textContent = "Concept filter";
      this.conceptFilterBtn.classList.remove("active");
      return;
    }
    const concept = this.doc.defaultView?.prompt("Filter by concept ID", this.activeDomain ?? "") ?? "";
    const trimmed = concept.trim();
    if (!trimmed) {
      return;
    }
    this.filters.conceptIds = [trimmed];
    this.conceptFilterBtn.textContent = `Concept: ${trimmed}`;
    this.conceptFilterBtn.classList.add("active");
  }

  private setLoading(): void {
    this.statusEl.textContent = "Searching...";
    this.statusEl.dataset.state = "loading";
    this.resultsEl.innerHTML = "";
    this.answerEl.hidden = true;
    this.errorEl.textContent = "";
  }

  private switchTab(target: "search" | "chat"): void {
    this.activeTab = target;
    this.searchView.hidden = target !== "search";
    this.chatView.hidden = target !== "chat";
    this.tabSearchBtn.classList.toggle("active", target === "search");
    this.tabChatBtn.classList.toggle("active", target === "chat");
    if (target === "chat") {
      this.chatInput.focus();
    }
  }

  private submitChat(): void {
    const query = this.chatInput.value.trim();
    if (!query) {
      return;
    }
    const priorHistory = this.chatHistory.slice(-3);
    this.chatInput.value = "";
    this.chatAwaiting = true;
    this.chatHistory.push({ role: "user", content: query });
    this.appendChatBubble("user", query);
    this.chatPendingBubble = this.appendChatBubble("assistant", "…");

    chrome.runtime.sendMessage(
      {
        schemaVersion: SCHEMA_VERSION,
        type: "MEMORY_QUERY",
        payload: {
          query,
          filters: this.filters,
          conversationId: this.conversationId,
          history: priorHistory
        }
      },
      () => {
        const err = chrome.runtime.lastError;
        if (err) {
          this.renderChatError(err.message ?? "Unable to submit chat");
        }
      }
    );
  }

  private setError(message: string): void {
    this.errorEl.textContent = message;
    this.statusEl.textContent = "";
    this.statusEl.dataset.state = "error";
  }

  private renderChatResponse(response: MemoryQueryResponseMessage): void {
    if (this.chatPendingBubble) {
      this.chatPendingBubble.remove();
      this.chatPendingBubble = undefined;
    }
    this.chatAwaiting = false;

    if (response.answer?.text) {
      const meta: string[] = [];
      if (response.answer.sources?.length) {
        meta.push(`Sources: ${response.answer.sources.join(", ")}`);
      }
      this.appendChatBubble("assistant", response.answer.text, meta);
      this.chatHistory.push({
        role: "assistant",
        content: response.answer.text,
        sourceIds: response.answer.sourceIds
      });
    } else {
      this.appendChatBubble("assistant", "No direct answer; showing top results.");
      this.chatHistory.push({ role: "assistant", content: "No answer" });
    }
  }

  private renderChatError(message: string): void {
    if (this.chatPendingBubble) {
      this.chatPendingBubble.remove();
      this.chatPendingBubble = undefined;
    }
    this.chatAwaiting = false;
    this.appendChatBubble("assistant", message);
  }

  private appendChatBubble(role: "user" | "assistant", text: string, meta?: string[]): HTMLElement {
    const bubble = this.doc.createElement("div");
    bubble.className = `bubble ${role}`;
    bubble.textContent = text;
    if (meta?.length) {
      const metaEl = this.doc.createElement("div");
      metaEl.style.fontSize = "11px";
      metaEl.style.marginTop = "4px";
      metaEl.textContent = meta.join(" • ");
      bubble.appendChild(metaEl);
    }
    this.chatLog.appendChild(bubble);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    return bubble;
  }

  private resetChat(): void {
    this.chatLog.innerHTML = "";
    this.chatHistory = [];
    this.chatAwaiting = false;
    this.chatPendingBubble = undefined;
    this.conversationId = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `conv-${Date.now()}`;
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

    const note = this.doc.createElement("div");
    note.className = "note";
    note.textContent = hit.userNote ? hit.userNote : "Add a note";
    card.appendChild(note);

    const tagsRow = this.doc.createElement("div");
    tagsRow.className = "tags";
    (hit.tags ?? []).forEach((tag) => {
      const chip = this.doc.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = tag;
      tagsRow.appendChild(chip);
    });
    card.appendChild(tagsRow);

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

    const editBtn = this.doc.createElement("button");
    editBtn.textContent = "Edit note/tags";
    editBtn.type = "button";
    editBtn.addEventListener("click", () => this.editAnnotation(hit, note, tagsRow));
    actions.appendChild(editBtn);

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

  private editAnnotation(hit: MemoryQueryHit, noteEl: HTMLElement, tagsRow: HTMLElement): void {
    const noteInput = this.doc.defaultView?.prompt("Add a note (200 chars max)", hit.userNote ?? "");
    if (noteInput === null) {
      return;
    }
    const trimmedNote = noteInput.trim().slice(0, 200) || undefined;

    const tagInput = this.doc.defaultView?.prompt(
      "Tags (comma or space separated, max 10)",
      (hit.tags ?? []).join(", ")
    );
    if (tagInput === null) {
      return;
    }
    const tags = tagInput
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 10);

    noteEl.textContent = trimmedNote ?? "Add a note";
    tagsRow.innerHTML = "";
    tags.forEach((tag) => {
      const chip = this.doc.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = tag.toLowerCase();
      tagsRow.appendChild(chip);
    });

    chrome.runtime.sendMessage({
      schemaVersion: SCHEMA_VERSION,
      type: "MEMORY_UPDATE_REQUEST",
      payload: {
        id: hit.id,
        userNote: trimmedNote,
        tags
      }
    });
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
