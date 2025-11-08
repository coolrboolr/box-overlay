"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DevExtensionRegistry = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
const RegistrySchema = zod_1.z.object({
    origins: zod_1.z.array(zod_1.z.string())
});
class DevExtensionRegistry {
    constructor(options) {
        this.origins = new Set();
        this.persistenceWarningLogged = false;
        this.filePath = options.filePath;
    }
    async load() {
        if (!this.filePath) {
            this.logPersistenceWarning();
            return;
        }
        try {
            const data = await promises_1.default.readFile(this.filePath, "utf8");
            const parsed = RegistrySchema.parse(JSON.parse(data));
            parsed.origins.forEach((origin) => {
                this.origins.add(origin);
            });
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return;
            }
            console.warn("[server] failed to load dev extension registry", error);
        }
    }
    getAll() {
        return Array.from(this.origins);
    }
    has(origin) {
        return this.origins.has(origin);
    }
    async add(origin) {
        if (this.origins.has(origin)) {
            return false;
        }
        this.origins.add(origin);
        await this.persist();
        return true;
    }
    async clear() {
        this.origins.clear();
        await this.persist();
    }
    async persist() {
        if (!this.filePath) {
            this.logPersistenceWarning();
            return;
        }
        const dir = node_path_1.default.dirname(this.filePath);
        await promises_1.default.mkdir(dir, { recursive: true });
        const payload = JSON.stringify({ origins: this.getAll() }, null, 2);
        const tempFile = node_path_1.default.join(dir, `.dev-extension-origins.tmp-${process.pid}-${Date.now()}`);
        await promises_1.default.writeFile(tempFile, payload, "utf8");
        await promises_1.default.rename(tempFile, this.filePath);
    }
    logPersistenceWarning() {
        if (this.persistenceWarningLogged) {
            return;
        }
        this.persistenceWarningLogged = true;
        console.warn("[server] dev extension registry persistence disabled (DEV_EXTENSION_REGISTRY_FILE not set)");
    }
}
exports.DevExtensionRegistry = DevExtensionRegistry;
//# sourceMappingURL=devExtensionRegistry.js.map