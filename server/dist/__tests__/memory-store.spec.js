"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_buffer_1 = require("node:buffer");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
const store_1 = require("../memory/store");
const tempDirs = [];
(0, vitest_1.afterEach)(async () => {
    for (const dir of tempDirs) {
        await promises_1.default.rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
});
(0, vitest_1.describe)("MemoryStore", () => {
    (0, vitest_1.it)("ingests items, skips duplicates, and persists to disk", async () => {
        const dbPath = await createTempPath();
        const store = new store_1.MemoryStore({
            dbPath,
            dedupThreshold: 0.9,
            dedupKey: "cosine",
            maxCharsPerChunk: 64,
            embedModelVersion: "test-model@1",
            allowModelMismatch: true,
            embed: fakeEmbed
        });
        await store.load();
        const firstPayload = {
            id: "item-1",
            sourceId: "source-1",
            text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
            url: "https://example.com/article",
            title: "Article",
            capturedAt: new Date().toISOString()
        };
        const firstResult = await store.ingest([firstPayload]);
        (0, vitest_1.expect)(firstResult.counts.indexed).toBe(1);
        (0, vitest_1.expect)(firstResult.results[0]?.status).toBe("indexed");
        const duplicatePayload = {
            ...firstPayload,
            id: "item-2"
        };
        const secondResult = await store.ingest([duplicatePayload]);
        (0, vitest_1.expect)(secondResult.counts.duplicate).toBe(1);
        (0, vitest_1.expect)(secondResult.results[0]?.status).toBe("duplicate");
        const stats = await store.stats();
        (0, vitest_1.expect)(stats.items).toBe(1);
        (0, vitest_1.expect)(stats.vectors).toBe(1);
        const reloaded = new store_1.MemoryStore({
            dbPath,
            dedupThreshold: 0.9,
            dedupKey: "cosine",
            maxCharsPerChunk: 64,
            embedModelVersion: "test-model@1",
            allowModelMismatch: true,
            embed: fakeEmbed
        });
        await reloaded.load();
        const persistedStats = await reloaded.stats();
        (0, vitest_1.expect)(persistedStats.items).toBe(1);
    });
    (0, vitest_1.it)("stores multiple chunks from the same URL when text differs", async () => {
        const dbPath = await createTempPath();
        let call = 0;
        const orthogonalEmbed = vitest_1.vi.fn(async () => {
            const vectors = [
                new Float32Array([1, 0]),
                new Float32Array([0, 1])
            ];
            const vector = vectors[call] ?? vectors[1];
            call += 1;
            return vector;
        });
        const store = new store_1.MemoryStore({
            dbPath,
            dedupThreshold: 0.8,
            dedupKey: "cosine",
            maxCharsPerChunk: 256,
            embedModelVersion: "test-model@1",
            allowModelMismatch: true,
            embed: orthogonalEmbed
        });
        await store.ingest([
            {
                id: "card-1",
                sourceId: "card-1",
                text: "First article content",
                url: "https://example.com/feed",
                title: "Feed",
                capturedAt: new Date().toISOString()
            },
            {
                id: "card-2",
                sourceId: "card-2",
                text: "Second article content with different angle",
                url: "https://example.com/feed",
                title: "Feed",
                capturedAt: new Date().toISOString()
            }
        ]);
        const stats = await store.stats();
        (0, vitest_1.expect)(stats.items).toBe(2);
    });
    (0, vitest_1.it)("marks duplicates using hash strategy", async () => {
        const dbPath = await createTempPath();
        const store = new store_1.MemoryStore({
            dbPath,
            dedupThreshold: 0.9,
            dedupKey: "hash",
            maxCharsPerChunk: 256,
            embedModelVersion: "test-model@1",
            allowModelMismatch: true,
            embed: fakeEmbed
        });
        await store.load();
        const payload = {
            id: "hash-a",
            text: "Identical hash content",
            sourceId: "hash-a",
            url: "https://example.dev/a"
        };
        const first = await store.ingest([payload]);
        (0, vitest_1.expect)(first.counts.indexed).toBe(1);
        const second = await store.ingest([{ ...payload, id: "hash-b", sourceId: "hash-b" }]);
        (0, vitest_1.expect)(second.counts.duplicate).toBe(1);
        (0, vitest_1.expect)(second.results[0]?.duplicateOf).toBeDefined();
    });
    (0, vitest_1.it)("filters search results by entity type and concepts", async () => {
        const dbPath = await createTempPath();
        const store = new store_1.MemoryStore({
            dbPath,
            dedupThreshold: 0.5,
            dedupKey: "cosine",
            maxCharsPerChunk: 256,
            embedModelVersion: "test-model@1",
            allowModelMismatch: true,
            embed: fakeEmbed
        });
        await store.load();
        await store.ingest([
            {
                id: "concept-a",
                text: "Product guide snippet",
                entityType: "product",
                conceptIds: ["concept:product"],
                url: "https://example.dev/product"
            },
            {
                id: "concept-b",
                text: "Article snippet body",
                entityType: "article",
                conceptIds: ["concept:article"],
                url: "https://example.dev/article"
            }
        ]);
        const vector = await fakeEmbed("Product guide snippet");
        const results = await store.search({
            vector,
            topK: 2,
            entityTypes: ["product"],
            conceptIds: ["concept:product"]
        });
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0]?.entityType).toBe("product");
    });
    (0, vitest_1.it)("migrates legacy persistence payloads that lack embed metadata", async () => {
        const dbPath = await createTempPath();
        const legacy = {
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            vectorLength: 2,
            items: [
                {
                    id: "legacy",
                    parentId: "legacy",
                    sourceId: "legacy",
                    text: "Legacy chunk",
                    snippet: "Legacy chunk",
                    vector: [1, 0],
                    url: "https://legacy.dev/path",
                    title: "Legacy",
                    contentType: "text/html",
                    createdAt: new Date().toISOString()
                }
            ]
        };
        await promises_1.default.writeFile(dbPath, JSON.stringify(legacy));
        const store = new store_1.MemoryStore({
            dbPath,
            dedupThreshold: 0.9,
            dedupKey: "cosine",
            maxCharsPerChunk: 256,
            embedModelVersion: "test-model@1",
            allowModelMismatch: true,
            embed: fakeEmbed
        });
        await store.load();
        const stats = await store.stats();
        (0, vitest_1.expect)(stats.embedModelVersion).toBe("test-model@1");
        const hits = await store.search({
            vector: new Float32Array([1, 0]),
            topK: 1
        });
        (0, vitest_1.expect)(hits[0]?.sourceDomain).toBe("legacy.dev");
    });
});
async function createTempPath() {
    const dir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "memory-store-"));
    const filePath = node_path_1.default.join(dir, "store.json");
    tempDirs.push(dir);
    return filePath;
}
async function fakeEmbed(text) {
    const normalized = text.trim();
    const buffer = node_buffer_1.Buffer.from(normalized);
    const vector = new Float32Array(8);
    for (let i = 0; i < vector.length; i += 1) {
        const byte = buffer[i % buffer.length] ?? 0;
        vector[i] = (byte % 32) / 32;
    }
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return Float32Array.from(vector.map((value) => value / magnitude));
}
//# sourceMappingURL=memory-store.spec.js.map