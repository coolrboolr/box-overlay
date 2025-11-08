import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const RegistrySchema = z.object({
  origins: z.array(z.string())
});

export class DevExtensionRegistry {
  private readonly filePath?: string;
  private readonly origins = new Set<string>();

  constructor(options: { filePath?: string }) {
    this.filePath = options.filePath;
  }

  private persistenceWarningLogged = false;

  async load(): Promise<void> {
    if (!this.filePath) {
      this.logPersistenceWarning();
      return;
    }

    try {
      const data = await fs.readFile(this.filePath, "utf8");
      const parsed = RegistrySchema.parse(JSON.parse(data));
      parsed.origins.forEach((origin) => {
        this.origins.add(origin);
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      console.warn("[server] failed to load dev extension registry", error);
    }
  }

  getAll(): string[] {
    return Array.from(this.origins);
  }

  has(origin: string): boolean {
    return this.origins.has(origin);
  }

  async add(origin: string): Promise<boolean> {
    if (this.origins.has(origin)) {
      return false;
    }
    this.origins.add(origin);
    await this.persist();
    return true;
  }

  async clear(): Promise<void> {
    this.origins.clear();
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (!this.filePath) {
      this.logPersistenceWarning();
      return;
    }

    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    const payload = JSON.stringify({ origins: this.getAll() }, null, 2);
    const tempFile = path.join(dir, `.dev-extension-origins.tmp-${process.pid}-${Date.now()}`);

    await fs.writeFile(tempFile, payload, "utf8");
    await fs.rename(tempFile, this.filePath);
  }

  private logPersistenceWarning(): void {
    if (this.persistenceWarningLogged) {
      return;
    }
    this.persistenceWarningLogged = true;
    console.warn(
      "[server] dev extension registry persistence disabled (DEV_EXTENSION_REGISTRY_FILE not set)"
    );
  }
}
