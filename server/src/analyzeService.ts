import { callOllama } from "./ollamaClient";
import { env } from "./env";
import {
  ItemAnalysisRequest,
  ItemAnalysisResponse,
  ItemAnalysisResponseSchema
} from "./schema";

export async function analyzeRequest(
  payload: ItemAnalysisRequest
): Promise<ItemAnalysisResponse> {
  const response = await callOllama(payload, {
    model: env.OLLAMA_MODEL,
    baseUrl: env.OLLAMA_BASE_URL,
    timeoutMs: env.OLLAMA_TIMEOUT_MS,
    mock: env.MOCK_OLLAMA
  });
  return ItemAnalysisResponseSchema.parse(response);
}
