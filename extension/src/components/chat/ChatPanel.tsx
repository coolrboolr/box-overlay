import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Chat } from "../../types/chat";
import { closeChatPanel, useOverlayState } from "../../state/overlayStore";
import ChatList from "./ChatList";
import ChatDetail from "./ChatDetail";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface ChatPanelProps {
  launcherRef: RefObject<HTMLButtonElement>;
}

function getDomainFromUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function createStubChats(): Chat[] {
  const now = new Date().toISOString();
  const pageUrl = typeof window !== "undefined" ? window.location.href : "https://example.com";
  const domain = getDomainFromUrl(pageUrl) ?? "example.com";

  return [
    {
      chatId: "chat-pinned-1",
      title: "Current page overview",
      messages: [],
      anchors: {
        pageUrl,
        domain,
        entities: [
          { id: "entity-1", label: "Current page", type: "article" },
          { id: "entity-2", label: "Example anchor", type: "unknown" }
        ],
        relationships: []
      },
      pinned: true,
      createdAt: now,
      updatedAt: now,
      lastTouched: now
    },
    {
      chatId: "chat-recent-1",
      title: "Entity follow-ups",
      messages: [],
      anchors: {
        pageUrl,
        domain,
        entities: [{ id: "entity-3", label: "Widgets Inc", type: "brand" }],
        relationships: []
      },
      pinned: false,
      createdAt: now,
      updatedAt: now,
      lastTouched: now
    },
    {
      chatId: "chat-recent-2",
      title: "Relationship notes",
      messages: [],
      anchors: {
        pageUrl,
        domain,
        entities: [{ id: "entity-4", label: "Sample person", type: "person" }],
        relationships: [
          {
            id: "rel-1",
            type: "mentions",
            fromId: "entity-4",
            toId: "entity-1",
            label: "Mentions this page"
          }
        ]
      },
      pinned: false,
      createdAt: now,
      updatedAt: now,
      lastTouched: now
    }
  ];
}

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) {
    return [];
  }
  const elements = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return elements.filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.getAttribute("aria-hidden") !== "true" &&
      el.tabIndex !== -1
  );
}

export function ChatPanel({ launcherRef }: ChatPanelProps): JSX.Element | null {
  const { chatPanelOpen } = useOverlayState();
  const [selectedChatId, setSelectedChatId] = useState<string | undefined>();
  const chats = useMemo(() => createStubChats(), []);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (chatPanelOpen && !selectedChatId && chats.length > 0) {
      const pinned = chats.find((chat) => chat.pinned);
      setSelectedChatId((pinned ?? chats[0]).chatId);
    }
  }, [chatPanelOpen, selectedChatId, chats]);

  useEffect(() => {
    if (!chatPanelOpen) {
      if (wasOpenRef.current) {
        launcherRef.current?.focus({ preventScroll: true });
      }
      wasOpenRef.current = false;
      return;
    }

    wasOpenRef.current = true;
    const dialog = panelRef.current;
    const focusables = getFocusableElements(dialog);
    (focusables[0] ?? dialog)?.focus({ preventScroll: true });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!chatPanelOpen) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeChatPanel();
        launcherRef.current?.focus({ preventScroll: true });
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const ordered = getFocusableElements(dialog);
      if (!ordered.length) {
        event.preventDefault();
        dialog?.focus({ preventScroll: true });
        return;
      }

      const first = ordered[0];
      const last = ordered[ordered.length - 1];

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
        return;
      }

      if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [chatPanelOpen, launcherRef]);

  if (!chatPanelOpen) {
    return null;
  }

  const selectedChat = chats.find((chat) => chat.chatId === selectedChatId);

  const handleClose = (): void => {
    closeChatPanel();
    launcherRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="llm-chat-layer" role="presentation">
      <div className="llm-chat-backdrop" aria-hidden="true" onClick={handleClose} />
      <aside
        className="llm-chat-panel"
        role="dialog"
        aria-modal="true"
        id="llm-chat-panel"
        aria-label="Overlay chat panel"
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="llm-chat-panel__header">
          <div className="llm-chat-panel__title-block">
            <p className="llm-chat-panel__eyebrow">Overlay</p>
            <h2 className="llm-chat-panel__title" id="llm-chat-panel-heading">
              Chat
            </h2>
          </div>
          <button
            type="button"
            className="llm-chat-panel__close"
            onClick={handleClose}
            aria-label="Close chat panel"
          >
            ×
          </button>
        </header>

        <div className="llm-chat-panel__body" aria-labelledby="llm-chat-panel-heading">
          <ChatList
            chats={chats}
            selectedChatId={selectedChatId}
            onSelect={setSelectedChatId}
          />
          <ChatDetail chat={selectedChat} />
        </div>
      </aside>
    </div>
  );
}

export default ChatPanel;
