import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DevExtensionRegistry } from "../utils/devExtensionRegistry";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("DevExtensionRegistry", () => {
  it("persists unique origins and reloads them", async () => {
    const registryPath = await createTempFilePath();
    const registry = new DevExtensionRegistry({ filePath: registryPath });

    await registry.load();
    await registry.add("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    await registry.add("chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    await registry.add("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    const reload = new DevExtensionRegistry({ filePath: registryPath });
    await reload.load();

    expect(reload.getAll()).toEqual([
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    ]);
  });

  it("clears persisted origins", async () => {
    const registryPath = await createTempFilePath();
    const registry = new DevExtensionRegistry({ filePath: registryPath });
    await registry.add("chrome-extension://cccccccccccccccccccccccccccccccc");

    await registry.clear();

    const contents = await fs.readFile(registryPath, "utf8");
    expect(JSON.parse(contents)).toEqual({ origins: [] });
  });
});

async function createTempFilePath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-registry-"));
  tempDirs.push(dir);
  return path.join(dir, "origins.json");
}
