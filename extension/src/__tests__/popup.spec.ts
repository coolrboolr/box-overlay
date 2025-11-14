import { describe, expect, it, beforeEach, vi } from "vitest";

import { PopupController } from "../popup/index";

function setupDom() {
  document.body.innerHTML = `
    <h1>Search Memory</h1>
    <form id="query-form">
      <input id="query-input" type="text" />
      <button id="search-button" type="submit">Search</button>
    </form>
    <div class="filters">
      <button id="filter-domain" type="button"></button>
      <button id="filter-recent" type="button"></button>
      <button id="filter-entity" type="button"></button>
      <button id="filter-concept" type="button"></button>
    </div>
    <div id="status"></div>
    <div id="error"></div>
    <section id="answer" hidden>
      <h2>Answer</h2>
      <p></p>
      <ul></ul>
    </section>
    <section id="results"></section>
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
        payload: expect.objectContaining({ query: "memory test" })
      }),
      expect.any(Function)
    );
    expect(controller).toBeTruthy();
  });
});
