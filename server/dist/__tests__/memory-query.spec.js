"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
const app_1 = require("../app");
const store_1 = require("../memory/store");
const env_1 = require("../env");
const embeddingService = __importStar(require("../services/embedding"));
const tempDirs = [];
(0, vitest_1.beforeEach)(() => {
    tempDirs.length = 0;
});
(0, vitest_1.afterEach)(async () => {
    while (tempDirs.length) {
        const dir = tempDirs.pop();
        if (dir) {
            await promises_1.default.rm(dir, { recursive: true, force: true });
        }
    }
    env_1.env.enableMemoryAnswers = false;
    vitest_1.vi.restoreAllMocks();
});
(0, vitest_1.describe)("memory query endpoint", () => {
    (0, vitest_1.it)("returns ranked matches without answers", async () => {
        env_1.env.enableMemoryAnswers = false;
        const store = await createPopulatedStore();
        const { app } = await (0, app_1.createServerApp)({
            enableMemory: true,
            memoryStore: store,
            enableDevExtensionRegistration: false,
            enableBatchAnalyze: false,
            allowedOrigins: new Set()
        });
        vitest_1.vi.spyOn(embeddingService, "generateEmbedding").mockResolvedValue(new Float32Array([1, 0, 0, 0]));
        const response = await (0, supertest_1.default)(app)
            .post("/api/memory/query")
            .send({ query: "local semantic memory", topK: 2 })
            .expect(200);
        (0, vitest_1.expect)(response.body.results).toHaveLength(2);
        (0, vitest_1.expect)(response.body.answer).toBeUndefined();
        (0, vitest_1.expect)(response.body.results[0].similarity).toBeGreaterThanOrEqual(response.body.results[1].similarity);
    });
    (0, vitest_1.it)("includes generated answer when enabled", async () => {
        env_1.env.enableMemoryAnswers = true;
        const store = await createPopulatedStore();
        vitest_1.vi.mock("../services/memoryAnswer", () => ({
            generateMemoryAnswer: vitest_1.vi.fn(async () => ({
                text: "Memory response",
                sources: ["Snippet"],
                sourceIds: ["alpha"]
            }))
        }));
        vitest_1.vi.spyOn(embeddingService, "generateEmbedding").mockResolvedValue(new Float32Array([1, 0, 0, 0]));
        const { app } = await (0, app_1.createServerApp)({
            enableMemory: true,
            memoryStore: store,
            enableDevExtensionRegistration: false,
            enableBatchAnalyze: false,
            allowedOrigins: new Set()
        });
        const response = await (0, supertest_1.default)(app)
            .post("/api/memory/query")
            .send({ query: "assistant answer" })
            .expect(200);
        (0, vitest_1.expect)(response.body.answer).toBeDefined();
        vitest_1.vi.doUnmock("../services/memoryAnswer");
    });
});
async function createPopulatedStore() {
    const dir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "memory-query-"));
    tempDirs.push(dir);
    const store = new store_1.MemoryStore({
        dbPath: node_path_1.default.join(dir, "store.json"),
        dedupThreshold: 0.5,
        dedupKey: "cosine",
        maxCharsPerChunk: 512,
        embedModelVersion: "test-model@1",
        allowModelMismatch: true,
        embed: fakeEmbed
    });
    await store.load();
    const items = [
        {
            id: "alpha",
            sourceId: "alpha",
            text: "Persistent local semantic memory overview",
            url: "https://example.com/a",
            title: "Overview",
            capturedAt: new Date().toISOString()
        },
        {
            id: "beta",
            sourceId: "beta",
            text: "Instructions about querying stored snippets",
            url: "https://example.com/b",
            title: "Query",
            capturedAt: new Date().toISOString()
        }
    ];
    await store.ingest(items);
    return store;
}
async function fakeEmbed(text) {
    const basisIndex = Math.abs(hash(text)) % 4;
    const vector = new Float32Array(4);
    vector[basisIndex] = 1;
    return vector;
}
function hash(input) {
    let result = 0;
    for (let i = 0; i < input.length; i += 1) {
        result = (result * 31 + input.charCodeAt(i)) | 0;
    }
    return result;
}
//# sourceMappingURL=memory-query.spec.js.map