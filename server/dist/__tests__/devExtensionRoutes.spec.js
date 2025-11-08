"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
vitest_1.vi.mock("../analyzeService", () => {
    return {
        analyzeRequest: vitest_1.vi.fn(async (payload) => ({
            id: payload.id,
            summary: "mock summary",
            is_ad: false
        }))
    };
});
const app_1 = require("../app");
const tempDirs = [];
(0, vitest_1.beforeEach)(() => {
    tempDirs.length = 0;
});
(0, vitest_1.afterEach)(async () => {
    while (tempDirs.length) {
        const dir = tempDirs.pop();
        if (dir) {
            await promises_1.default.rm(dir, { recursive: true, force: true });
        }
    }
});
(0, vitest_1.describe)("Dev extension routes", () => {
    (0, vitest_1.it)("allows analyze after registration and re-blocks after clear", async () => {
        const registryPath = await createTempRegistryPath();
        const originId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        const origin = `chrome-extension://${originId}`;
        const { app } = await (0, app_1.createServerApp)({
            enableDevExtensionRegistration: true,
            enableBatchAnalyze: false,
            allowedOrigins: new Set(),
            devExtensionRegistryFile: registryPath
        });
        const payload = { id: "spec13", text: "Sample text" };
        await (0, supertest_1.default)(app)
            .post("/api/analyze")
            .set("Origin", origin)
            .send(payload)
            .expect(403);
        await (0, supertest_1.default)(app)
            .post("/api/dev/register-extension-origin")
            .query({ id: originId })
            .expect(204);
        await (0, supertest_1.default)(app)
            .post("/api/analyze")
            .set("Origin", origin)
            .send(payload)
            .expect(200);
        await (0, supertest_1.default)(app)
            .post("/api/dev/clear-extension-origins")
            .expect(204);
        await (0, supertest_1.default)(app)
            .post("/api/analyze")
            .set("Origin", origin)
            .send(payload)
            .expect(403);
    });
});
async function createTempRegistryPath() {
    const dir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "dev-registry-"));
    tempDirs.push(dir);
    return node_path_1.default.join(dir, "origins.json");
}
//# sourceMappingURL=devExtensionRoutes.spec.js.map