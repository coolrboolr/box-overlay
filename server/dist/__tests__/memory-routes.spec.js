"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_buffer_1 = require("node:buffer");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
const app_1 = require("../app");
const store_1 = require("../memory/store");
const tempDirs = [];
(0, vitest_1.afterEach)(async () => {
    while (tempDirs.length) {
        const dir = tempDirs.pop();
        if (dir) {
            await promises_1.default.rm(dir, { recursive: true, force: true });
        }
    }
});
(0, vitest_1.describe)("Memory routes", () => {
    (0, vitest_1.it)("indexes items and exposes stats", async () => {
        const store = await createStore();
        const { app } = await (0, app_1.createServerApp)({
            enableDevExtensionRegistration: false,
            enableBatchAnalyze: false,
            allowedOrigins: new Set(),
            enableMemory: true,
            memoryStore: store
        });
        const payload = buildPayload("memory-test-1", "https://example.com/article");
        const ingestResponse = await (0, supertest_1.default)(app).post("/api/memory/index").send({ items: [payload] }).expect(200);
        (0, vitest_1.expect)(ingestResponse.body.counts.indexed).toBe(1);
        (0, vitest_1.expect)(Array.isArray(ingestResponse.body.results)).toBe(true);
        const statsResponse = await (0, supertest_1.default)(app).get("/api/memory/stats").expect(200);
        (0, vitest_1.expect)(statsResponse.body.items).toBeGreaterThanOrEqual(1);
    });
    (0, vitest_1.it)("returns 400 for invalid payload", async () => {
        const store = await createStore();
        const { app } = await (0, app_1.createServerApp)({
            enableDevExtensionRegistration: false,
            enableBatchAnalyze: false,
            allowedOrigins: new Set(),
            enableMemory: true,
            memoryStore: store
        });
        await (0, supertest_1.default)(app)
            .post("/api/memory/index")
            .send({ items: [] })
            .expect(400);
    });
});
async function createStore() {
    const dir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "memory-router-"));
    tempDirs.push(dir);
    const store = new store_1.MemoryStore({
        dbPath: node_path_1.default.join(dir, "store.json"),
        dedupThreshold: 0.9,
        dedupKey: "cosine",
        maxCharsPerChunk: 256,
        embedModelVersion: "test-model@1",
        allowModelMismatch: true,
        embed: fakeEmbed
    });
    await store.load();
    return store;
}
function buildPayload(id, url) {
    return {
        id,
        sourceId: `${id}-source`,
        text: "The quick brown fox jumps over the lazy dog.",
        url,
        title: "Example",
        capturedAt: new Date().toISOString(),
        contentType: "text/html",
        language: "en"
    };
}
async function fakeEmbed(text) {
    const buffer = node_buffer_1.Buffer.from(text);
    const vector = new Float32Array(8);
    for (let i = 0; i < vector.length; i += 1) {
        const byte = buffer[i % buffer.length] ?? 0;
        vector[i] = (byte % 64) / 64;
    }
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return Float32Array.from(vector.map((value) => value / magnitude));
}
//# sourceMappingURL=memory-routes.spec.js.map