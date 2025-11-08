"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeRequest = analyzeRequest;
const ollamaClient_1 = require("./ollamaClient");
const env_1 = require("./env");
const schema_1 = require("./schema");
async function analyzeRequest(payload) {
    const response = await (0, ollamaClient_1.callOllama)(payload, {
        model: env_1.env.OLLAMA_MODEL,
        baseUrl: env_1.env.OLLAMA_BASE_URL,
        timeoutMs: env_1.env.OLLAMA_TIMEOUT_MS,
        mock: env_1.env.MOCK_OLLAMA
    });
    return schema_1.ItemAnalysisResponseSchema.parse(response);
}
//# sourceMappingURL=analyzeService.js.map