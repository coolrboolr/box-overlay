import { defineConfig } from "tsup";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(__dirname, "static");

export default defineConfig((options) => ({
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
  esbuildOptions(options) {
    options.banner = options.banner || {};
    options.banner.js = `"use strict";`;
  }
}));
