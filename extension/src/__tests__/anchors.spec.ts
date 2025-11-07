import { afterEach, describe, expect, it } from "vitest";
import { clearAnchor, getAnchor, rememberAnchor, resolveAnchor } from "../content/anchors";

describe("anchors", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("prefers stable ancestors with data attributes", () => {
    const section = document.createElement("section");
    section.dataset.component = "card";
    const child = document.createElement("div");
    child.textContent = "Sample content";
    section.appendChild(child);
    document.body.appendChild(section);

    const anchor = resolveAnchor(child);
    expect(anchor).toBe(section);
  });

  it("remembers and clears anchors as DOM changes", () => {
    const article = document.createElement("article");
    article.textContent = "Story";
    document.body.appendChild(article);

    rememberAnchor("item-1", article);
    expect(getAnchor("item-1")).toBe(article);

    article.remove();
    expect(getAnchor("item-1")).toBeNull();

    clearAnchor("item-1");
    expect(getAnchor("item-1")).toBeNull();
  });
});
