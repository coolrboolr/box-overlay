import { createServerApp } from "./app";
import { env } from "./env";

const HOST = "127.0.0.1";

async function main(): Promise<void> {
  const { app } = await createServerApp();

  const server = app.listen(env.PORT, HOST, () => {
    console.log(`[server] listening on http://${HOST}:${env.PORT}`);
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
