# 2025-11 Schema Hardening Migration

## Overview
This release introduces stricter Zod schemas, ontology metadata, normalized image references, and persistence headers for the memory store. The server now stores `{ embedModelVersion, embedDimensions }` alongside each vector and enforces host-only domain filters. Memory queries accept concept/entity filters and the popup exposes matching chips.

## Breaking Changes
- Analyze responses now emit `image`/`isAd` (camelCase). Clients expecting `image_tag`/`is_ad` must decode legacy payloads or call `decodeWire`.
- Memory schemas pin `schemaVersion` literals. Old payloads must upgrade to `MEMORY_SCHEMA_VERSION = 1` literals before posting.
- Memory index text is capped at 4 000 chars and requires valid MIME/language codes.
- Image references travel through `ImageRefSchema`; raw base64/data URIs over 100 KB are rejected.
- `MemoryIndexResult.status="indexed"` requires `storedIds`; duplicates include `duplicateOf`.

## Legacy Compatibility
- `decodeWire/encodeWire` translate snake_case payloads so existing clients can continue sending `image_tag`/`is_ad` fields.
- `adaptLegacyBatchResult` maps `{result|error}` unions into the new discriminated union.
- `migrateLegacyMemoryFile` runs automatically when a store snapshot lacks the new headers. It backfills `entityType="unknown"`, computes `contentHash`, infers `sourceDomain`, and normalizes legacy `imageTag`/`imageData` fields.

## Field Casing Policy
Wire payloads remain camelCase (`API_WIRE_CASE=camel`). Legacy snake_case inputs are decoded, but all new responses emit camelCase keys.

## Image Model Changes
All image metadata flows through `ImageRefSchema` (`kind: "tag" | "dataUri" | "url"`). Requests containing deprecated `imageTag`/`imageData` fields are decoded into the new form; responses prefer `image` objects.

## Version Coordination
`SCHEMA_VERSION` and `MEMORY_SCHEMA_VERSION` use `z.literal(...)` defaults. When bumping either value, update both the extension constants and the server schema simultaneously so runtime messages parse cleanly.
