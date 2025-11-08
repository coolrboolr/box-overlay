import "dotenv/config";

import process from "node:process";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:5000";

async function main() {
  await checkDevOrigins();
  await runAnalyzeSmoke();
  console.log("Smoke checks passed ✔");
}

async function checkDevOrigins(): Promise<void> {
  const url = new URL("/api/dev/allowed-extension-origins", BASE_URL);
  try {
    const response = await fetch(url, { method: "GET" });
    if (response.status === 404) {
      console.log("Dev origin diagnostics disabled (ENABLE_DEV_EXTENSION_REGISTRATION=false)");
      return;
    }

    if (!response.ok) {
      throw new Error(`Dev origins endpoint failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { allowed?: string[]; dynamic?: string[] };
    console.log("Static allowlist:", payload.allowed ?? []);
    console.log("Dynamic registry:", payload.dynamic ?? []);
  } catch (error) {
    console.warn("Skipping dev origin diagnostics:", (error as Error).message);
  }
}

async function runAnalyzeSmoke(): Promise<void> {
  const analyzeUrl = new URL("/api/analyze", BASE_URL);
  const payload = {
    schemaVersion: 1,
    id: `smoke-${Date.now()}`,
    text: "Smoke test payload for SPEC13"
  };

  const response = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Analyze endpoint failed with HTTP ${response.status}: ${details}`);
  }

  const data = (await response.json()) as { id?: string; summary?: string; is_ad?: boolean };
  if (!data.id || !data.summary) {
    throw new Error("Analyze endpoint returned malformed payload");
  }

  console.log(`Analyze successful for id ${data.id}`);
}

main().catch((error) => {
  console.error("Smoke checks failed", error);
  process.exit(1);
});
