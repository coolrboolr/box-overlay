import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  MEMORY_SCHEMA_VERSION,
  MemoryIndexItem,
  MemoryIndexResultSchema,
  MemoryMutation,
  MemoryQueryHitSchema,
  type MemoryIndexResponse,
  type MemoryQueryHit,
  type MemoryStatsResponse
} from "../schema";
import { normalizeEntity } from "../schema";
import { migrateLegacyMemoryFile } from "../migrations/2025-11-ontology";
import { DedupStrategy } from "./types";
import { cosineSimilarity, generateEmbedding, type EmbeddingGenerator } from "../services/embedding";

interface MemoryStoreOptions {
  dbPath: string;
  dedupThreshold: number;
  dedupKey: DedupStrategy;
  maxCharsPerChunk: number;
  embedModelVersion: string;
  allowModelMismatch?: boolean;
  embed?: EmbeddingGenerator;
  compactInterval?: number;
}

interface StoredRelation {
  type: string;
  targetId: string;
}

interface StoredRecord {
  id: string;
  parentId: string;
  sourceId?: string;
  text: string;
  snippet: string;
  vector: Float32Array;
  contentHash: string;
  duplicateOf?: string;
  url?: string;
  sourceDomain?: string | null;
  title?: string;
  contentType?: string;
  capturedAt?: string;
  language?: string;
  entityType: string;
  conceptIds: string[];
  relations: StoredRelation[];
  tags: string[];
  userNote?: string;
  updatedAt?: string;
  image?: MemoryIndexItem["image"];
  createdAt: string;
  embedModelVersion: string;
  embedDimensions: number;
}

export interface PersistenceRecord extends Omit<StoredRecord, "vector"> {
  vector: number[];
}

export interface PersistenceFile {
  schemaVersion: number;
  updatedAt: string;
  vectorLength: number;
  embedModelVersion: string;
  dedupKey: DedupStrategy;
  compactions: number;
  items: PersistenceRecord[];
}

export type MemoryExportItem = Omit<PersistenceRecord, "vector" | "contentHash">;

export interface MemorySearchOptions {
  vector: Float32Array;
  topK: number;
  domain?: string;
  domains?: string[];
  since?: string;
  until?: string;
  entityTypes?: string[];
  conceptIds?: string[];
  tags?: string[];
}

export class MemoryStore {
  private readonly dbPath: string;
  private readonly dedupThreshold: number;
  private readonly dedupKey: DedupStrategy;
  private readonly maxCharsPerChunk: number;
  private readonly embedModelVersion: string;
  private readonly allowModelMismatch: boolean;
  private readonly embedText: EmbeddingGenerator;
  private readonly compactInterval: number;
  private loadPromise: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private records: StoredRecord[] = [];
  private vectorLength: number | null = null;
  private lastPersistedAt?: string;
  private lastFileSizeBytes = 0;
  private compactions = 0;
  private ingestsSinceCompaction = 0;

  constructor(options: MemoryStoreOptions) {
    this.dbPath = options.dbPath;
    this.dedupThreshold = options.dedupThreshold;
    this.dedupKey = options.dedupKey;
    this.maxCharsPerChunk = options.maxCharsPerChunk;
    this.embedModelVersion = options.embedModelVersion;
    this.allowModelMismatch = Boolean(options.allowModelMismatch);
    this.embedText = options.embed ?? generateEmbedding;
    this.compactInterval = Math.max(0, options.compactInterval ?? 0);
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
          const processed = await this.processItem(item);
          if (processed.stored.length > 0) {
            indexed += 1;
            results.push(
              MemoryIndexResultSchema.parse({
                id: item.id,
                status: "indexed",
                storedIds: processed.stored.map((record) => record.id)
              })
            );
          } else {
            duplicate += 1;
            results.push(
              MemoryIndexResultSchema.parse({
                id: item.id,
                status: "duplicate",
                message: processed.reason ?? "No unique chunks",
                duplicateOf: processed.duplicateOf
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
        this.ingestsSinceCompaction += indexed;
        if (this.compactInterval > 0 && this.ingestsSinceCompaction >= this.compactInterval) {
          await this.performCompaction();
          this.ingestsSinceCompaction = 0;
        }
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
    const { counts: tagCounts, taggedItems } = this.buildTagCounts();
    return {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      items: this.records.length,
      vectors: this.records.length,
      fileSizeBytes: this.lastFileSizeBytes,
      lastPersistedAt: this.lastPersistedAt,
      embedModelVersion: this.embedModelVersion,
      embedDimensions: this.vectorLength ?? 0,
      compactions: this.compactions,
      tagCounts,
      taggedItems
    };
  }

  async search(options: MemorySearchOptions): Promise<MemoryQueryHit[]> {
    await this.load();
    const { vector, topK, domain, domains, since, until, entityTypes, conceptIds, tags } = options;

    const sinceDate = since ? Date.parse(since) : null;
    const untilDate = until ? Date.parse(until) : null;
    const domainHosts = buildDomainSet([domain, ...(domains ?? [])].filter(Boolean) as string[]);
    const conceptFilter = conceptIds ? new Set(conceptIds) : null;
    const entityFilter = entityTypes ? new Set(entityTypes) : null;

    const tagFilter = tags ? new Set(tags.map((value) => value.toLowerCase())) : null;

    const scored = this.records
      .filter((record) => {
        if (domainHosts.size > 0) {
          const recordHost = record.sourceDomain ?? (record.url ? safeHostname(record.url) : null);
          if (!recordHost || !domainHosts.has(recordHost)) {
            return false;
          }
        }
        if (entityFilter && !entityFilter.has(record.entityType)) {
          return false;
        }
        if (conceptFilter && !record.conceptIds.some((id) => conceptFilter.has(id))) {
          return false;
        }
        if (tagFilter && !record.tags.some((tag) => tagFilter.has(tag))) {
          return false;
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
        entityType: record.entityType,
        conceptIds: record.conceptIds,
        relations: record.relations,
        tags: record.tags,
        userNote: record.userNote,
        updatedAt: record.updatedAt,
        sourceDomain: record.sourceDomain ?? undefined,
        similarity,
        duplicateOf: record.duplicateOf
      })
    );
  }

  async mutateItem(recordId: string, mutation: MemoryMutation): Promise<MemoryQueryHit | null> {
    await this.load();
    return this.enqueue(async () => {
      const target = this.records.find((record) => record.id === recordId);
      if (!target) {
        return null;
      }

      const siblings = this.records.filter((record) => record.parentId === target.parentId);
      for (const record of siblings) {
        if (mutation.entityType) {
          record.entityType = mutation.entityType;
        }
        if (mutation.relations) {
          record.relations = mutation.relations;
        }
        if (mutation.conceptIds) {
          record.conceptIds = Array.from(new Set(mutation.conceptIds));
        }
        if (mutation.tags) {
          record.tags = Array.from(new Set(mutation.tags.map((tag) => tag.toLowerCase())));
        }
        if (mutation.userNote !== undefined) {
          record.userNote = mutation.userNote?.trim() || undefined;
        }
        record.updatedAt = new Date().toISOString();
      }

      await this.persist();
      const refreshed = siblings.find((record) => record.id === recordId) ?? target;
      return MemoryQueryHitSchema.parse({
        id: refreshed.id,
        parentId: refreshed.parentId,
        sourceId: refreshed.sourceId,
        url: refreshed.url,
        title: refreshed.title,
        snippet: refreshed.snippet,
        capturedAt: refreshed.capturedAt,
        contentType: refreshed.contentType,
        language: refreshed.language,
        entityType: refreshed.entityType,
        conceptIds: refreshed.conceptIds,
        relations: refreshed.relations,
        tags: refreshed.tags,
        userNote: refreshed.userNote,
        updatedAt: refreshed.updatedAt,
        sourceDomain: refreshed.sourceDomain ?? undefined,
        similarity: 1
      });
    });
  }

  async compact(): Promise<void> {
    await this.load();
    return this.enqueue(async () => {
      await this.performCompaction();
    });
  }

  async clear(): Promise<void> {
    await this.load();
    return this.enqueue(async () => {
      this.records = [];
      this.vectorLength = null;
      this.lastPersistedAt = undefined;
      this.lastFileSizeBytes = 0;
      this.compactions = 0;
      this.ingestsSinceCompaction = 0;
      await fs.rm(this.dbPath, { force: true });
    });
  }

  async export(): Promise<{ schemaVersion: number; exportedAt: string; items: MemoryExportItem[] }> {
    await this.load();
    const items: MemoryExportItem[] = this.records.map(({ vector: _vector, contentHash: _hash, ...rest }) => ({
      ...rest
    }));

    return {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      items
    };
  }

  private async initializeFromDisk(): Promise<void> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    try {
      const raw = await fs.readFile(this.dbPath, "utf8");
      const parsed = JSON.parse(raw) as PersistenceFile;
      if (parsed.schemaVersion !== MEMORY_SCHEMA_VERSION) {
        const migrated = this.migrateLegacyFile(parsed);
        if (migrated) {
          await fs.writeFile(this.dbPath, JSON.stringify(migrated), "utf8");
          return this.initializeFromDisk();
        }
        await this.backupExisting();
        console.error(
          `[memory] incompatible schema detected in ${this.dbPath}; expected ${MEMORY_SCHEMA_VERSION}, found ${parsed.schemaVersion}`
        );
        throw new Error("Memory store schema mismatch detected; aborting startup");
      }

      if (!parsed.embedModelVersion) {
        const migrated = migrateLegacyMemoryFile(parsed, {
          embedModelVersion: this.embedModelVersion,
          dedupKey: this.dedupKey
        });
        await fs.writeFile(this.dbPath, JSON.stringify(migrated), "utf8");
        return this.initializeFromDisk();
      }

      if (
        parsed.embedModelVersion !== this.embedModelVersion &&
        !this.allowModelMismatch
      ) {
        throw new Error(
          `Embedding model mismatch: store=${parsed.embedModelVersion}, runtime=${this.embedModelVersion}`
        );
      }

      this.vectorLength = parsed.vectorLength || null;
      this.records = parsed.items.map((item) => ({
        ...item,
        vector: Float32Array.from(item.vector)
      }));
      this.lastPersistedAt = parsed.updatedAt;
      this.compactions = parsed.compactions ?? 0;
      this.ingestsSinceCompaction = 0;
      const stats = await fs.stat(this.dbPath);
      this.lastFileSizeBytes = stats.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.records = [];
        this.vectorLength = null;
        this.lastFileSizeBytes = 0;
        this.compactions = 0;
        this.ingestsSinceCompaction = 0;
        return;
      }
      throw error;
    }
  }

  private async processItem(
    item: MemoryIndexItem
  ): Promise<{ stored: StoredRecord[]; duplicateOf?: string; reason?: string }> {
    const textChunks = chunkText(item.text, this.maxCharsPerChunk);
    const stored: StoredRecord[] = [];
    let duplicateOf: string | undefined;

    const parentId = item.parentId ?? item.id;
    const sourceDomain = item.sourceDomain ?? (item.url ? safeHostname(item.url) : null);
    const entityMeta = normalizeEntity({ url: item.url, title: item.title, text: item.text });

    for (const chunk of textChunks) {
      const vector = await this.embedText(chunk);
      this.ensureVectorDimension(vector.length);
      const entityType = item.entityType ?? entityMeta.entityType;
      const conceptIds = item.conceptIds ?? entityMeta.conceptIds;
      const contentHash = computeContentHash(chunk, item.url, entityType);
      const duplicateRecord = this.findDuplicate({
        vector,
        sourceId: item.sourceId,
        url: item.url,
        contentHash
      });

      if (duplicateRecord) {
        duplicateOf = duplicateRecord.parentId ?? duplicateRecord.id;
        continue;
      }

      const record: StoredRecord = {
        id: crypto.randomUUID(),
        parentId,
        sourceId: item.sourceId,
        text: chunk,
        snippet: createSnippet(chunk),
        vector,
        contentHash,
        url: item.url,
        sourceDomain,
        title: item.title,
        contentType: item.contentType,
        capturedAt: item.capturedAt,
        language: item.language,
        entityType,
        conceptIds,
        relations: item.relations ?? [],
        tags: dedupeTags(item.tags ?? []),
        userNote: item.userNote?.trim() || undefined,
        updatedAt: item.updatedAt ?? new Date().toISOString(),
        image: item.image,
        createdAt: new Date().toISOString(),
        embedModelVersion: this.embedModelVersion,
        embedDimensions: vector.length
      };

      this.records.push(record);
      stored.push(record);
    }

    return stored.length > 0
      ? { stored }
      : { stored, duplicateOf, reason: duplicateOf ? "duplicate" : "No novel chunks" };
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

  private findDuplicate(options: {
    vector: Float32Array;
    sourceId?: string;
    url?: string;
    contentHash: string;
  }): StoredRecord | null {
    const normalizedUrl = options.url ? canonicalUrl(options.url) : undefined;
    if (this.dedupKey === "hash") {
      const byHash = this.records.find((record) => record.contentHash === options.contentHash);
      if (byHash) {
        return byHash;
      }
    }
    if (this.dedupKey === "url" && normalizedUrl) {
      const byUrl = this.records.find((record) => canonicalUrl(record.url ?? "") === normalizedUrl);
      if (byUrl) {
        return byUrl;
      }
    }
    if (options.sourceId) {
      const bySource = this.records.find((record) => record.sourceId === options.sourceId);
      if (bySource) {
        return bySource;
      }
    }
    for (const record of this.records) {
      const similarity = cosineSimilarity(options.vector, record.vector);
      if (similarity >= this.dedupThreshold) {
        return record;
      }
    }
    return null;
  }

  private async persist(): Promise<void> {
    const payload: PersistenceFile = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      vectorLength: this.vectorLength ?? 0,
      embedModelVersion: this.embedModelVersion,
      dedupKey: this.dedupKey,
      compactions: this.compactions,
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

  private migrateLegacyFile(file: PersistenceFile): PersistenceFile | null {
    if (file.schemaVersion === 1) {
      return {
        ...file,
        schemaVersion: MEMORY_SCHEMA_VERSION,
        items: file.items.map((item) => ({
          ...item,
          userNote: item.userNote ?? undefined,
          tags: dedupeTags((item as PersistenceRecord & { tags?: string[] }).tags ?? []),
          updatedAt: item.updatedAt ?? item.capturedAt ?? item.createdAt
        }))
      };
    }
    return null;
  }

  private async performCompaction(): Promise<void> {
    this.records = this.records.filter((record) => !record.duplicateOf);
    this.compactions += 1;
    await this.persist();
  }

  private buildTagCounts(): { counts: Record<string, number>; taggedItems: number } {
    const counts: Record<string, number> = {};
    let taggedItems = 0;
    for (const record of this.records) {
      if (record.tags?.length) {
        taggedItems += 1;
      }
      for (const tag of record.tags ?? []) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return { counts, taggedItems };
  }
}

function dedupeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.toLowerCase())));
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

function canonicalUrl(input: string): string | undefined {
  if (!input) {
    return undefined;
  }
  try {
    const url = new URL(input);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return undefined;
  }
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

function buildDomainSet(domains: string[]): Set<string> {
  const set = new Set<string>();
  domains.forEach((value) => {
    const host = safeHostname(value);
    if (host) {
      set.add(host);
    }
  });
  return set;
}
