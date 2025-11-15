import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MEMORY_SCHEMA_VERSION, SCHEMA_VERSION } from "../types/messages";

function createChromeBackgroundMock() {
  const runtimeOnMessageAddListener = vi.fn();
  const tabsSendMessage = vi.fn(
    (
      _tabId: number,
      _message: unknown,
      arg3?: chrome.tabs.MessageSendOptions | ((response?: unknown) => void),
      arg4?: (response?: unknown) => void
    ) => {
      const callback = typeof arg3 === "function" ? arg3 : arg4;
      callback?.();
    }
  );

  return {
    runtime: {
      id: "abcdefghijklmnopabcdefghijklmnop",
      sendMessage: vi.fn(),
      onMessage: {
        addListener: runtimeOnMessageAddListener
      },
      onInstalled: {
        addListener: vi.fn()
      },
      lastError: undefined as chrome.runtime.LastError | undefined
    },
    tabs: {
      sendMessage: tabsSendMessage,
      query: vi.fn((_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        callback([]);
      }),
      onRemoved: {
        addListener: vi.fn()
      }
    },
    commands: {
      onCommand: {
        addListener: vi.fn()
      }
    }
  } as const;
}

describe("background pipeline", () => {
  let chromeMock: ReturnType<typeof createChromeBackgroundMock>;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    chromeMock = createChromeBackgroundMock();
    (globalThis as any).chrome = chromeMock;
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it("registers the extension origin and relays analysis results", async () => {
    const analyzeResponse = {
      id: "item-1",
      summary: "Mock summary",
      isAd: false
    };

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(analyzeResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await import("../background/index");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/dev/register-extension-origin");

    const onMessageHandler = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];

    const sendResponse = vi.fn();
    const handled = onMessageHandler(
      {
        schemaVersion: SCHEMA_VERSION,
        type: "ANALYZE_REQUEST",
        payload: { schemaVersion: SCHEMA_VERSION, id: "item-1", text: "Test article body" }
      },
      { tab: { id: 99 } } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(handled).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({ accepted: true });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
        99,
        {
          schemaVersion: SCHEMA_VERSION,
          type: "ANALYZE_RESULT",
          payload: analyzeResponse
        },
        expect.any(Function)
      );
    });

    const analyzeUrl = fetchMock.mock.calls[1]?.[0];
    expect(analyzeUrl).toContain("/api/analyze");
  });

  it("accepts ImageRef objects in ANALYZE_REQUEST", async () => {
    const analyzeResponse = { id: "img-1", summary: "ok", isAd: false };

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(analyzeResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await import("../background/index");
    const onMessageHandler = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];

    const handled = onMessageHandler(
      {
        schemaVersion: SCHEMA_VERSION,
        type: "ANALYZE_REQUEST",
        payload: {
          schemaVersion: SCHEMA_VERSION,
          id: "img-1",
          text: "body",
          image: { kind: "tag", tag: "news" }
        }
      },
      { tab: { id: 5 } } as chrome.runtime.MessageSender,
      vi.fn()
    );

    expect(handled).toBe(false);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[0]).toContain("/api/analyze");
    });
  });

  it("queues memory requests and posts to the memory endpoint", async () => {
    vi.useFakeTimers();

    const memoryResponse = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      counts: { indexed: 1, duplicate: 0, failed: 0 },
      results: [{ id: "mem-1", status: "indexed" }]
    };

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(memoryResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await import("../background/index");

    const onMessageHandler = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];

    onMessageHandler(
      {
        schemaVersion: SCHEMA_VERSION,
        type: "MEMORY_INDEX_REQUEST",
        payload: {
          schemaVersion: MEMORY_SCHEMA_VERSION,
          items: [{ id: "mem-1", text: "Example text" }],
          flush: true
        }
      },
      { tab: { id: 7 } } as chrome.runtime.MessageSender,
      vi.fn()
    );

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[0]).toContain("/api/memory/index");
    });

    vi.runAllTimers();
    vi.useRealTimers();

    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: "MEMORY_INDEX_RESULT" }),
      expect.any(Function)
    );
  });

  it("sends failure results when the memory queue overflows", async () => {
    vi.useFakeTimers();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await import("../background/index");

    const onMessageHandler = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];
    const payloadItems = Array.from({ length: 31 }, (_, index) => ({
      id: `overflow-${index}`,
      sourceId: `overflow-${index}`,
      text: `body ${index}`
    }));

    const sendResponse = vi.fn();
    onMessageHandler(
      {
        schemaVersion: SCHEMA_VERSION,
        type: "MEMORY_INDEX_REQUEST",
        payload: { schemaVersion: MEMORY_SCHEMA_VERSION, items: payloadItems }
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
      sendResponse
    );

    const overflowCall = chromeMock.tabs.sendMessage.mock.calls.find(([, message]) => {
      return (
        (message as any).type === "MEMORY_INDEX_RESULT" &&
        (message as any).payload?.counts?.failed === 1 &&
        (message as any).payload?.results?.[0]?.message === "queue-overflow"
      );
    });

    expect(overflowCall).toBeDefined();

    vi.useRealTimers();
  });
});
