import crypto from "node:crypto";

import { MEMORY_SCHEMA_VERSION } from "../schema";
import { DedupStrategy } from "../memory/types";
import type { PersistenceFile } from "../memory/store";

interface LegacyPersistenceRecord {
  id: string;
  parentId: string;
  sourceId?: string;
  text: string;
  snippet?: string;
  vector: number[];
  url?: string;
  title?: string;
  contentType?: string;
  capturedAt?: string;
  language?: string;
  imageTag?: string;
  imageData?: string;
  createdAt: string;
}

interface LegacyPersistenceFile {
  schemaVersion: number;
  updatedAt: string;
  vectorLength: number;
  items: LegacyPersistenceRecord[];
}

interface MigrationOptions {
  embedModelVersion: string;
  dedupKey: DedupStrategy;
}

export function migrateLegacyMemoryFile(
  legacy: LegacyPersistenceFile,
  options: MigrationOptions
): PersistenceFile {
  const migratedItems = legacy.items.map((item) => ({
    id: item.id,
    parentId: item.parentId,
    sourceId: item.sourceId,
    text: item.text,
    snippet: createSnippet(item.snippet ?? item.text),
    vector: item.vector,
    contentHash: computeContentHash(item.text, item.url, "unknown"),
    duplicateOf: undefined,
    url: item.url,
    sourceDomain: item.url ? safeHostname(item.url) : null,
    title: item.title,
    contentType: item.contentType,
    capturedAt: item.capturedAt,
    language: item.language,
    entityType: "unknown",
    conceptIds: [],
    relations: [],
    tags: [],
    image: normalizeLegacyImage(item),
    createdAt: item.createdAt,
    embedModelVersion: options.embedModelVersion,
    embedDimensions: legacy.vectorLength
  }));

  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    vectorLength: legacy.vectorLength,
    embedModelVersion: options.embedModelVersion,
    dedupKey: options.dedupKey,
    compactions: 0,
    items: migratedItems
  };
}

function normalizeLegacyImage(
  item: LegacyPersistenceRecord
): PersistenceFile["items"][number]["image"] {
  if (item.imageTag) {
    return { kind: "tag", tag: item.imageTag };
  }
  if (item.imageData) {
    const dataUri = item.imageData.startsWith("data:")
      ? item.imageData
      : `data:image/png;base64,${item.imageData}`;
    return { kind: "dataUri", data: dataUri };
  }
  return undefined;
}

function safeHostname(input: string | undefined): string | null {
  if (!input) {
    return null;
  }
  try {
    const normalized = input.includes("://") ? input : `https://${input}`;
    const url = new URL(normalized);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function createSnippet(text: string, maxLength = 280): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trim()}...`;
}

function computeContentHash(text: string, url?: string, entityType?: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(text.trim());
  hash.update("::");
  hash.update(url ?? "");
  hash.update("::");
  hash.update(entityType ?? "");
  return hash.digest("hex");
}
