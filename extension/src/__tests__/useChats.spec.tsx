/* @vitest-environment jsdom */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import type { Chat } from "../types/chat";
import { useChats } from "../hooks/useChats";

const listChatsMock = vi.fn();
const filterChatsMock = vi.fn();

vi.mock("../services/chat-store", () => ({
  listChats: (...args: unknown[]) => listChatsMock(...args),
  filterChats: (...args: unknown[]) => filterChatsMock(...args)
}));

function TestHarness({
  options,
  onUpdate
}: {
  options: Parameters<typeof useChats>[0];
  onUpdate: (result: ReturnType<typeof useChats>) => void;
}) {
  const result = useChats(options);
  onUpdate(result);
  return null;
}

const chats: Chat[] = [
  {
    chatId: "1",
    title: "One",
    messages: [],
    anchors: { pageUrl: "", domain: "", entities: [], relationships: [] },
    pinned: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    lastTouched: "2024-01-01T00:00:00.000Z"
  }
];

describe("useChats hook", () => {
  beforeEach(() => {
    listChatsMock.mockReset();
    filterChatsMock.mockReset();
    listChatsMock.mockResolvedValue(chats);
    filterChatsMock.mockReturnValue({
      chats,
      truncated: false,
      durationMs: 10
    });
    (globalThis as any).chrome = undefined;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("loads chats on mount and exposes results", async () => {
    let latest: ReturnType<typeof useChats> | undefined;
    render(<TestHarness options={{}} onUpdate={(r) => (latest = r)} />);
    await waitFor(() => expect(latest?.loading).toBe(false));
    expect(listChatsMock).toHaveBeenCalledTimes(1);
    expect(filterChatsMock).toHaveBeenCalledWith(chats, expect.any(Object));
    expect(latest?.chats).toEqual(chats);
    expect(latest?.totalCount).toBe(chats.length);
  });

  it("refresh triggers another load", async () => {
    let latest: ReturnType<typeof useChats> | undefined;
    render(<TestHarness options={{}} onUpdate={(r) => (latest = r)} />);
    await waitFor(() => expect(latest?.loading).toBe(false));
    listChatsMock.mockResolvedValueOnce(chats);
    act(() => {
      latest?.refresh();
    });
    await waitFor(() => expect(listChatsMock).toHaveBeenCalledTimes(2));
  });

  it("passes through filter options when they change", async () => {
    let latest: ReturnType<typeof useChats> | undefined;
    const { rerender } = render(
      <TestHarness options={{ query: "a", scope: { domain: "x" }, includeMessages: true }} onUpdate={(r) => (latest = r)} />
    );
    await waitFor(() => expect(filterChatsMock).toHaveBeenCalled());
    expect(filterChatsMock).toHaveBeenLastCalledWith(chats, expect.objectContaining({ query: "a", scope: { domain: "x" }, includeMessages: true, limit: 200 }));

    rerender(
      <TestHarness
        options={{ query: "b", scope: { pageUrl: "p" }, includeMessages: false, limit: 5 }}
        onUpdate={(r) => (latest = r)}
      />
    );
    await waitFor(() => expect(filterChatsMock).toHaveBeenLastCalledWith(chats, expect.objectContaining({ query: "b", scope: { pageUrl: "p" }, includeMessages: false, limit: 5 })));
  });

  it("emits telemetry only when duration exceeds threshold and chrome is available", async () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome = { runtime: { sendMessage } };
    filterChatsMock.mockReturnValue({ chats, truncated: false, durationMs: 250 });
    render(<TestHarness options={{}} onUpdate={() => {}} />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "DEV_TELEMETRY_EVENT" })));

    sendMessage.mockClear();
    (globalThis as any).chrome = undefined;
    filterChatsMock.mockReturnValue({ chats, truncated: false, durationMs: 250 });
    render(<TestHarness options={{}} onUpdate={() => {}} />);
    await waitFor(() => expect(sendMessage).not.toHaveBeenCalled());
  });
});
