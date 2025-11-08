"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const env_1 = require("./env");
const HOST = "127.0.0.1";
async function main() {
    const { app } = await (0, app_1.createServerApp)();
    const server = app.listen(env_1.env.PORT, HOST, () => {
        console.log(`[server] listening on http://${HOST}:${env_1.env.PORT}`);
    });
    process.on("SIGINT", () => {
        console.log("[server] shutting down...");
        server.close(() => {
            process.exit(0);
        });
    });
}
void main().catch((error) => {
    console.error("[server] failed to start", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map