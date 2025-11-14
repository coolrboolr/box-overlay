import { describe, expect, it } from "vitest";

import {
  ItemAnalysisRequestSchema,
  BatchAnalysisResultSchema,
  adaptLegacyBatchResult,
  MemoryQueryFiltersSchema,
  MemoryIndexItemSchema,
  MemoryIndexResultSchema,
  MemoryQueryHitSchema,
  MemoryMutationSchema,
  decodeWire,
  encodeWire
} from "../src/schema";

const baseAnalyzePayload = {
  schemaVersion: 1,
  id: "req-1",
  text: "hello world"
};

describe("schema hardening", () => {
  it("rejects unknown keys on analyze requests", () => {
    expect(() =>
      ItemAnalysisRequestSchema.parse({
        ...baseAnalyzePayload,
        extra: true
      })
    ).toThrowError(/unrecognized key/i);
  });

  it("accepts normalized image refs", () => {
    const parsed = ItemAnalysisRequestSchema.parse({
      ...baseAnalyzePayload,
      image: { kind: "tag", tag: "hero" }
    });
    expect(parsed.image).toEqual({ kind: "tag", tag: "hero" });
  });

  it("produces discriminated batch results", () => {
    const ok = BatchAnalysisResultSchema.parse({
      kind: "ok",
      id: "1",
      result: { id: "1", summary: "done", image: undefined, isAd: false }
    });
    expect(ok.kind).toBe("ok");
    const legacy = adaptLegacyBatchResult({
      id: "z",
      result: { id: "z", summary: "ok", image: undefined, isAd: false }
    });
    expect(legacy.kind).toBe("ok");
  });

  it("validates since/until windows", () => {
    expect(() =>
      MemoryQueryFiltersSchema.parse({ since: "2025-12-01T00:00:00.000Z", until: "2025-01-01T00:00:00.000Z" })
    ).toThrowError(/since must be earlier/i);
  });

  it("accepts bare hostnames for domain filters", () => {
    const parsed = MemoryQueryFiltersSchema.parse({ domain: "example.com" });
    expect(parsed.domain).toBe("example.com");
  });

  it("guards language and MIME types on index items", () => {
    expect(() =>
      MemoryIndexItemSchema.parse({
        id: "mem-1",
        text: "hello",
        language: "english",
        contentType: "html/plain"
      })
    ).toThrow();
  });

  it("enforces memory text limit", () => {
    const giant = "a".repeat(4100);
    expect(() =>
      MemoryIndexItemSchema.parse({
        id: "mem-1",
        text: giant
      })
    ).toThrow(/≤4000/);
  });

  it("requires storedIds for indexed results", () => {
    expect(() =>
      MemoryIndexResultSchema.parse({ id: "1", status: "indexed" })
    ).toThrow(/storedIds/);
  });

  it("clamps similarity to configured range", () => {
    expect(() =>
      MemoryQueryHitSchema.parse({
        id: "h",
        parentId: "p",
        snippet: "s",
        similarity: -0.1,
        entityType: "article"
      })
    ).toThrow();
  });

  it("rejects empty memory mutations", () => {
    expect(() => MemoryMutationSchema.parse({})).toThrow(/at least one field/);
  });

  it("round-trips encode/decode for legacy snake keys", () => {
    const wire = { image_tag: "hero-shot", is_ad: true };
    const camel = decodeWire(wire) as { imageTag: string; isAd: boolean };
    expect(camel).toEqual({ imageTag: "hero-shot", isAd: true });
    expect(encodeWire(camel)).toEqual({ image_tag: "hero-shot", is_ad: true });
  });
});
