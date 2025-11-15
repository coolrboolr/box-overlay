import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MEMORY_SCHEMA_VERSION as serverMemoryVersion } from "../schema";

describe("schema version alignment", () => {
  it("keeps extension and server memory schemas in sync", () => {
    const extensionFile = path.resolve(__dirname, "../../../extension/src/types/messages.ts");
    const contents = fs.readFileSync(extensionFile, "utf8");
    const match = contents.match(/MEMORY_SCHEMA_VERSION\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const extensionMemoryVersion = match ? Number(match[1]) : NaN;
    expect(extensionMemoryVersion).toBe(serverMemoryVersion);
  });
});
