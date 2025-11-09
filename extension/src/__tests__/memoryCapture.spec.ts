import { describe, expect, it, beforeEach } from "vitest";

import { __testBuildMemoryItems } from "../content/memoryCapture";

const ORIGINAL_LOCATION = window.location.href;

describe("memory capture helper", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.title = "Harness";
    window.history.replaceState({}, "", ORIGINAL_LOCATION);
  });

  it("builds memory items and marks elements as pending", () => {
    document.body.innerHTML = `
      <main>
        <article class="story-card">
          <h2>Sample Article</h2>
          <p>This is a paragraph with enough descriptive text to meet thresholds.</p>
          <p>Another supporting paragraph for semantic capture.</p>
          <img src="data:image/png;base64,iVBORw0KGgo" alt="sample" />
        </article>
      </main>
    `;

    const items = __testBuildMemoryItems();
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.id).toMatch(/^item-/);
    expect(item.text.length).toBeGreaterThan(20);
    expect(item.url).toBe(window.location.href);
    expect(item.title).toBeDefined();
    const target = document.querySelector("article")!;
    expect(target.getAttribute("data-llm-memory-indexed")).toBe("pending");
  });

  it("respects existing markers unless force is true", () => {
    document.body.innerHTML = `
      <article class="story-card" data-llm-memory-indexed="stored" data-llm-memory-source="item-123">
        <p>Stored content snippet long enough</p>
      </article>
    `;

    const withoutForce = __testBuildMemoryItems();
    expect(withoutForce).toHaveLength(0);

    const withForce = __testBuildMemoryItems({ force: true });
    expect(withForce).toHaveLength(1);
  });
});
