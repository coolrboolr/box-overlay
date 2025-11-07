import { defineConfig } from "tsup";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(__dirname, "static");

export default defineConfig((options) => {
  const nodeEnv = process.env.NODE_ENV ?? (options.watch ? "development" : "production");
  const isDevBuild = nodeEnv !== "production";

  return {
    entry: {
      background: "src/background/index.ts",
      content: "src/content/index.ts"
    },
    outDir: "dist",
    format: ["esm"],
    target: "es2022",
    splitting: false,
    sourcemap: false,
    clean: !options.watch,
    shims: false,
    minify: false,
    treeshake: true,
    onSuccess: "node ./scripts/copy-static.mjs",
    watch: options.watch ? ["src/**/*", `${staticDir}/**/*`] : undefined,
    define: {
      "process.env.NODE_ENV": JSON.stringify(nodeEnv),
      __LLM_OVERLAY_DEV__: JSON.stringify(isDevBuild)
    },
    esbuildOptions(buildOptions) {
      buildOptions.banner = buildOptions.banner || {};
      buildOptions.banner.js = `"use strict";`;
    }
  };
});
