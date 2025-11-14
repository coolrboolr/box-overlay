import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  MEMORY_SCHEMA_VERSION,
  MemoryIndexItem,
  MemoryIndexResultSchema,
  MemoryQueryHitSchema,
  type MemoryIndexResponse,
  type MemoryQueryHit,
  type MemoryStatsResponse
} from "../schema";
import { cosineSimilarity, generateEmbedding, type EmbeddingGenerator } from "../services/embedding";

interface MemoryStoreOptions {
  dbPath: string;
  dedupThreshold: number;
  maxCharsPerChunk: number;
  embed?: EmbeddingGenerator;
}

interface StoredRecord {
  id: string;
  parentId: string;
  sourceId?: string;
  text: string;
  snippet: string;
  vector: Float32Array;
  url?: string;
  title?: string;
  contentType?: string;
  capturedAt?: string;
  language?: string;
  imageTag?: string;
  createdAt: string;
}

interface PersistenceRecord extends Omit<StoredRecord, "vector"> {
  vector: number[];
}

interface PersistenceFile {
  schemaVersion: number;
  updatedAt: string;
  vectorLength: number;
  items: PersistenceRecord[];
}

export interface MemorySearchOptions {
  vector: Float32Array;
  topK: number;
  domain?: string;
  since?: string;
  until?: string;
}

export class MemoryStore {
  private readonly dbPath: string;
  private readonly dedupThreshold: number;
  private readonly maxCharsPerChunk: number;
  private readonly embedText: EmbeddingGenerator;
  private loadPromise: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private records: StoredRecord[] = [];
  private vectorLength: number | null = null;
  private lastPersistedAt?: string;
  private lastFileSizeBytes = 0;

  constructor(options: MemoryStoreOptions) {
    this.dbPath = options.dbPath;
    this.dedupThreshold = options.dedupThreshold;
    this.maxCharsPerChunk = options.maxCharsPerChunk;
    this.embedText = options.embed ?? generateEmbedding;
  }

  async load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.initializeFromDisk();
    }
    return this.loadPromise;
  }

  async ingest(items: MemoryIndexItem[]): Promise<MemoryIndexResponse> {
    await this.load();
    return this.enqueue(async () => {
      const results: ReturnType<typeof MemoryIndexResultSchema.parse>[] = [];
      let indexed = 0;
      let duplicate = 0;
      let failed = 0;

      for (const item of items) {
        try {
          const stored = await this.processItem(item);
          if (stored.length > 0) {
            indexed += 1;
            results.push(
              MemoryIndexResultSchema.parse({
                id: item.id,
                status: "indexed",
                storedIds: stored.map((record) => record.id)
              })
            );
          } else {
            duplicate += 1;
            results.push(
              MemoryIndexResultSchema.parse({
                id: item.id,
                status: "duplicate",
                message: "No unique chunks"
              })
            );
          }
        } catch (error) {
          failed += 1;
          results.push(
            MemoryIndexResultSchema.parse({
              id: item.id,
              status: "failed",
              message: error instanceof Error ? error.message : String(error)
            })
          );
        }
      }

      if (indexed > 0) {
        await this.persist();
      }

      return {
        schemaVersion: MEMORY_SCHEMA_VERSION,
        counts: { indexed, duplicate, failed },
        results
      };
    });
  }

  async stats(): Promise<MemoryStatsResponse> {
    await this.load();
    return {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      items: this.records.length,
      vectors: this.records.length,
      fileSizeBytes: this.lastFileSizeBytes,
      lastPersistedAt: this.lastPersistedAt
    };
  }

  async search(options: MemorySearchOptions): Promise<MemoryQueryHit[]> {
    await this.load();
    const { vector, topK, domain, since, until } = options;

    const sinceDate = since ? Date.parse(since) : null;
    const untilDate = until ? Date.parse(until) : null;
    const domainHost = domain ? safeHostname(domain) : null;

    const scored = this.records
      .filter((record) => {
        if (domainHost && record.url) {
          const recordHost = safeHostname(record.url);
          if (recordHost !== domainHost) {
            return false;
          }
        }
        if (sinceDate && record.capturedAt && Date.parse(record.capturedAt) < sinceDate) {
          return false;
        }
        if (untilDate && record.capturedAt && Date.parse(record.capturedAt) > untilDate) {
          return false;
        }
        return true;
      })
      .map((record) => ({
        record,
        similarity: cosineSimilarity(vector, record.vector)
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    return scored.map(({ record, similarity }) =>
      MemoryQueryHitSchema.parse({
        id: record.id,
        parentId: record.parentId,
        sourceId: record.sourceId,
        url: record.url,
        title: record.title,
        snippet: record.snippet,
        capturedAt: record.capturedAt,
        contentType: record.contentType,
        language: record.language,
        similarity
      })
    );
  }

  private async initializeFromDisk(): Promise<void> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    try {
      const raw = await fs.readFile(this.dbPath, "utf8");
      const parsed = JSON.parse(raw) as PersistenceFile;
      if (parsed.schemaVersion !== MEMORY_SCHEMA_VERSION) {
        await this.backupExisting();
        this.records = [];
        this.vectorLength = null;
        this.lastPersistedAt = undefined;
        this.lastFileSizeBytes = 0;
        return;
      }
      this.vectorLength = parsed.vectorLength || null;
      this.records = parsed.items.map((item) => ({
        ...item,
        vector: Float32Array.from(item.vector)
      }));
      this.lastPersistedAt = parsed.updatedAt;
      const stats = await fs.stat(this.dbPath);
      this.lastFileSizeBytes = stats.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.records = [];
        this.vectorLength = null;
        this.lastFileSizeBytes = 0;
        return;
      }
      throw error;
    }
  }

  private async processItem(item: MemoryIndexItem): Promise<StoredRecord[]> {
    const textChunks = chunkText(item.text, this.maxCharsPerChunk);
    const stored: StoredRecord[] = [];

    for (const chunk of textChunks) {
      const vector = await this.embedText(chunk);
      this.ensureVectorDimension(vector.length);
      if (this.isDuplicate(vector, item.sourceId)) {
        continue;
      }

      const record: StoredRecord = {
        id: crypto.randomUUID(),
        parentId: item.id,
        sourceId: item.sourceId,
        text: chunk,
        snippet: createSnippet(chunk),
        vector,
        url: item.url,
        title: item.title,
        contentType: item.contentType,
        capturedAt: item.capturedAt,
        language: item.language,
        imageTag: item.imageTag,
        createdAt: new Date().toISOString()
      };

      this.records.push(record);
      stored.push(record);
    }

    return stored;
  }

  private ensureVectorDimension(length: number): void {
    if (this.vectorLength === null) {
      this.vectorLength = length;
      return;
    }
    if (this.vectorLength !== length) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.vectorLength}, received ${length}`
      );
    }
  }

  private isDuplicate(vector: Float32Array, sourceId?: string): boolean {
    for (const record of this.records) {
      if (sourceId && record.sourceId && record.sourceId === sourceId) {
        return true;
      }
      const similarity = cosineSimilarity(vector, record.vector);
      if (similarity >= this.dedupThreshold) {
        return true;
      }
    }
    return false;
  }

  private async persist(): Promise<void> {
    const payload: PersistenceFile = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      vectorLength: this.vectorLength ?? 0,
      items: this.records.map((record) => ({
        ...record,
        vector: Array.from(record.vector)
      }))
    };

    const tempPath = `${this.dbPath}.tmp`;
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    await fs.writeFile(tempPath, JSON.stringify(payload));
    await fs.rename(tempPath, this.dbPath);
    this.lastPersistedAt = payload.updatedAt;
    const stats = await fs.stat(this.dbPath);
    this.lastFileSizeBytes = stats.size;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async backupExisting(): Promise<void> {
    try {
      const backupPath = `${this.dbPath}.bak-${Date.now()}`;
      await fs.copyFile(this.dbPath, backupPath);
      console.warn(`[memory] schema mismatch detected. Backed up store to ${backupPath}`);
    } catch (error) {
      console.warn("[memory] failed to backup legacy memory store", error);
    }
    await fs.rm(this.dbPath, { force: true });
  }
}

function chunkText(text: string, maxChars: number): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }
  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const sentences = normalized.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer.trim()) {
      chunks.push(buffer.trim());
    }
    buffer = "";
  };

  for (const sentence of sentences) {
    const candidate = buffer ? `${buffer} ${sentence}`.trim() : sentence.trim();
    if (candidate.length <= maxChars) {
      buffer = candidate;
      continue;
    }
    if (buffer) {
      flush();
    }
    if (sentence.length > maxChars) {
      const parts = sentence.match(new RegExp(`.{1,${maxChars}}`, "g")) ?? [];
      chunks.push(...parts.map((part) => part.trim()));
      buffer = "";
    } else {
      buffer = sentence;
    }
  }

  if (buffer) {
    flush();
  }

  return chunks;
}

function createSnippet(text: string, maxLength = 280): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trim()}...`;
}

function safeHostname(input: string): string | null {
  try {
    const normalized = input.includes("://") ? input : `https://${input}`;
    const url = new URL(normalized);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}
