import { beforeEach, describe, expect, it } from "vitest";
import { getActiveProfile, resolveProfile, resetProfileCache } from "../content/siteProfiles";

describe("siteProfiles", () => {
  beforeEach(() => {
    resetProfileCache();
  });

  it("resolves default profile for localhost", () => {
    const profile = resolveProfile("http://localhost:3000");
    expect(profile.name).toBe("default");
    expect(profile.selectors.length).toBeGreaterThan(0);
  });

  it("resolves domain-specific profile for Bellroy", () => {
    const profile = resolveProfile("https://bellroy.com/products/demo");
    expect(profile.name).toBe("bellroy-detail");
    expect(profile.selectors.some((selector) => selector.includes("story"))).toBe(true);
  });

  it("caches the active profile", () => {
    const profileA = getActiveProfile();
    const profileB = getActiveProfile();
    expect(profileA).toBe(profileB);
  });
});
