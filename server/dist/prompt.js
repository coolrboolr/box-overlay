"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPrompt = buildPrompt;
const SYSTEM_PROMPT = "You are a local assistant that summarizes on-page content, provides a short image tag when helpful, and decides whether the item is an advertisement.";
const OUTPUT_SCHEMA = `{
  "summary": "string (1-2 sentences)",
  "image": {"kind":"tag","tag":"string"} | null,
  "isAd": "boolean"
}`;
const REMINDER = "Respond with strictly valid JSON matching the schema above. Do not include markdown fences, comments, or additional text.";
function buildPrompt({ text, imageTagHint, hasImage, retry }) {
    const sections = [
        SYSTEM_PROMPT,
        "Task: Read the provided content and return a concise summary plus whether it is likely an advertisement.",
        `Output Schema:\n${OUTPUT_SCHEMA}`,
        REMINDER
    ];
    if (retry) {
        sections.push("STRICT MODE: Your previous response was not valid JSON. Return ONLY the JSON object with keys summary, image, isAd.");
    }
    const trimmedText = text.trim();
    sections.push(`TEXT:\n${trimmedText}`);
    sections.push(`IMAGE_PROVIDED: ${hasImage ? "true" : "false"}`);
    if (imageTagHint) {
        sections.push(`IMAGE_HINT: ${imageTagHint}`);
    }
    return sections.join("\n\n");
}
//# sourceMappingURL=prompt.js.map