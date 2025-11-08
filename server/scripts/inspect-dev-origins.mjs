#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: false });

const rawPath = process.env.DEV_EXTENSION_REGISTRY_FILE || ".cache/dev-extension-origins.json";
const registryPath = path.isAbsolute(rawPath)
  ? rawPath
  : path.resolve(repoRoot, rawPath);

async function main() {
  try {
    const payload = await fs.readFile(registryPath, "utf8");
    const data = JSON.parse(payload);
    console.log("Dev extension registry path:", registryPath);
    console.log("Origins:");
    (data.origins ?? []).forEach((origin) => console.log(`- ${origin}`));
    if (!data.origins || data.origins.length === 0) {
      console.log("(empty — restart the extension to register an origin)");
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("No registry file found at", registryPath);
      console.log("Start the backend once to initialize it or register an extension origin.");
      return;
    }
    console.error("Failed to read dev extension registry", error);
    process.exitCode = 1;
  }
}

await main();
