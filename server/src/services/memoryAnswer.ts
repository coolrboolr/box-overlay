import { env } from "../env";
import type { MemoryQueryHit } from "../schema";

interface MemoryAnswerResponse {
  answer: string;
  sources?: string[];
}

export async function generateMemoryAnswer(
  query: string,
  hits: MemoryQueryHit[]
): Promise<{ text: string; sources: string[] }> {
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
        return `${index + 1}. Title: ${title}\nSnippet: ${hit.snippet}`;
      })
      .join("\n\n");

    const prompt = `You are a local assistant that answers the user's question using the provided saved snippets. ` +
      `Respond in JSON with keys "answer" and "sources" (an array of titles you used).`;

    const payload = {
      model,
      prompt: `${prompt}\n\nQuestion: ${query}\n\nSnippets:\n${context}\n\nJSON:` ,
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
    const parsed = parseAnswer(json.response);
    return {
      text: parsed.answer,
      sources: parsed.sources?.length ? parsed.sources : hits.map((hit) => hit.title || hit.url || hit.id)
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
        ? parsed.sources.filter((value: unknown): value is string => typeof value === "string")
        : undefined
    };
  } catch (error) {
    const err = new Error("Failed to parse answer payload");
    (err as Error & { cause?: unknown }).cause = error;
    throw err;
  }
}
