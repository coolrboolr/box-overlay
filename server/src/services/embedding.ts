import crypto from "node:crypto";

import { env } from "../env";

const DEFAULT_EMBED_MODEL = "mxbai-embed-large";
const DEFAULT_TIMEOUT_MS = 20_000;
const FAKE_EMBEDDING_DIMENSION = 64;

interface OllamaEmbeddingResponse {
  embedding?: number[];
}

export type EmbeddingGenerator = (text: string) => Promise<Float32Array>;

export async function generateEmbedding(text: string): Promise<Float32Array> {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error("Cannot embed empty text");
  }

  if (env.useFakeEmbeddings) {
    return createFakeEmbedding(normalized);
  }

  const model = env.memoryEmbedModel || env.OLLAMA_MODEL || DEFAULT_EMBED_MODEL;
  const baseUrl = (env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const timeoutMs = env.OLLAMA_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS;

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

    const payload = (await response.json()) as OllamaEmbeddingResponse;
    if (!payload || !Array.isArray(payload.embedding) || payload.embedding.length === 0) {
      throw new Error("Embedding response missing vector data");
    }

    const vector = Float32Array.from(payload.embedding.map((value) => Number(value)));
    return normalizeVector(vector);
  } finally {
    clearTimeout(timeoutId);
  }
}

function createFakeEmbedding(text: string): Float32Array {
  const values: number[] = [];
  let seedSuffix = 0;

  while (values.length < FAKE_EMBEDDING_DIMENSION) {
    const hash = crypto.createHash("sha256").update(text).update(String(seedSuffix)).digest();
    for (let i = 0; i < hash.length && values.length < FAKE_EMBEDDING_DIMENSION; i += 4) {
      const slice = hash.subarray(i, i + 4);
      const intValue = slice.length === 4 ? slice.readInt32BE() : slice[0];
      values.push(intValue / 0x7fffffff);
    }
    seedSuffix += 1;
  }

  return normalizeVector(Float32Array.from(values));
}

export function normalizeVector(vector: Float32Array): Float32Array {
  let magnitude = 0;
  for (let i = 0; i < vector.length; i += 1) {
    magnitude += vector[i]! * vector[i]!;
  }
  magnitude = Math.sqrt(magnitude) || 1;
  const normalized = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    normalized[i] = vector[i]! / magnitude;
  }
  return normalized;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Vectors have different dimensions");
  }
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}
