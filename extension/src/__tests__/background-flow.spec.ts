import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_VERSION } from "../types/messages";

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
      })
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
      is_ad: false
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
});
