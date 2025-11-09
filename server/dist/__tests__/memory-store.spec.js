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
            maxCharsPerChunk: 64,
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
            maxCharsPerChunk: 64,
            embed: fakeEmbed
        });
        await reloaded.load();
        const persistedStats = await reloaded.stats();
        (0, vitest_1.expect)(persistedStats.items).toBe(1);
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