import { describe, beforeEach, afterEach, expect, it, vi } from "vitest";

vi.mock("../content/logStore", () => ({
  recordEvent: vi.fn()
}));

import { renderOverlay, updateOverlay, removeOverlay, updateOverlayStatus } from "../content/overlay";
import type { ItemAnalysisResponse } from "../types/messages";

const baseResponse: ItemAnalysisResponse = {
  id: "overlay-test",
  summary: "Initial summary",
  is_ad: false
};

describe("overlay renderer", () => {
  let target: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    target = document.createElement("article");
    target.textContent = "Harness card";
    document.body.appendChild(target);
  });

  afterEach(() => {
    removeOverlay("overlay-test");
    document.body.innerHTML = "";
  });

  it("renders a pending placeholder and upgrades to resolved state", () => {
    renderOverlay(target, baseResponse, { status: "pending" });
    const wrapper = document.querySelector<HTMLElement>(".llm-overlay-wrapper");
    expect(wrapper).toBeTruthy();
    const card = wrapper?.querySelector(".llm-overlay-card");
    expect(card?.classList.contains("llm-overlay-card--pending")).toBe(true);

    updateOverlay("overlay-test", { ...baseResponse, summary: "Resolved summary" }, { status: "resolved" });
    expect(card?.classList.contains("llm-overlay-card--pending")).toBe(false);
    expect(card?.querySelector(".llm-overlay-summary")?.textContent).toBe("Resolved summary");
  });

  it("shows retry affordance in error state", () => {
    const retry = vi.fn();
    renderOverlay(target, baseResponse, { status: "pending" });
    updateOverlayStatus("overlay-test", "error", { errorMessage: "Mock failure", onRetry: retry });

    const button = document.querySelector<HTMLButtonElement>(".llm-overlay-retry");
    expect(button).toBeTruthy();
    button?.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("applies ad styling and tag metadata when resolved", () => {
    renderOverlay(target, { ...baseResponse, image_tag: "editorial", is_ad: true }, { status: "resolved" });
    const card = document.querySelector(".llm-overlay-card");
    expect(card?.classList.contains("llm-overlay-card--ad")).toBe(true);
    expect(card?.querySelector(".llm-overlay-tag")?.textContent).toBe("editorial");
    expect(card?.querySelector(".llm-overlay-badge")?.textContent).toBe("Ad");
  });
});
