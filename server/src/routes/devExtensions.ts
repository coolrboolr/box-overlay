import type express from "express";
import { Router } from "express";

import { DevExtensionRegistry } from "../utils/devExtensionRegistry";

export interface DevExtensionRouteOptions {
  registry: DevExtensionRegistry;
  dynamicExtensionOrigins: Set<string>;
  allowedExtensionOrigins: Set<string>;
  onRegisterAttempt?: () => void;
}

export function createDevExtensionsRouter(options: DevExtensionRouteOptions): Router {
  const router = Router();

  router.post("/register-extension-origin", async (req, res) => {
    const requestedOrigin = coerceExtensionOrigin(req);
    if (!requestedOrigin) {
      return res.status(400).json({ error: "INVALID_EXTENSION_ORIGIN" });
    }

    options.onRegisterAttempt?.();

    if (options.allowedExtensionOrigins.has(requestedOrigin)) {
      return res.status(204).end();
    }

    if (!options.dynamicExtensionOrigins.has(requestedOrigin)) {
      options.dynamicExtensionOrigins.add(requestedOrigin);
      await options.registry.add(requestedOrigin);
      console.log("[server] registered dev extension origin", requestedOrigin);
    }

    return res.status(204).end();
  });

  router.post("/clear-extension-origins", async (_req, res) => {
    options.dynamicExtensionOrigins.clear();
    await options.registry.clear();
    console.log("[server] cleared dev extension origins");
    return res.status(204).end();
  });

  router.get("/allowed-extension-origins", (_req, res) => {
    return res.json({
      allowed: Array.from(options.allowedExtensionOrigins),
      dynamic: Array.from(options.dynamicExtensionOrigins)
    });
  });

  return router;
}

function coerceExtensionOrigin(req: express.Request): string | null {
  const queryValue = req.query.id;
  const fromQuery = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  const normalizedFromQuery = normalizeExtensionId(typeof fromQuery === "string" ? fromQuery : null);
  if (normalizedFromQuery) {
    return normalizedFromQuery;
  }

  const headerOrigin = typeof req.headers.origin === "string" ? req.headers.origin : null;
  if (headerOrigin?.startsWith("chrome-extension://")) {
    return headerOrigin.toLowerCase();
  }

  return null;
}

function normalizeExtensionId(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (/^[a-p]{32}$/.test(trimmed)) {
    return `chrome-extension://${trimmed}`;
  }
  if (trimmed.startsWith("chrome-extension://")) {
    return trimmed;
  }
  return null;
}
