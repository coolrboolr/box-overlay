/* @vitest-environment jsdom */
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatFilters from "../components/chat/ChatFilters";

const defaultProps = {
  search: "",
  onSearchChange: vi.fn(),
  toggles: {
    includePage: true,
    includeDomain: true,
    includeEntities: true,
    includeRelationships: true,
    includeMessages: true
  },
  onToggle: vi.fn(),
  loading: false,
  stats: undefined as
    | {
        total: number;
        filtered: number;
        truncated: boolean;
        durationMs?: number;
      }
    | undefined,
  contextLabels: {
    page: "https://example.com",
    domain: "example.com",
    entities: ["Alpha", "Beta"],
    relationships: ["Rel"]
  }
};

describe("ChatFilters component", () => {
  it("renders search input and chips", () => {
    render(<ChatFilters {...defaultProps} />);
    expect(screen.getByRole("searchbox", { name: /search chats/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /domain/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /entities/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /relationships/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /messages/i })).toBeInTheDocument();
  });

  it("disables chips when context labels are absent and shows '(none)'", () => {
    render(
      <ChatFilters
        {...defaultProps}
        contextLabels={{ page: undefined, domain: undefined, entities: [], relationships: [] }}
        toggles={{ ...defaultProps.toggles, includePage: false, includeDomain: false, includeEntities: false, includeRelationships: false }}
      />
    );
    const pageChip = screen.getByRole("button", { name: /page \(none\)/i });
    expect(pageChip).toBeDisabled();
    const domainChip = screen.getByRole("button", { name: /domain \(none\)/i });
    expect(domainChip).toBeDisabled();
    const entitiesChip = screen.getByRole("button", { name: /entities \(none\)/i });
    expect(entitiesChip).toBeDisabled();
    const relationshipsChip = screen.getByRole("button", { name: /relationships \(none\)/i });
    expect(relationshipsChip).toBeDisabled();
  });

  it("includes counts in entity and relationship chips", () => {
    render(<ChatFilters {...defaultProps} />);
    expect(screen.getByRole("button", { name: /entities \(2\)/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /relationships \(1\)/i })).toBeEnabled();
  });

  it("invokes onToggle for enabled chips and ignores disabled ones", async () => {
    const onToggle = vi.fn();
    render(<ChatFilters {...defaultProps} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: /domain/i }));
    expect(onToggle).toHaveBeenCalledWith("includeDomain");

    onToggle.mockClear();
    render(
      <ChatFilters
        {...defaultProps}
        onToggle={onToggle}
        contextLabels={{ page: undefined, domain: undefined, entities: [], relationships: [] }}
        toggles={{ ...defaultProps.toggles, includePage: false, includeDomain: false, includeEntities: false, includeRelationships: false }}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /page \(none\)/i }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shows loading spinner inside search when loading", () => {
    render(<ChatFilters {...defaultProps} loading />);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByLabelText("Search chats").parentElement?.querySelector(".llm-spinner")).toBeTruthy();
  });

  it("renders summary text variants", () => {
    const { rerender } = render(<ChatFilters {...defaultProps} stats={undefined} />);
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();

    rerender(<ChatFilters {...defaultProps} stats={{ total: 10, filtered: 4, truncated: false }} />);
    expect(screen.getByText("Showing 4/10")).toBeInTheDocument();

    rerender(<ChatFilters {...defaultProps} stats={{ total: 500, filtered: 200, truncated: true }} />);
    expect(screen.getByText("Showing 200+ of 500")).toBeInTheDocument();

    rerender(
      <ChatFilters
        {...defaultProps}
        stats={{ total: 50, filtered: 20, truncated: false, durationMs: 123.4 }}
      />
    );
    expect(screen.getByText("Showing 20/50 · 123 ms")).toBeInTheDocument();
  });
});
