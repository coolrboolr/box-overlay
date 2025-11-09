export const SCHEMA_VERSION = 1 as const;
export const MEMORY_SCHEMA_VERSION = 1 as const;

export interface ItemSourceMeta {
  profileName?: string;
  anchorTag?: string;
  anchorStrategy?: string;
}

export interface ItemAnalysisRequest {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  text: string;
  image?: string;
  sourceMeta?: ItemSourceMeta;
}

export interface ItemAnalysisResponse {
  id: string;
  summary: string;
  image_tag?: string;
  is_ad: boolean;
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
  | { id: string; result: ItemAnalysisResponse }
  | { id: string; error: AnalyzeError };

export interface BatchAnalysisResponse {
  schemaVersion: typeof SCHEMA_VERSION;
  results: BatchAnalysisResult[];
}

export interface MemoryIndexItem {
  id: string;
  sourceId?: string;
  text: string;
  url?: string;
  title?: string;
  contentType?: string;
  capturedAt?: string;
  language?: string;
  imageTag?: string;
  imageData?: string;
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
  | RuntimeMessageBase<"MEMORY_CAPTURE_NOW", { force?: boolean }>;
