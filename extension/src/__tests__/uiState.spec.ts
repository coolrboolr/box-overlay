import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("uiState storage fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as any).chrome = {
      storage: {
        session: {
          get: vi.fn(),
          set: vi.fn()
        }
      },
      runtime: {
        lastError: undefined as chrome.runtime.LastError | undefined
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("short-circuits storage calls after access is forbidden", async () => {
    const getMock = vi.fn(() => {
      throw new Error("Access to storage is not allowed from this context.");
    });
    const setMock = vi.fn((_: Record<string, unknown>, callback: () => void) => callback());

    (globalThis as any).chrome.storage.session.get = getMock;
    (globalThis as any).chrome.storage.session.set = setMock;

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { getGlobalEnabled, setGlobalEnabled } = await import("../content/uiState");

    const first = await getGlobalEnabled();
    expect(first).toBe(true);
    expect(getMock).toHaveBeenCalledTimes(1);

    const second = await getGlobalEnabled();
    expect(second).toBe(true);
    expect(getMock).toHaveBeenCalledTimes(1);

    await setGlobalEnabled(false);
    expect(setMock).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
