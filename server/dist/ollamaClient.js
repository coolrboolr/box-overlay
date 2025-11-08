"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callOllama = callOllama;
const schema_1 = require("./schema");
const env_1 = require("./env");
const prompt_1 = require("./prompt");
const DEFAULT_MODEL = "llama3";
const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 20000;
class OllamaParseError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = "OllamaParseError";
        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}
async function callOllama(input, config) {
    const shouldMock = config.mock ?? env_1.env.MOCK_OLLAMA;
    if (shouldMock) {
        return mockResponse(input);
    }
    const model = config.model || env_1.env.OLLAMA_MODEL || DEFAULT_MODEL;
    const baseUrl = (config.baseUrl ?? env_1.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    const timeoutMs = config.timeoutMs ?? env_1.env.OLLAMA_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS;
    const hasImage = Boolean(input.image);
    const sharedImageData = extractImageData(input.image);
    const basePrompt = (0, prompt_1.buildPrompt)({ text: input.text, hasImage });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const runWithPrompt = async (prompt) => {
            const requestPayload = {
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
            const json = (await response.json());
            const parsed = parseOllamaResponse(json);
            const normalized = normalizeResponse(parsed, input);
            return schema_1.ItemAnalysisResponseSchema.parse(normalized);
        };
        const handleFailure = async (error, attemptedStrict) => {
            if (!attemptedStrict && error instanceof OllamaParseError) {
                const strictPrompt = (0, prompt_1.buildPrompt)({ text: input.text, hasImage, retry: true });
                try {
                    return await runWithPrompt(strictPrompt);
                }
                catch (strictError) {
                    return handleFailure(strictError, true);
                }
            }
            if (env_1.env.MOCK_OLLAMA_FALLBACK) {
                console.warn("[server] Ollama call failed, falling back to mock:", error);
                return mockResponse(input);
            }
            throw error;
        };
        try {
            return await runWithPrompt(basePrompt);
        }
        catch (error) {
            return handleFailure(error, false);
        }
    }
    catch (error) {
        throw error;
    }
    finally {
        clearTimeout(timeoutId);
    }
}
function extractImageData(image) {
    if (!image) {
        return undefined;
    }
    if (image.startsWith("data:")) {
        const commaIndex = image.indexOf(",");
        if (commaIndex >= 0) {
            return image.slice(commaIndex + 1);
        }
        return image;
    }
    // If the extension ever passes raw base64 or URLs, only forward when base64 is detected.
    if (/^[a-z0-9+/=]+$/i.test(image)) {
        return image;
    }
    return undefined;
}
function parseOllamaResponse(payload) {
    const { response } = payload;
    if (typeof response === "string") {
        try {
            return JSON.parse(response);
        }
        catch (error) {
            throw new OllamaParseError("Ollama response could not be parsed as JSON", error);
        }
    }
    if (typeof response === "object" && response !== null) {
        return response;
    }
    throw new OllamaParseError("Ollama response missing `response` field");
}
function normalizeResponse(raw, input) {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("Ollama structured output is not an object");
    }
    const record = raw;
    const summary = typeof record.summary === "string" ? record.summary.trim() : "";
    const imageTagRaw = typeof record.image_tag === "string" ? record.image_tag.trim() : undefined;
    const isAdRaw = record.is_ad;
    const normalizedSummary = truncate(summary, 280);
    const normalizedImageTag = imageTagRaw ? limitWords(imageTagRaw, 3) : undefined;
    const normalizedIsAd = coerceBoolean(isAdRaw);
    return {
        id: input.id,
        summary: normalizedSummary || defaultSummary(input.text),
        image_tag: normalizedImageTag,
        is_ad: normalizedIsAd
    };
}
function truncate(text, maxLength) {
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength).trim()}...`;
}
function limitWords(text, maxWords) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) {
        return text;
    }
    return words.slice(0, maxWords).join(" ");
}
function coerceBoolean(value) {
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
function defaultSummary(text) {
    const preview = text.replace(/\s+/g, " ").trim();
    return truncate(preview, 200) || "No summary available.";
}
function mockResponse(input) {
    return {
        id: input.id,
        summary: truncate(input.text.replace(/\s+/g, " ").trim(), 200),
        image_tag: input.image ? "generic image" : undefined,
        is_ad: false
    };
}
//# sourceMappingURL=ollamaClient.js.map