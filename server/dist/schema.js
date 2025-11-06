"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorResponseSchema = exports.ItemAnalysisResponseSchema = exports.ItemAnalysisRequestSchema = void 0;
const zod_1 = require("zod");
exports.ItemAnalysisRequestSchema = zod_1.z.object({
    id: zod_1.z.string().min(1, "id is required"),
    text: zod_1.z.string().min(1, "text is required").max(1500, "text exceeds maximum length"),
    image: zod_1.z.string().min(1).optional()
});
exports.ItemAnalysisResponseSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    summary: zod_1.z.string().min(1),
    image_tag: zod_1.z.string().min(1).optional(),
    is_ad: zod_1.z.boolean()
});
exports.ErrorResponseSchema = zod_1.z.object({
    error: zod_1.z.string(),
    message: zod_1.z.string(),
    details: zod_1.z.unknown().optional()
});
//# sourceMappingURL=schema.js.map