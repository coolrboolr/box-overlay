import type { ItemAnalysisRequest, ItemAnalysisResponse } from "./schema";
import { ItemAnalysisResponseSchema } from "./schema";
import { env } from "./env";
import { buildPrompt } from "./prompt";

export interface OllamaConfig {
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  mock?: boolean;
}

interface OllamaGenerateResponse {
  response?: unknown;
  done?: boolean;
}

const DEFAULT_MODEL = "llama3";
const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 20_000;

class OllamaParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "OllamaParseError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export async function callOllama(
  input: ItemAnalysisRequest,
  config: OllamaConfig
): Promise<ItemAnalysisResponse> {
  const shouldMock = config.mock ?? env.MOCK_OLLAMA;
  if (shouldMock) {
    return mockResponse(input);
  }

  const model = config.model || env.OLLAMA_MODEL || DEFAULT_MODEL;
  const baseUrl = (config.baseUrl ?? env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    ""
  );
  const timeoutMs = config.timeoutMs ?? env.OLLAMA_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS;
  const hasImage = Boolean(input.image);
  const sharedImageData = extractImageData(input.image);
  const basePrompt = buildPrompt({ text: input.text, hasImage });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const runWithPrompt = async (prompt: string): Promise<ItemAnalysisResponse> => {
      const requestPayload: Record<string, unknown> = {
        model,
        prompt,
        format: "json",
        stream: false
      };

      if (sharedImageData) {
        requestPayload.images = [sharedImageData];
      }

      const url = `${baseUrl}/api/generate`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Ollama returned HTTP ${response.status}`);
      }

      const json = (await response.json()) as OllamaGenerateResponse;
      const parsed = parseOllamaResponse(json);
      const normalized = normalizeResponse(parsed, input);
      return ItemAnalysisResponseSchema.parse(normalized);
    };

    const handleFailure = async (
      error: unknown,
      attemptedStrict: boolean
    ): Promise<ItemAnalysisResponse> => {
      if (!attemptedStrict && error instanceof OllamaParseError) {
        const strictPrompt = buildPrompt({ text: input.text, hasImage, retry: true });
        try {
          return await runWithPrompt(strictPrompt);
        } catch (strictError) {
          return handleFailure(strictError, true);
        }
      }

      if (env.MOCK_OLLAMA_FALLBACK) {
        console.warn("[server] Ollama call failed, falling back to mock:", error);
        return mockResponse(input);
      }

      throw error;
    };

    try {
      return await runWithPrompt(basePrompt);
    } catch (error) {
      return handleFailure(error, false);
    }
  } catch (error) {
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractImageData(image?: ItemAnalysisRequest["image"]): string | undefined {
  if (!image) {
    return undefined;
  }

  if (image.kind === "dataUri") {
    const commaIndex = image.data.indexOf(",");
    if (commaIndex >= 0) {
      return image.data.slice(commaIndex + 1);
    }
    return image.data;
  }

  if (image.kind === "tag") {
    return undefined;
  }

  return undefined;
}

function parseOllamaResponse(payload: OllamaGenerateResponse): unknown {
  const { response } = payload;
  if (typeof response === "string") {
    try {
      return JSON.parse(response);
    } catch (error) {
      throw new OllamaParseError("Ollama response could not be parsed as JSON", error);
    }
  }
  if (typeof response === "object" && response !== null) {
    return response;
  }
  throw new OllamaParseError("Ollama response missing `response` field");
}

function normalizeResponse(raw: unknown, input: ItemAnalysisRequest): ItemAnalysisResponse {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Ollama structured output is not an object");
  }

  const record = raw as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const imageTagRaw =
    typeof record.image_tag === "string"
      ? record.image_tag.trim()
      : typeof record.imageTag === "string"
      ? record.imageTag.trim()
      : undefined;
  const isAdRaw = record.is_ad ?? record.isAd;

  const normalizedSummary = truncate(summary, 280);
  const normalizedImageTag = imageTagRaw ? limitWords(imageTagRaw, 3) : undefined;
  const normalizedIsAd = coerceBoolean(isAdRaw);

  return {
    id: input.id,
    summary: normalizedSummary || defaultSummary(input.text),
    image: normalizedImageTag ? { kind: "tag", tag: normalizedImageTag } : undefined,
    isAd: normalizedIsAd
  };
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trim()}...`;
}

function limitWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return text;
  }
  return words.slice(0, maxWords).join(" ");
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return false;
}

function defaultSummary(text: string): string {
  const preview = text.replace(/\s+/g, " ").trim();
  return truncate(preview, 200) || "No summary available.";
}

function mockResponse(input: ItemAnalysisRequest): ItemAnalysisResponse {
  return {
    id: input.id,
    summary: truncate(input.text.replace(/\s+/g, " ").trim(), 200),
    image: input.image?.kind === "tag" ? { kind: "tag", tag: input.image.tag } : undefined,
    isAd: false
  };
}
