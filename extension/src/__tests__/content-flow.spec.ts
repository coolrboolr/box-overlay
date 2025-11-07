import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

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
      type: "ANALYZE_REQUEST",
      payload: {
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
      type: "ANALYZE_RESULT",
      payload: {
        id,
        summary: "Headline summary",
        is_ad: false
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
      type: "ANALYZE_RESULT",
      payload: {
        id,
        summary: "Another summary",
        is_ad: false
      }
    });

    const overlay = document.querySelector<HTMLElement>(`.llm-overlay-wrapper[data-overlay-id="${id}"]`);
    expect(overlay).not.toBeNull();
    expect(overlay?.classList.contains("llm-overlay-hidden")).toBe(false);

    listener({ type: "TOGGLE_OVERLAYS" });

    await vi.waitFor(() => {
      expect(overlay?.classList.contains("llm-overlay-hidden")).toBe(true);
    });

    listener({ type: "TOGGLE_OVERLAYS" });
    await vi.waitFor(() => {
      expect(overlay?.classList.contains("llm-overlay-hidden")).toBe(false);
    });
  });
});
