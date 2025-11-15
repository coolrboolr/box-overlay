import { env } from "../env";
import type { MemoryQueryHit } from "../schema";
import type { ConversationTurn } from "../memory/conversation";

const MAX_ANSWER_WORDS = 120;
const MAX_SNIPPET_CHARS = 240;

export class AnswerGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerGuardError";
  }
}

interface MemoryAnswerResponse {
  answer: string;
  sources?: string[];
}

export async function generateMemoryAnswer(
  query: string,
  hits: MemoryQueryHit[],
  options: { history?: ConversationTurn[] } = {}
): Promise<{ text: string; sources: string[]; sourceIds: string[] }> {
  if (!env.enableMemoryAnswers) {
    throw new Error("Memory answers disabled");
  }

  const model = env.OLLAMA_MODEL;
  const baseUrl = (env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.OLLAMA_TIMEOUT_MS);

  try {
    const context = hits
      .map((hit, index) => {
        const title = hit.title || hit.url || `Snippet ${index + 1}`;
        const metaParts = [
          hit.entityType ? `Entity: ${hit.entityType}` : null,
          hit.conceptIds?.length ? `Concept IDs: ${hit.conceptIds.join(", ")}` : null,
          hit.sourceDomain ? `Domain: ${hit.sourceDomain}` : null
        ]
          .filter(Boolean)
          .join(" | ");
        const metadataLine = metaParts ? `Metadata: ${metaParts}\n` : "";
        const snippet = truncateSnippet(hit.snippet);
        return `${index + 1}. Title: ${title}\n${metadataLine}Snippet: ${snippet}`;
      })
      .join("\n\n");

    const historyContext = (options.history ?? [])
      .map((turn, index) => `${index + 1}. ${turn.role.toUpperCase()}: ${turn.content}`)
      .join("\n");

    const historySection = historyContext
      ? `Earlier conversation (most recent last, up to 3 turns):\n${historyContext}\n\n`
      : "";

    const prompt =
      `You are a local assistant that answers the user's question using only the provided saved snippets. ` +
      `Respond in JSON with keys "answer" and "sources" (an array of titles or snippet numbers you used). ` +
      `Keep the answer under ${MAX_ANSWER_WORDS} words, avoid repeating the user's question verbatim, and do not invent sources. ` +
      `If you cannot answer confidently with citations, respond with a short apology and empty sources array.`;

    const payload = {
      model,
      prompt: `${prompt}\n\n${historySection}Question: ${query}\n\nSnippets:\n${context}\n\nJSON:`,
      format: "json",
      stream: false
    };

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Answer request failed with HTTP ${response.status}`);
    }

    const json = (await response.json()) as { response?: string };
    const parsed = enforceAnswerGuardrails(query, parseAnswer(json.response), hits);
    return {
      text: options.history?.length ? `Using earlier context: ${parsed.answer}` : parsed.answer,
      sources: parsed.sources,
      sourceIds: hits.map((hit) => hit.id)
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseAnswer(raw?: string): MemoryAnswerResponse {
  if (!raw) {
    throw new Error("Answer payload missing response field");
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.answer || typeof parsed.answer !== "string") {
      throw new Error("Answer field missing");
    }
    return {
      answer: parsed.answer.trim(),
      sources: Array.isArray(parsed.sources)
        ? parsed.sources
            .filter((value: unknown): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        : undefined
    };
  } catch (error) {
    const err = new Error("Failed to parse answer payload");
    (err as Error & { cause?: unknown }).cause = error;
    throw err;
  }
}

function enforceAnswerGuardrails(
  query: string,
  answer: MemoryAnswerResponse,
  hits: MemoryQueryHit[]
): MemoryAnswerResponse {
  const normalizedQuery = normalize(query);
  const normalizedAnswer = normalize(answer.answer);
  if (!answer.sources?.length) {
    throw new AnswerGuardError("Answer missing citations");
  }
  if (!normalizedAnswer || normalizedAnswer === normalizedQuery) {
    throw new AnswerGuardError("Answer repeats query");
  }

  const trimmed = trimWords(answer.answer, MAX_ANSWER_WORDS);
  return {
    answer: trimmed,
    sources: answer.sources.length ? answer.sources : hits.map((hit) => hit.title || hit.url || hit.id)
  };
}

function trimWords(text: string, limit: number): string {
  const words = text.split(/\s+/);
  if (words.length <= limit) {
    return text.trim();
  }
  return `${words.slice(0, limit).join(" ")}...`;
}

function truncateSnippet(snippet: string): string {
  if (snippet.length <= MAX_SNIPPET_CHARS) {
    return snippet;
  }
  return `${snippet.slice(0, MAX_SNIPPET_CHARS).trim()}...`;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
