import { afterEach, describe, expect, it, vi } from "vitest";

import { clearHighlight, renderHighlight } from "../content/highlight";

describe("highlight renderer", () => {
  afterEach(() => {
    clearHighlight();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("wraps matching text and applies highlight styles", () => {
    document.body.innerHTML = `<p id="target">Persistent memory makes local recall instant.</p>`;

    const rendered = renderHighlight({ sourceId: "target", snippet: "local recall instant" });

    expect(rendered).toBe(true);
    expect(document.querySelector(".llm-memory-highlight")).toBeTruthy();
  });

  it("auto-clears highlight after timeout", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<p>Highlight me quickly</p>`;

    const rendered = renderHighlight({ snippet: "Highlight me" });
    expect(rendered).toBe(true);

    vi.advanceTimersByTime(6000);
    expect(document.querySelector(".llm-memory-highlight")).toBeNull();
    vi.useRealTimers();
  });
});
