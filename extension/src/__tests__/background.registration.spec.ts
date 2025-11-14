import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("background dev origin handling", () => {
  let chromeMock: ReturnType<typeof createChromeBackgroundMock>;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    chromeMock = createChromeBackgroundMock();
    (globalThis as any).chrome = chromeMock;
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it("re-registers and retries once when backend returns 403", async () => {
    const analyzeResponse = {
      id: "forbidden-item",
      summary: "Recovered",
      isAd: false
    };

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(analyzeResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await import("../background/index");

    const onMessageHandler = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];
    onMessageHandler(
      {
        schemaVersion: SCHEMA_VERSION,
        type: "ANALYZE_REQUEST",
        payload: { schemaVersion: SCHEMA_VERSION, id: "forbidden-item", text: "Payload" }
      },
      { tab: { id: 1 } } as chrome.runtime.MessageSender
    );

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        {
          schemaVersion: SCHEMA_VERSION,
          type: "ANALYZE_RESULT",
          payload: analyzeResponse
        },
        expect.any(Function)
      );
    });

    const registerCall = fetchMock.mock.calls[2]?.[0] as string;
    expect(registerCall).toContain("/api/dev/register-extension-origin");

    const telemetryMessage = chromeMock.tabs.sendMessage.mock.calls.find(([, message]) => {
      return (message as any).type === "DEV_TELEMETRY_EVENT";
    })?.[1] as { payload?: { event?: string } } | undefined;

    expect(telemetryMessage?.payload?.event).toBe("FORBIDDEN_RECOVERY");
  });

  it("emits retryable error with details after repeated 403 responses", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    try {
      await import("../background/index");

      const onMessageHandler = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];
      onMessageHandler(
        {
          schemaVersion: SCHEMA_VERSION,
          type: "ANALYZE_REQUEST",
          payload: { schemaVersion: SCHEMA_VERSION, id: "still-forbidden", text: "Payload" }
        },
        { tab: { id: 7 } } as chrome.runtime.MessageSender
      );

      await vi.runOnlyPendingTimersAsync();
      await vi.runOnlyPendingTimersAsync();

      await vi.waitFor(() => {
        expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
          7,
          expect.objectContaining({ type: "ANALYZE_ERROR" }),
          expect.any(Function)
        );
      });

      const errorMessage = chromeMock.tabs.sendMessage.mock.calls.find(([, message]) => {
        return (message as any).type === "ANALYZE_ERROR";
      })?.[1] as { payload: { retryable: boolean; details?: string; statusCode?: number } } | undefined;

      expect(errorMessage?.payload.retryable).toBe(true);
      expect(errorMessage?.payload.details).toBe("FORBIDDEN_ORIGIN");
      expect(errorMessage?.payload.statusCode).toBe(403);
    } finally {
      vi.useRealTimers();
    }
  });
});
