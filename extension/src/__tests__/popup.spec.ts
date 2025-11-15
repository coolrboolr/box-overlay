import { describe, expect, it, beforeEach, vi } from "vitest";

import { PopupController } from "../popup/index";

function setupDom() {
  document.body.innerHTML = `
    <div class="tabs">
      <button id="tab-search" type="button">Search</button>
      <button id="tab-chat" type="button">Chat</button>
    </div>
    <section id="search-view">
    <h1>Search Memory</h1>
    <form id="query-form">
      <input id="query-input" type="text" />
      <button id="search-button" type="submit">Search</button>
    </form>
    <div class="filters">
      <div class="filter-row">
        <button id="filter-domain" type="button"></button>
        <button id="filter-add-domain" type="button"></button>
        <select id="filter-range"><option value="">Any time</option></select>
        <select id="topk-select"><option value="5" selected>Top 5</option></select>
      </div>
      <div id="domain-chips"></div>
      <div class="filter-row">
        <button id="filter-tags" type="button"></button>
        <button id="filter-entity" type="button"></button>
        <button id="filter-concept" type="button"></button>
      </div>
      <div id="tag-chips"></div>
    </div>
    <div id="status"></div>
    <div id="error"></div>
    <section id="answer" hidden>
      <h2>Answer</h2>
      <p id="answer-text"></p>
      <p id="answer-note"></p>
      <div id="answer-sources"></div>
    </section>
    <section id="results"></section>
    </section>

    <section id="chat-view" hidden>
      <div id="chat-log"></div>
      <form id="chat-form">
        <input id="chat-input" type="text" />
        <button id="chat-send" type="submit">Send</button>
      </form>
      <div class="filters">
        <button id="chat-reset" type="button">Reset conversation</button>
      </div>
    </section>
  `;
}

describe("PopupController", () => {
  beforeEach(() => {
    setupDom();
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: vi.fn((message, callback) => callback?.()),
        onMessage: {
          addListener: vi.fn()
        }
      },
      tabs: {
        query: vi.fn((_, cb) => cb([{ url: "https://example.com/article" }]))
      }
    };
    (navigator as any).clipboard = {
      writeText: vi.fn()
    };
  });

  it("sends query payload when form is submitted", () => {
    const controller = new PopupController(document);
    (document.getElementById("query-input") as HTMLInputElement).value = "memory test";
    document.getElementById("query-form")!.dispatchEvent(new Event("submit"));

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MEMORY_QUERY",
        payload: expect.objectContaining({ query: "memory test", topK: 5 })
      }),
      expect.any(Function)
    );
    expect(controller).toBeTruthy();
  });
});
