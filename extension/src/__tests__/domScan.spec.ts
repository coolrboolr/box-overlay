import { describe, expect, it } from "vitest";
import { isExtensionContextInvalid } from "../content/domScan";

describe("domScan helpers", () => {
  it("detects extension context invalidation errors", () => {
    expect(isExtensionContextInvalid(new Error("Extension context invalidated."))).toBe(true);
    expect(isExtensionContextInvalid("extension context invalidated")).toBe(true);
    expect(isExtensionContextInvalid(new Error("Network failed"))).toBe(false);
  });
});
