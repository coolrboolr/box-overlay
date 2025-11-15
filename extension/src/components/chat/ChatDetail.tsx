import type { Chat } from "../../types/chat";
import { useOntologyContext } from "../../hooks/useOntologyContext";

interface ChatDetailProps {
  chat?: Chat;
}

function renderAnchorEntities(chat: Chat): JSX.Element | null {
  const hasEntities = chat.anchors.entities.length > 0;
  const hasRelationships = chat.anchors.relationships.length > 0;
  const hasPage = Boolean(chat.anchors.pageUrl || chat.anchors.domain);

  if (!hasEntities && !hasRelationships && !hasPage) {
    return <p className="llm-chat-detail__empty">No anchors captured for this chat yet.</p>;
  }

  return (
    <div className="llm-chat-detail__anchors">
      {chat.anchors.pageUrl ? (
        <div className="llm-chat-detail__anchor-line">
          <span className="llm-chat-detail__anchor-label">Page</span>
          <span className="llm-chat-detail__anchor-value" title={chat.anchors.pageUrl}>
            {chat.anchors.pageUrl}
          </span>
        </div>
      ) : null}
      {chat.anchors.domain ? (
        <div className="llm-chat-detail__anchor-line">
          <span className="llm-chat-detail__anchor-label">Domain</span>
          <span className="llm-chat-detail__anchor-chip">{chat.anchors.domain}</span>
        </div>
      ) : null}
      {hasEntities ? (
        <div className="llm-chat-detail__anchor-line">
          <span className="llm-chat-detail__anchor-label">Entities</span>
          <div className="llm-chat-detail__chip-row" role="list">
            {chat.anchors.entities.map((entity) => (
              <span key={entity.id} className="llm-chat-detail__anchor-chip" role="listitem">
                {entity.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {hasRelationships ? (
        <div className="llm-chat-detail__anchor-line">
          <span className="llm-chat-detail__anchor-label">Relationships</span>
          <div className="llm-chat-detail__chip-row" role="list">
            {chat.anchors.relationships.map((rel) => (
              <span key={rel.id} className="llm-chat-detail__anchor-chip" role="listitem">
                {rel.label ?? rel.type}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ChatDetail({ chat }: ChatDetailProps): JSX.Element {
  const ontology = useOntologyContext();

  if (!chat) {
    return (
      <div className="llm-chat-detail llm-chat-detail--empty">
        <div className="llm-chat-detail__placeholder">
          <p className="llm-chat-detail__title">Select a chat or start a new one.</p>
          <p className="llm-chat-detail__hint">
            Pinned and recent chats will show details and anchors here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="llm-chat-detail">
      <header className="llm-chat-detail__header">
        <div className="llm-chat-detail__title-row">
          <h3 className="llm-chat-detail__title">{chat.title}</h3>
          {chat.pinned ? <span className="llm-chat-detail__badge">Pinned</span> : null}
        </div>
        <p className="llm-chat-detail__meta" aria-label={`Last touched ${chat.lastTouched}`}>
          Last touched: {new Date(chat.lastTouched).toLocaleString()}
        </p>
      </header>

      <section
        className="llm-chat-detail__section"
        aria-labelledby="llm-chat-detail-anchors-heading"
      >
        <div className="llm-chat-detail__section-heading" id="llm-chat-detail-anchors-heading">
          Anchored to
        </div>
        {renderAnchorEntities(chat)}
      </section>

      <section
        className="llm-chat-detail__section"
        aria-labelledby="llm-chat-detail-context-heading"
      >
        <div className="llm-chat-detail__section-heading" id="llm-chat-detail-context-heading">
          Ontology context
        </div>
        {ontology.pageUrl || ontology.entities.length ? (
          <p className="llm-chat-detail__context">
            Context: {ontology.pageUrl ?? "Unknown page"}
            {ontology.domain ? ` · ${ontology.domain}` : ""}
            {ontology.entities.length
              ? ` · ${ontology.entities.map((entity) => entity.label).join(", ")}`
              : ""}
            {ontology.relationships.length
              ? ` · ${ontology.relationships.map((rel) => rel.label ?? rel.type ?? "relationship").join(", ")}`
              : ""}
          </p>
        ) : (
          <p className="llm-chat-detail__context">No ontology context available on this page yet.</p>
        )}
      </section>

      <section className="llm-chat-detail__section" aria-label="Messages">
        <div className="llm-chat-detail__messages" role="log" aria-live="polite">
          <p className="llm-chat-detail__empty">Messages will appear here…</p>
        </div>
        <div className="llm-chat-detail__composer">
          <button type="button" className="llm-chat-detail__composer-button" disabled>
            LLM integration TBD (SPEC24+)
          </button>
        </div>
      </section>
    </div>
  );
}

export default ChatDetail;
