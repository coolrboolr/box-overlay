"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
const devExtensionRegistry_1 = require("../utils/devExtensionRegistry");
const tempDirs = [];
(0, vitest_1.afterEach)(async () => {
    while (tempDirs.length) {
        const dir = tempDirs.pop();
        if (dir) {
            await promises_1.default.rm(dir, { recursive: true, force: true });
        }
    }
});
(0, vitest_1.describe)("DevExtensionRegistry", () => {
    (0, vitest_1.it)("persists unique origins and reloads them", async () => {
        const registryPath = await createTempFilePath();
        const registry = new devExtensionRegistry_1.DevExtensionRegistry({ filePath: registryPath });
        await registry.load();
        await registry.add("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        await registry.add("chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        await registry.add("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        const reload = new devExtensionRegistry_1.DevExtensionRegistry({ filePath: registryPath });
        await reload.load();
        (0, vitest_1.expect)(reload.getAll()).toEqual([
            "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        ]);
    });
    (0, vitest_1.it)("clears persisted origins", async () => {
        const registryPath = await createTempFilePath();
        const registry = new devExtensionRegistry_1.DevExtensionRegistry({ filePath: registryPath });
        await registry.add("chrome-extension://cccccccccccccccccccccccccccccccc");
        await registry.clear();
        const contents = await promises_1.default.readFile(registryPath, "utf8");
        (0, vitest_1.expect)(JSON.parse(contents)).toEqual({ origins: [] });
    });
});
async function createTempFilePath() {
    const dir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "dev-registry-"));
    tempDirs.push(dir);
    return node_path_1.default.join(dir, "origins.json");
}
//# sourceMappingURL=devExtensionRegistry.spec.js.map