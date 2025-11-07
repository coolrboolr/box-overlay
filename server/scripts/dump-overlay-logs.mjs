#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function formatTimestamp(ms) {
  if (!Number.isFinite(ms)) {
    return "unknown";
  }
  return new Date(ms).toISOString();
}

function printUsage() {
  console.error("Usage: node server/scripts/dump-overlay-logs.mjs <path-to-export.json>");
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  let raw;
  try {
    raw = await readFile(resolvedPath, "utf8");
  } catch (error) {
    console.error(`Failed to read ${resolvedPath}:`, error);
    process.exitCode = 1;
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    console.error(`File ${resolvedPath} is not valid JSON:`, error);
    process.exitCode = 1;
    return;
  }

  const stats = payload?.stats ?? {};
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];

  console.log(`\nOverlay telemetry summary for ${resolvedPath}`);
  console.log("========================================\n");

  const totals = {
    scannedNodes: Number(stats.scannedNodes ?? 0),
    requestsQueued: Number(stats.requestsQueued ?? 0),
    overlaysResolved: Number(stats.overlaysResolved ?? 0),
    retries: Number(stats.retries ?? 0),
    errors: Number(stats.errors ?? 0)
  };

  console.log("Totals:");
  Object.entries(totals).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });

  const eventCounts = entries.reduce((acc, entry) => {
    const type = typeof entry?.type === "string" ? entry.type : "unknown";
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});

  console.log("\nEvent counts:");
  Object.entries(eventCounts).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

  const recent = entries.slice(-10);
  if (recent.length) {
    console.log("\nRecent entries:");
    recent.forEach((entry) => {
      const ts = formatTimestamp(entry.timestamp);
      const detail = entry.detail ? JSON.stringify(entry.detail) : "";
      console.log(`  [${ts}] ${entry.type}${detail ? ` ${detail}` : ""}`);
    });
  } else {
    console.log("\nRecent entries: none recorded.");
  }

  console.log();
}

await main();
