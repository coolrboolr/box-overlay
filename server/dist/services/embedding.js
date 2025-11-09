"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEmbedding = generateEmbedding;
exports.normalizeVector = normalizeVector;
exports.cosineSimilarity = cosineSimilarity;
const node_crypto_1 = __importDefault(require("node:crypto"));
const env_1 = require("../env");
const DEFAULT_EMBED_MODEL = "mxbai-embed-large";
const DEFAULT_TIMEOUT_MS = 20000;
const FAKE_EMBEDDING_DIMENSION = 64;
async function generateEmbedding(text) {
    const normalized = text.trim();
    if (!normalized) {
        throw new Error("Cannot embed empty text");
    }
    if (env_1.env.useFakeEmbeddings) {
        return createFakeEmbedding(normalized);
    }
    const model = env_1.env.memoryEmbedModel || env_1.env.OLLAMA_MODEL || DEFAULT_EMBED_MODEL;
    const baseUrl = (env_1.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    const timeoutMs = env_1.env.OLLAMA_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${baseUrl}/api/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model,
                prompt: normalized
            }),
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`Embedding request failed with HTTP ${response.status}`);
        }
        const payload = (await response.json());
        if (!payload || !Array.isArray(payload.embedding) || payload.embedding.length === 0) {
            throw new Error("Embedding response missing vector data");
        }
        const vector = Float32Array.from(payload.embedding.map((value) => Number(value)));
        return normalizeVector(vector);
    }
    finally {
        clearTimeout(timeoutId);
    }
}
function createFakeEmbedding(text) {
    const values = [];
    let seedSuffix = 0;
    while (values.length < FAKE_EMBEDDING_DIMENSION) {
        const hash = node_crypto_1.default.createHash("sha256").update(text).update(String(seedSuffix)).digest();
        for (let i = 0; i < hash.length && values.length < FAKE_EMBEDDING_DIMENSION; i += 4) {
            const slice = hash.subarray(i, i + 4);
            const intValue = slice.length === 4 ? slice.readInt32BE() : slice[0];
            values.push(intValue / 0x7fffffff);
        }
        seedSuffix += 1;
    }
    return normalizeVector(Float32Array.from(values));
}
function normalizeVector(vector) {
    let magnitude = 0;
    for (let i = 0; i < vector.length; i += 1) {
        magnitude += vector[i] * vector[i];
    }
    magnitude = Math.sqrt(magnitude) || 1;
    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i += 1) {
        normalized[i] = vector[i] / magnitude;
    }
    return normalized;
}
function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error("Vectors have different dimensions");
    }
    let dot = 0;
    for (let i = 0; i < a.length; i += 1) {
        dot += a[i] * b[i];
    }
    return dot;
}
//# sourceMappingURL=embedding.js.map