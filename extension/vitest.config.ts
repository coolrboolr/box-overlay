import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: [],
    restoreMocks: true,
    clearMocks: true,
    threads: false
  }
});
