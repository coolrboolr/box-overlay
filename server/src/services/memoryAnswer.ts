import { env } from "../env";
import type { MemoryQueryHit } from "../schema";
import type { ConversationTurn } from "../memory/conversation";

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
        return `${index + 1}. Title: ${title}\n${metadataLine}Snippet: ${hit.snippet}`;
      })
      .join("\n\n");

    const historyContext = (options.history ?? [])
      .map((turn, index) => `${index + 1}. ${turn.role.toUpperCase()}: ${turn.content}`)
      .join("\n");

    const historySection = historyContext
      ? `Earlier conversation (most recent last, up to 3 turns):\n${historyContext}\n\n`
      : "";

    const prompt =
      `You are a local assistant that answers the user's question using the provided saved snippets. ` +
      `Respond in JSON with keys "answer" and "sources" (an array of titles you used). ` +
      `Always cite sources and mention when you are using earlier conversation context.`;

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
    const parsed = parseAnswer(json.response);
    return {
      text: options.history?.length ? `Using earlier context: ${parsed.answer}` : parsed.answer,
      sources: parsed.sources?.length ? parsed.sources : hits.map((hit) => hit.title || hit.url || hit.id),
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
        ? parsed.sources.filter((value: unknown): value is string => typeof value === "string")
        : undefined
    };
  } catch (error) {
    const err = new Error("Failed to parse answer payload");
    (err as Error & { cause?: unknown }).cause = error;
    throw err;
  }
}
