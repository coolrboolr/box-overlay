export const SCHEMA_VERSION = 1 as const;
export const MEMORY_SCHEMA_VERSION = 1 as const;

export type ImageRef =
  | { kind: "tag"; tag: string }
  | { kind: "dataUri"; data: string }
  | { kind: "url"; url: string };

export interface ItemSourceMeta {
  profileName?: string;
  anchorTag?: string;
  anchorStrategy?: string;
}

export interface ItemAnalysisRequest {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  text: string;
  image?: ImageRef;
  sourceMeta?: ItemSourceMeta;
}

export interface ItemAnalysisResponse {
  id: string;
  summary: string;
  image?: ImageRef;
  isAd: boolean;
}

export interface AnalyzeError {
  id: string;
  error: string;
  retryable: boolean;
  statusCode?: number;
  details?: string;
}

export type DevTelemetryEventName = "FORBIDDEN_RECOVERY" | "BATCH_FALLBACK";

export interface DevTelemetryEventPayload {
  event: DevTelemetryEventName;
  detail?: Record<string, unknown>;
}

export interface BatchAnalysisRequest {
  schemaVersion: typeof SCHEMA_VERSION;
  items: ItemAnalysisRequest[];
}

export type BatchAnalysisResult =
  | { kind: "ok"; id: string; result: ItemAnalysisResponse }
  | { kind: "err"; id: string; error: AnalyzeError };

export interface BatchAnalysisResponse {
  schemaVersion: typeof SCHEMA_VERSION;
  results: BatchAnalysisResult[];
}

export interface MemoryIndexItem {
  id: string;
  parentId?: string;
  sourceId?: string;
  text: string;
  url?: string;
  title?: string;
  contentType?: string;
  capturedAt?: string;
  language?: string;
  image?: ImageRef;
  entityType?: string;
  conceptIds?: string[];
  relations?: Array<{ type: string; targetId: string }>;
  tags?: string[];
}

export interface MemoryIndexRequest {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION;
  items: MemoryIndexItem[];
  flush?: boolean;
}

export interface MemoryIndexResult {
  id: string;
  status: "indexed" | "duplicate" | "failed";
  message?: string;
  storedIds?: string[];
  duplicateOf?: string;
}

export interface MemoryIndexResponse {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION;
  counts: {
    indexed: number;
    duplicate: number;
    failed: number;
  };
  results: MemoryIndexResult[];
}

export interface MemoryQueryFilters {
  domain?: string;
  domains?: string[];
  since?: string;
  until?: string;
  limit?: number;
  entityTypes?: string[];
  conceptIds?: string[];
}

export interface MemoryQueryRequestMessage {
  query: string;
  topK?: number;
  filters?: MemoryQueryFilters;
}

export interface MemoryQueryHit {
  id: string;
  parentId: string;
  sourceId?: string;
  url?: string;
  title?: string;
  snippet: string;
  capturedAt?: string;
  contentType?: string;
  language?: string;
  entityType?: string;
  conceptIds?: string[];
  relations?: Array<{ type: string; targetId: string }>;
  tags?: string[];
  sourceDomain?: string;
  similarity: number;
}

export interface MemoryQueryResponseMessage {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION;
  results: MemoryQueryHit[];
  answer?: {
    text: string;
    sources: string[];
    sourceIds?: string[];
  };
}

export interface MemoryQueryErrorMessage {
  message: string;
}

interface RuntimeMessageBase<Type extends string, Payload = undefined> {
  type: Type;
  schemaVersion: typeof SCHEMA_VERSION;
  payload: Payload;
}

export type RuntimeMessage =
  | RuntimeMessageBase<"ANALYZE_REQUEST", ItemAnalysisRequest>
  | RuntimeMessageBase<"ANALYZE_RESULT", ItemAnalysisResponse>
  | RuntimeMessageBase<"ANALYZE_ERROR", AnalyzeError>
  | RuntimeMessageBase<"ANALYZE_BATCH_RESULT", BatchAnalysisResponse>
  | RuntimeMessageBase<"TOGGLE_OVERLAYS", undefined>
  | RuntimeMessageBase<"DEV_TELEMETRY_EVENT", DevTelemetryEventPayload>
  | RuntimeMessageBase<"DEV_FORCE_REGISTER", undefined>
  | RuntimeMessageBase<"MEMORY_INDEX_REQUEST", MemoryIndexRequest>
  | RuntimeMessageBase<"MEMORY_INDEX_RESULT", MemoryIndexResponse>
  | RuntimeMessageBase<"MEMORY_CAPTURE_NOW", { force?: boolean }>
  | RuntimeMessageBase<"MEMORY_QUERY", MemoryQueryRequestMessage>
  | RuntimeMessageBase<"MEMORY_QUERY_RESULT", MemoryQueryResponseMessage>
  | RuntimeMessageBase<"MEMORY_QUERY_ERROR", MemoryQueryErrorMessage>;
