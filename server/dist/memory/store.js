"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryStore = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const schema_1 = require("../schema");
const schema_2 = require("../schema");
const _2025_11_ontology_1 = require("../migrations/2025-11-ontology");
const embedding_1 = require("../services/embedding");
class MemoryStore {
    constructor(options) {
        this.loadPromise = null;
        this.queue = Promise.resolve();
        this.records = [];
        this.vectorLength = null;
        this.lastFileSizeBytes = 0;
        this.compactions = 0;
        this.dbPath = options.dbPath;
        this.dedupThreshold = options.dedupThreshold;
        this.dedupKey = options.dedupKey;
        this.maxCharsPerChunk = options.maxCharsPerChunk;
        this.embedModelVersion = options.embedModelVersion;
        this.allowModelMismatch = Boolean(options.allowModelMismatch);
        this.embedText = options.embed ?? embedding_1.generateEmbedding;
    }
    async load() {
        if (!this.loadPromise) {
            this.loadPromise = this.initializeFromDisk();
        }
        return this.loadPromise;
    }
    async ingest(items) {
        await this.load();
        return this.enqueue(async () => {
            const results = [];
            let indexed = 0;
            let duplicate = 0;
            let failed = 0;
            for (const item of items) {
                try {
                    const processed = await this.processItem(item);
                    if (processed.stored.length > 0) {
                        indexed += 1;
                        results.push(schema_1.MemoryIndexResultSchema.parse({
                            id: item.id,
                            status: "indexed",
                            storedIds: processed.stored.map((record) => record.id)
                        }));
                    }
                    else {
                        duplicate += 1;
                        results.push(schema_1.MemoryIndexResultSchema.parse({
                            id: item.id,
                            status: "duplicate",
                            message: processed.reason ?? "No unique chunks",
                            duplicateOf: processed.duplicateOf
                        }));
                    }
                }
                catch (error) {
                    failed += 1;
                    results.push(schema_1.MemoryIndexResultSchema.parse({
                        id: item.id,
                        status: "failed",
                        message: error instanceof Error ? error.message : String(error)
                    }));
                }
            }
            if (indexed > 0) {
                await this.persist();
            }
            return {
                schemaVersion: schema_1.MEMORY_SCHEMA_VERSION,
                counts: { indexed, duplicate, failed },
                results
            };
        });
    }
    async stats() {
        await this.load();
        return {
            schemaVersion: schema_1.MEMORY_SCHEMA_VERSION,
            items: this.records.length,
            vectors: this.records.length,
            fileSizeBytes: this.lastFileSizeBytes,
            lastPersistedAt: this.lastPersistedAt,
            embedModelVersion: this.embedModelVersion,
            embedDimensions: this.vectorLength ?? 0,
            compactions: this.compactions
        };
    }
    async search(options) {
        await this.load();
        const { vector, topK, domain, domains, since, until, entityTypes, conceptIds } = options;
        const sinceDate = since ? Date.parse(since) : null;
        const untilDate = until ? Date.parse(until) : null;
        const domainHosts = buildDomainSet([domain, ...(domains ?? [])].filter(Boolean));
        const conceptFilter = conceptIds ? new Set(conceptIds) : null;
        const entityFilter = entityTypes ? new Set(entityTypes) : null;
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
            similarity: (0, embedding_1.cosineSimilarity)(vector, record.vector)
        }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
        return scored.map(({ record, similarity }) => schema_1.MemoryQueryHitSchema.parse({
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
            sourceDomain: record.sourceDomain ?? undefined,
            similarity,
            duplicateOf: record.duplicateOf
        }));
    }
    async mutateItem(recordId, mutation) {
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
                    record.tags = Array.from(new Set(mutation.tags));
                }
            }
            await this.persist();
            const refreshed = siblings.find((record) => record.id === recordId) ?? target;
            return schema_1.MemoryQueryHitSchema.parse({
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
                sourceDomain: refreshed.sourceDomain ?? undefined,
                similarity: 1
            });
        });
    }
    async compact() {
        await this.load();
        return this.enqueue(async () => {
            this.records = this.records.filter((record) => !record.duplicateOf);
            this.compactions += 1;
            await this.persist();
        });
    }
    async initializeFromDisk() {
        await promises_1.default.mkdir(node_path_1.default.dirname(this.dbPath), { recursive: true });
        try {
            const raw = await promises_1.default.readFile(this.dbPath, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed.schemaVersion !== schema_1.MEMORY_SCHEMA_VERSION) {
                await this.backupExisting();
                this.records = [];
                this.vectorLength = null;
                this.lastPersistedAt = undefined;
                this.lastFileSizeBytes = 0;
                this.compactions = 0;
                return;
            }
            if (!parsed.embedModelVersion) {
                const migrated = (0, _2025_11_ontology_1.migrateLegacyMemoryFile)(parsed, {
                    embedModelVersion: this.embedModelVersion,
                    dedupKey: this.dedupKey
                });
                await promises_1.default.writeFile(this.dbPath, JSON.stringify(migrated), "utf8");
                return this.initializeFromDisk();
            }
            if (parsed.embedModelVersion !== this.embedModelVersion &&
                !this.allowModelMismatch) {
                throw new Error(`Embedding model mismatch: store=${parsed.embedModelVersion}, runtime=${this.embedModelVersion}`);
            }
            this.vectorLength = parsed.vectorLength || null;
            this.records = parsed.items.map((item) => ({
                ...item,
                vector: Float32Array.from(item.vector)
            }));
            this.lastPersistedAt = parsed.updatedAt;
            this.compactions = parsed.compactions ?? 0;
            const stats = await promises_1.default.stat(this.dbPath);
            this.lastFileSizeBytes = stats.size;
        }
        catch (error) {
            if (error.code === "ENOENT") {
                this.records = [];
                this.vectorLength = null;
                this.lastFileSizeBytes = 0;
                this.compactions = 0;
                return;
            }
            throw error;
        }
    }
    async processItem(item) {
        const textChunks = chunkText(item.text, this.maxCharsPerChunk);
        const stored = [];
        let duplicateOf;
        const parentId = item.parentId ?? item.id;
        const sourceDomain = item.sourceDomain ?? (item.url ? safeHostname(item.url) : null);
        const entityMeta = (0, schema_2.normalizeEntity)({ url: item.url, title: item.title, text: item.text });
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
            const record = {
                id: node_crypto_1.default.randomUUID(),
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
                tags: item.tags ?? [],
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
    ensureVectorDimension(length) {
        if (this.vectorLength === null) {
            this.vectorLength = length;
            return;
        }
        if (this.vectorLength !== length) {
            throw new Error(`Embedding dimension mismatch: expected ${this.vectorLength}, received ${length}`);
        }
    }
    findDuplicate(options) {
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
            const similarity = (0, embedding_1.cosineSimilarity)(options.vector, record.vector);
            if (similarity >= this.dedupThreshold) {
                return record;
            }
        }
        return null;
    }
    async persist() {
        const payload = {
            schemaVersion: schema_1.MEMORY_SCHEMA_VERSION,
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
        await promises_1.default.mkdir(node_path_1.default.dirname(this.dbPath), { recursive: true });
        await promises_1.default.writeFile(tempPath, JSON.stringify(payload));
        await promises_1.default.rename(tempPath, this.dbPath);
        this.lastPersistedAt = payload.updatedAt;
        const stats = await promises_1.default.stat(this.dbPath);
        this.lastFileSizeBytes = stats.size;
    }
    enqueue(task) {
        const result = this.queue.then(task);
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }
    async backupExisting() {
        try {
            const backupPath = `${this.dbPath}.bak-${Date.now()}`;
            await promises_1.default.copyFile(this.dbPath, backupPath);
            console.warn(`[memory] schema mismatch detected. Backed up store to ${backupPath}`);
        }
        catch (error) {
            console.warn("[memory] failed to backup legacy memory store", error);
        }
        await promises_1.default.rm(this.dbPath, { force: true });
    }
}
exports.MemoryStore = MemoryStore;
function chunkText(text, maxChars) {
    const normalized = text.trim();
    if (!normalized) {
        return [];
    }
    if (normalized.length <= maxChars) {
        return [normalized];
    }
    const sentences = normalized.split(/(?<=[.!?])\s+/);
    const chunks = [];
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
        }
        else {
            buffer = sentence;
        }
    }
    if (buffer) {
        flush();
    }
    return chunks;
}
function createSnippet(text, maxLength = 280) {
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength).trim()}...`;
}
function safeHostname(input) {
    try {
        const normalized = input.includes("://") ? input : `https://${input}`;
        const url = new URL(normalized);
        return url.hostname.toLowerCase();
    }
    catch {
        return null;
    }
}
function canonicalUrl(input) {
    if (!input) {
        return undefined;
    }
    try {
        const url = new URL(input);
        url.hash = "";
        url.search = "";
        return url.toString();
    }
    catch {
        return undefined;
    }
}
function computeContentHash(text, url, entityType) {
    const hash = node_crypto_1.default.createHash("sha256");
    hash.update(text.trim());
    hash.update("::");
    hash.update(url ?? "");
    hash.update("::");
    hash.update(entityType ?? "");
    return hash.digest("hex");
}
function buildDomainSet(domains) {
    const set = new Set();
    domains.forEach((value) => {
        const host = safeHostname(value);
        if (host) {
            set.add(host);
        }
    });
    return set;
}
//# sourceMappingURL=store.js.map