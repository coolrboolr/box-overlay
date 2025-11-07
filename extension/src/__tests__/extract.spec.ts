import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractItems, cleanText } from "../content/extract";
import { resetProcessed } from "../content/state";

const LONG_TEXT = "Latest market update ".repeat(20);

describe("extractItems", () => {
  beforeEach(() => {
    resetProcessed();
  });

  afterEach(() => {
    resetProcessed();
    document.body.innerHTML = "";
  });

  it("returns candidates that match selectors with sufficient text", async () => {
    document.body.innerHTML = `
      <section>
        <article class="post">${LONG_TEXT}<img src="data:image/png;base64,AAA" /></article>
        <div class="card">short</div>
        <div role="article">${LONG_TEXT}</div>
      </section>
    `;

    const items = await extractItems(document);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: expect.stringMatching(/^item-/),
      text: expect.stringContaining("Latest market update"),
      image: expect.stringContaining("data:image/png")
    });
    expect(items[1]).toMatchObject({
      id: expect.stringMatching(/^item-/),
      text: expect.stringContaining("Latest market update")
    });
  });

  it("skips nodes that are too short or not article-like", async () => {
    document.body.innerHTML = `
      <nav>${LONG_TEXT}</nav>
      <div class="menu">${LONG_TEXT}</div>
      <article>${"tiny"}</article>
    `;

    const items = await extractItems(document);
    expect(items).toHaveLength(0);
  });
});

describe("cleanText", () => {
  it("normalizes whitespace", () => {
    const node = document.createElement("div");
    node.textContent = "Hello\n\nworld    this is\t\ttrimmed";
    expect(cleanText(node)).toBe("Hello world this is trimmed");
  });

  it("truncates text longer than the maximum", () => {
    const node = document.createElement("div");
    node.textContent = "A".repeat(2000);
    expect(cleanText(node)).toHaveLength(1500);
  });
});
