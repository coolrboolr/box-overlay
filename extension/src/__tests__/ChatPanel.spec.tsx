/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPanel from "../components/chat/ChatPanel";

const closeChatPanel = vi.fn();
let overlayOpen = true;
let ontologyMock = {
  pageUrl: "https://example.com/page",
  domain: "example.com",
  entities: [{ id: "e1", label: "Alpha", type: "person" }],
  relationships: [{ id: "r1", label: "Rel", type: "mentions" }]
};
let chatResultMock: ReturnType<typeof createChatResult>;
const useChatsMock = vi.fn();

vi.mock("../state/overlayStore", () => ({
  useOverlayState: () => ({ chatPanelOpen: overlayOpen }),
  closeChatPanel: (...args: unknown[]) => closeChatPanel(...args)
}));

vi.mock("../hooks/useOntologyContext", () => ({
  useOntologyContext: () => ontologyMock
}));

vi.mock("../hooks/useChats", () => ({
  useChats: (...args: unknown[]) => useChatsMock(...args)
}));

function createChatResult(overrides?: Partial<ReturnType<typeof baseChatResult>>) {
  const base = baseChatResult();
  return { ...base, ...overrides };
}

function baseChatResult() {
  const chats = [
    {
      chatId: "pinned",
      title: "Pinned chat",
      pinned: true,
      anchors: { pageUrl: "", domain: "", entities: [], relationships: [] },
      messages: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      lastTouched: "2024-01-03T00:00:00.000Z"
    },
    {
      chatId: "recent",
      title: "Recent chat",
      pinned: false,
      anchors: { pageUrl: "", domain: "", entities: [], relationships: [] },
      messages: [],
      createdAt: "2024-01-02T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      lastTouched: "2024-01-02T00:00:00.000Z"
    }
  ];
  return {
    chats,
    pinned: [chats[0]],
    recent: [chats[1]],
    totalCount: chats.length,
    filteredCount: chats.length,
    truncated: false,
    durationMs: 5,
    loading: false,
    error: undefined,
    refresh: vi.fn()
  };
}

describe("ChatPanel", () => {
  beforeEach(() => {
    overlayOpen = true;
    ontologyMock = {
      pageUrl: "https://example.com/page",
      domain: "example.com",
      entities: [{ id: "e1", label: "Alpha", type: "person" }],
      relationships: [{ id: "r1", label: "Rel", type: "mentions" }]
    };
    chatResultMock = createChatResult();
    useChatsMock.mockImplementation(() => chatResultMock);
    closeChatPanel.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("focuses first focusable and defaults to pinned chat when open", async () => {
    const launcher = document.createElement("button");
    const { container } = render(<ChatPanel launcherRef={{ current: launcher }} />);
    const closeButton = screen.getByRole("button", { name: /close chat panel/i });
    await waitFor(() => expect(closeButton).toHaveFocus());
    const pinnedRow = container.querySelector('button.llm-chat-list__row');
    expect(pinnedRow).toHaveAttribute("aria-pressed", "true");
  });

  it("passes ontology scope to useChats and updates when toggled", async () => {
    const launcher = document.createElement("button");
    render(<ChatPanel launcherRef={{ current: launcher }} />);
    const firstCall = useChatsMock.mock.calls[0][0];
    expect(firstCall.scope).toEqual({
      pageUrl: "https://example.com/page",
      domain: "example.com",
      entityIds: ["e1"],
      relationshipIds: ["r1"]
    });

    await userEvent.click(screen.getByRole("button", { name: /entities/i }));
    await waitFor(() => expect(useChatsMock.mock.calls.at(-1)?.[0].scope?.entityIds).toBeUndefined());
  });

  it("debounces search before invoking useChats with query", async () => {
    vi.useRealTimers();
    const launcher = document.createElement("button");
    render(<ChatPanel launcherRef={{ current: launcher }} />);
    const initialCalls = useChatsMock.mock.calls.length;
    await userEvent.type(screen.getByRole("searchbox"), "alpha");
    expect(screen.getByLabelText("Search chats").parentElement?.querySelector(".llm-spinner")).toBeTruthy();
    const immediateCall = useChatsMock.mock.calls.at(-1)?.[0];
    expect(immediateCall?.query ?? "").toBe("");
    await waitFor(() => expect(useChatsMock.mock.calls.length).toBeGreaterThan(initialCalls));
    await waitFor(() => {
      const lastCall = useChatsMock.mock.calls.at(-1)?.[0];
      expect(lastCall?.query).toBe("alpha");
    });
  });

  it("renders no-context, loading, error, empty, and truncated states", async () => {
    ontologyMock = { pageUrl: undefined, domain: undefined, entities: [], relationships: [] };
    chatResultMock = createChatResult({ chats: [], pinned: [], recent: [], totalCount: 0, filteredCount: 0 });
    const { rerender } = render(<ChatPanel launcherRef={{ current: document.createElement("button") }} />);
    expect(screen.getByText(/No ontology context detected/i)).toBeInTheDocument();

    chatResultMock = createChatResult({ loading: true });
    rerender(<ChatPanel launcherRef={{ current: document.createElement("button") }} />);
    expect(screen.getByText(/Loading chats/)).toBeInTheDocument();

    const refresh = vi.fn();
    chatResultMock = createChatResult({ error: new Error("boom"), refresh });
    rerender(<ChatPanel launcherRef={{ current: document.createElement("button") }} />);
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refresh).toHaveBeenCalled();

    chatResultMock = createChatResult({ chats: [], pinned: [], recent: [], totalCount: 5, filteredCount: 0 });
    rerender(<ChatPanel launcherRef={{ current: document.createElement("button") }} />);
    expect(screen.getByText(/No chats match your filters/)).toBeInTheDocument();

    chatResultMock = createChatResult({ chats: [], pinned: [], recent: [], totalCount: 0, filteredCount: 0 });
    rerender(<ChatPanel launcherRef={{ current: document.createElement("button") }} />);
    expect(screen.getByText(/No chats yet/)).toBeInTheDocument();

    chatResultMock = createChatResult({ truncated: true, filteredCount: 3 });
    rerender(<ChatPanel launcherRef={{ current: document.createElement("button") }} />);
    expect(screen.getByText(/Showing first 3 results/)).toBeInTheDocument();
  });

  it("calls closeChatPanel and returns focus on close actions", async () => {
    const launcher = document.createElement("button");
    document.body.appendChild(launcher);
    render(<ChatPanel launcherRef={{ current: launcher }} />);
    await userEvent.click(screen.getByLabelText(/Close chat panel/i));
    expect(closeChatPanel).toHaveBeenCalled();
    expect(document.activeElement).toBe(launcher);
  });
});
