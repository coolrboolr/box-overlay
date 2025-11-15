import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { closeChatPanel, useOverlayState } from "../../state/overlayStore";
import { useOntologyContext } from "../../hooks/useOntologyContext";
import { useChats } from "../../hooks/useChats";
import ChatList from "./ChatList";
import ChatDetail from "./ChatDetail";
import ChatFilters from "./ChatFilters";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface ChatPanelProps {
  launcherRef: RefObject<HTMLButtonElement>;
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
  const ontology = useOntologyContext();
  const [selectedChatId, setSelectedChatId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [scopeToggles, setScopeToggles] = useState({
    includePage: Boolean(ontology.pageUrl),
    includeDomain: Boolean(ontology.domain),
    includeEntities: ontology.entities.length > 0,
    includeRelationships: ontology.relationships.length > 0,
    includeMessages: true
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    setSearching(true);
    const handle = window.setTimeout(() => setDebouncedSearch(search.trim()), 180);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    setSearching(false);
  }, [debouncedSearch]);

  useEffect(() => {
    setScopeToggles((current) => ({
      ...current,
      includePage: Boolean(ontology.pageUrl),
      includeDomain: Boolean(ontology.domain),
      includeEntities: ontology.entities.length > 0,
      includeRelationships: ontology.relationships.length > 0
    }));
  }, [ontology.pageUrl, ontology.domain, ontology.entities.length, ontology.relationships.length]);

  const scope = useMemo(
    () => ({
      pageUrl: scopeToggles.includePage ? ontology.pageUrl : undefined,
      domain: scopeToggles.includeDomain ? ontology.domain : undefined,
      entityIds: scopeToggles.includeEntities ? ontology.entities.map((e) => e.id) : undefined,
      relationshipIds: scopeToggles.includeRelationships
        ? ontology.relationships.map((r) => r.id)
        : undefined
    }),
    [ontology, scopeToggles]
  );

  const chatResult = useChats({
    query: debouncedSearch,
    scope,
    includeMessages: scopeToggles.includeMessages
  });

  const chats = useMemo(() => chatResult.chats, [chatResult.chats]);

  useEffect(() => {
    if (chatPanelOpen && !selectedChatId && chats.length > 0) {
      const pinned = chats.find((chat) => chat.pinned);
      setSelectedChatId((pinned ?? chats[0]).chatId);
    }
  }, [chatPanelOpen, selectedChatId, chats]);

  useEffect(() => {
    if (!selectedChatId && chats.length === 0) {
      return;
    }
    const stillExists = chats.some((chat) => chat.chatId === selectedChatId);
    if (!stillExists && chats.length > 0) {
      setSelectedChatId(chats[0].chatId);
    }
  }, [chats, selectedChatId]);

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
          <div className="llm-chat-panel__sidebar">
            <ChatFilters
              search={search}
              onSearchChange={setSearch}
              toggles={scopeToggles}
              onToggle={(key) =>
                setScopeToggles((current) => ({
                  ...current,
                  [key]: !current[key as keyof typeof current]
                }))
              }
              loading={chatResult.loading || searching}
              stats={{
                total: chatResult.totalCount,
                filtered: chatResult.filteredCount,
                truncated: chatResult.truncated,
                durationMs: chatResult.durationMs
              }}
              contextLabels={{
                page: ontology.pageUrl,
                domain: ontology.domain,
                entities: ontology.entities.map((e) => e.label),
                relationships: ontology.relationships.map((r) => r.label ?? r.type ?? r.id)
              }}
            />
            {!chatResult.loading && !ontology.pageUrl && !ontology.domain && ontology.entities.length === 0 && ontology.relationships.length === 0 ? (
              <p className="llm-chat-list__empty" role="note">
                No ontology context detected on this page yet.
              </p>
            ) : null}
            {chatResult.error ? (
              <div className="llm-chat-list__empty llm-chat-list__empty--error" role="alert">
                <p>Could not load chats.</p>
                <button type="button" onClick={() => chatResult.refresh()}>
                  Retry
                </button>
              </div>
            ) : chatResult.loading ? (
              <div className="llm-chat-list__empty">
                <span className="llm-spinner" aria-hidden="true" /> Loading chats…
              </div>
            ) : chats.length === 0 ? (
              <div className="llm-chat-list__empty" aria-live="polite">
                {chatResult.totalCount === 0
                  ? "No chats yet. Start a new chat from this page."
                  : "No chats match your filters."}
              </div>
            ) : (
              <>
                {chatResult.truncated ? (
                  <p className="llm-chat-list__hint" role="status">
                    Showing first {chatResult.filteredCount} results.
                  </p>
                ) : null}
                <ChatList
                  chats={chats}
                  selectedChatId={selectedChatId}
                  onSelect={setSelectedChatId}
                />
              </>
            )}
          </div>
          <ChatDetail chat={selectedChat} />
        </div>
      </aside>
    </div>
  );
}

export default ChatPanel;
