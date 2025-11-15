import { useMemo } from "react";

export interface ChatFiltersProps {
  search: string;
  onSearchChange(value: string): void;
  toggles: {
    includePage: boolean;
    includeDomain: boolean;
    includeEntities: boolean;
    includeRelationships: boolean;
    includeMessages: boolean;
  };
  onToggle(key: keyof ChatFiltersProps["toggles"]): void;
  loading: boolean;
  stats?: {
    total: number;
    filtered: number;
    truncated: boolean;
    durationMs?: number;
  };
  contextLabels: {
    page?: string;
    domain?: string;
    entities: string[];
    relationships: string[];
  };
}

function Chip({
  label,
  active,
  onClick,
  disabled
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`llm-chip${active ? " llm-chip--active" : ""}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function ChatFilters({
  search,
  onSearchChange,
  toggles,
  onToggle,
  loading,
  stats,
  contextLabels
}: ChatFiltersProps): JSX.Element {
  const summary = useMemo(() => {
    if (!stats) return "";
    const base = stats.truncated
      ? `Showing ${stats.filtered}+ of ${stats.total}`
      : `Showing ${stats.filtered}/${stats.total}`;
    if (typeof stats.durationMs === "number") {
      return `${base} · ${Math.round(stats.durationMs)} ms`;
    }
    return base;
  }, [stats]);

  return (
    <div className="llm-chat-filters" aria-label="Chat search and filters">
      <label className="llm-chat-filters__search">
        <span className="sr-only">Search chats</span>
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by title, anchor…"
          type="search"
          aria-label="Search chats"
        />
        {loading ? <span className="llm-spinner" aria-hidden="true" /> : null}
      </label>

      <div className="llm-chat-filters__chips" role="group" aria-label="Context filters">
        <Chip
          label={contextLabels.page ? "Page" : "Page (none)"}
          active={toggles.includePage}
          disabled={!contextLabels.page}
          onClick={() => onToggle("includePage")}
        />
        <Chip
          label={contextLabels.domain ? "Domain" : "Domain (none)"}
          active={toggles.includeDomain}
          disabled={!contextLabels.domain}
          onClick={() => onToggle("includeDomain")}
        />
        <Chip
          label={
            contextLabels.entities.length
              ? `Entities (${contextLabels.entities.length})`
              : "Entities (none)"
          }
          active={toggles.includeEntities}
          disabled={!contextLabels.entities.length}
          onClick={() => onToggle("includeEntities")}
        />
        <Chip
          label={
            contextLabels.relationships.length
              ? `Relationships (${contextLabels.relationships.length})`
              : "Relationships (none)"
          }
          active={toggles.includeRelationships}
          disabled={!contextLabels.relationships.length}
          onClick={() => onToggle("includeRelationships")}
        />
        <Chip
          label="Messages"
          active={toggles.includeMessages}
          onClick={() => onToggle("includeMessages")}
        />
      </div>

      {summary ? <p className="llm-chat-filters__summary" aria-live="polite">{summary}</p> : null}
    </div>
  );
}

export default ChatFilters;
