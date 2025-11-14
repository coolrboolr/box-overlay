import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_VERSION, type RuntimeMessage } from "../types/messages";
import { __resetTelemetryStoreForTests, getEntries } from "../content/logStore";

function createChromeContentMock() {
  const sendMessage = vi.fn((message: unknown, responseCallback?: () => void) => {
    responseCallback?.();
    return message;
  });

  const storageState: Record<string, unknown> = {};

  return {
    runtime: {
      id: "abcdefghijklmnopabcdefghijklmnop",
      sendMessage,
      onMessage: {
        addListener: vi.fn()
      },
      lastError: undefined as chrome.runtime.LastError | undefined
    },
    storage: {
      session: {
        get: vi.fn((keys: unknown, callback: (items: Record<string, unknown>) => void) => {
          const result: Record<string, unknown> = {};
          const keyList = Array.isArray(keys)
            ? keys
            : typeof keys === "string"
              ? [keys]
              : typeof keys === "object" && keys !== null
                ? Object.keys(keys)
                : [];
          keyList.forEach((key) => {
            if (key in storageState) {
              result[key] = storageState[key];
            }
          });
          callback(result);
        }),
        set: vi.fn((items: Record<string, unknown>, callback: () => void) => {
          Object.assign(storageState, items);
          callback();
        })
      }
    },
    tabs: {
      sendMessage: vi.fn(),
      query: vi.fn()
    },
    commands: {
      onCommand: {
        addListener: vi.fn()
      }
    }
  } as const;
}

describe("content pipeline", () => {
  let chromeMock: ReturnType<typeof createChromeContentMock>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    chromeMock = createChromeContentMock();
    (globalThis as any).chrome = chromeMock;
    __resetTelemetryStoreForTests();
    document.body.innerHTML = `
      <main>
        <article class="post">
          ${"Breaking news story ".repeat(10)}
        </article>
      </main>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("issues ANALYZE_REQUEST messages when the scanner finds content", async () => {
    await import("../content/index");

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(1);
    const [message] = chromeMock.runtime.sendMessage.mock.calls[0];
    expect(message).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      type: "ANALYZE_REQUEST",
      payload: {
        schemaVersion: SCHEMA_VERSION,
        id: expect.stringMatching(/^item-/),
        text: expect.stringContaining("Breaking news story")
      }
    });
  });

  it("renders overlays when ANALYZE_RESULT arrives", async () => {
    await import("../content/index");

    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];
    const article = document.querySelector("article")!;
    const id = "item-42";
    article.setAttribute("data-llm-overlay-id", id);

    listener({
      schemaVersion: SCHEMA_VERSION,
      type: "ANALYZE_RESULT",
      payload: {
        id,
        summary: "Headline summary",
        isAd: false
      }
    });

    const overlay = document.querySelector(`[data-overlay-id="${id}"]`);
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector(".llm-overlay-summary")?.textContent).toContain("Headline summary");
  });

  it("toggles overlay visibility when TOGGLE_OVERLAYS is dispatched", async () => {
    await import("../content/index");
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];
    const article = document.querySelector("article")!;
    const id = "item-77";
    article.setAttribute("data-llm-overlay-id", id);

    listener({
      schemaVersion: SCHEMA_VERSION,
      type: "ANALYZE_RESULT",
      payload: {
        id,
        summary: "Another summary",
        isAd: false
      }
    });

    const overlay = document.querySelector<HTMLElement>(`.llm-overlay-wrapper[data-overlay-id="${id}"]`);
    expect(overlay).not.toBeNull();
    expect(overlay?.classList.contains("llm-overlay-hidden")).toBe(false);

    listener({ schemaVersion: SCHEMA_VERSION, type: "TOGGLE_OVERLAYS", payload: undefined });

    await vi.waitFor(() => {
      expect(overlay?.classList.contains("llm-overlay-hidden")).toBe(true);
    });

    listener({ schemaVersion: SCHEMA_VERSION, type: "TOGGLE_OVERLAYS", payload: undefined });
    await vi.waitFor(() => {
      expect(overlay?.classList.contains("llm-overlay-hidden")).toBe(false);
    });
  });

  it("does not re-enqueue analysis when a replacement node already exists", async () => {
    await import("../content/index");

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(1);
    const firstCall = chromeMock.runtime.sendMessage.mock.calls[0];
    const firstMessage = firstCall[0] as Extract<
      RuntimeMessage,
      { type: "ANALYZE_REQUEST" }
    >;
    const id = firstMessage.payload.id;

    const originalArticle = document.querySelector("article");
    originalArticle?.remove();

    const replacement = document.createElement("article");
    replacement.className = "post";
    replacement.textContent = "Re-rendered story ".repeat(10);
    replacement.setAttribute("data-llm-overlay-id", id);
    document.body.appendChild(replacement);

    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];
    listener({
      schemaVersion: SCHEMA_VERSION,
      type: "ANALYZE_RESULT",
      payload: {
        id,
        summary: "Stale summary",
        isAd: false
      }
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("caps anchor recovery attempts and records a terminal failure", async () => {
    await import("../content/index");

    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];
    const article = document.querySelector("article");
    const id = "item-churn";
    article?.setAttribute("data-llm-overlay-id", id);

    listener({
      schemaVersion: SCHEMA_VERSION,
      type: "ANALYZE_RESULT",
      payload: {
        id,
        summary: "Initial summary",
        isAd: false
      }
    });

    article?.remove();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      listener({
        schemaVersion: SCHEMA_VERSION,
        type: "ANALYZE_RESULT",
        payload: {
          id,
          summary: `Update ${attempt}`,
          isAd: false
        }
      });
      await Promise.resolve();
    }

    const entries = getEntries();
    const retryEvents = entries.filter((entry) => entry.type === "retry" && entry.detail?.reason === "anchor");
    expect(retryEvents.length).toBeGreaterThan(0);

    const terminalError = entries.find(
      (entry) => entry.type === "error" && entry.detail?.reason === "anchor-miss-max"
    );
    expect(terminalError).toBeTruthy();
  });
});
