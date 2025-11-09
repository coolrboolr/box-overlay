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
const embedding_1 = require("../services/embedding");
class MemoryStore {
    constructor(options) {
        this.loadPromise = null;
        this.queue = Promise.resolve();
        this.records = [];
        this.vectorLength = null;
        this.lastFileSizeBytes = 0;
        this.dbPath = options.dbPath;
        this.dedupThreshold = options.dedupThreshold;
        this.maxCharsPerChunk = options.maxCharsPerChunk;
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
                    const stored = await this.processItem(item);
                    if (stored.length > 0) {
                        indexed += 1;
                        results.push(schema_1.MemoryIndexResultSchema.parse({
                            id: item.id,
                            status: "indexed",
                            storedIds: stored.map((record) => record.id)
                        }));
                    }
                    else {
                        duplicate += 1;
                        results.push(schema_1.MemoryIndexResultSchema.parse({
                            id: item.id,
                            status: "duplicate",
                            message: "No unique chunks"
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
            lastPersistedAt: this.lastPersistedAt
        };
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
                return;
            }
            this.vectorLength = parsed.vectorLength || null;
            this.records = parsed.items.map((item) => ({
                ...item,
                vector: Float32Array.from(item.vector)
            }));
            this.lastPersistedAt = parsed.updatedAt;
            const stats = await promises_1.default.stat(this.dbPath);
            this.lastFileSizeBytes = stats.size;
        }
        catch (error) {
            if (error.code === "ENOENT") {
                this.records = [];
                this.vectorLength = null;
                this.lastFileSizeBytes = 0;
                return;
            }
            throw error;
        }
    }
    async processItem(item) {
        const textChunks = chunkText(item.text, this.maxCharsPerChunk);
        const stored = [];
        for (const chunk of textChunks) {
            const vector = await this.embedText(chunk);
            this.ensureVectorDimension(vector.length);
            if (this.isDuplicate(vector, item.url)) {
                continue;
            }
            const record = {
                id: node_crypto_1.default.randomUUID(),
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
    ensureVectorDimension(length) {
        if (this.vectorLength === null) {
            this.vectorLength = length;
            return;
        }
        if (this.vectorLength !== length) {
            throw new Error(`Embedding dimension mismatch: expected ${this.vectorLength}, received ${length}`);
        }
    }
    isDuplicate(vector, url) {
        for (const record of this.records) {
            if (url && record.url && record.url === url) {
                return true;
            }
            const similarity = (0, embedding_1.cosineSimilarity)(vector, record.vector);
            if (similarity >= this.dedupThreshold) {
                return true;
            }
        }
        return false;
    }
    async persist() {
        const payload = {
            schemaVersion: schema_1.MEMORY_SCHEMA_VERSION,
            updatedAt: new Date().toISOString(),
            vectorLength: this.vectorLength ?? 0,
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
//# sourceMappingURL=store.js.map