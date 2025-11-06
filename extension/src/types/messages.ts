export interface ItemAnalysisRequest {
  id: string;
  text: string;
  image?: string;
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
}

export type RuntimeMessage =
  | { type: "ANALYZE_REQUEST"; payload: ItemAnalysisRequest }
  | { type: "ANALYZE_RESULT"; payload: ItemAnalysisResponse }
  | { type: "ANALYZE_ERROR"; payload: AnalyzeError }
  | { type: "TOGGLE_OVERLAYS" };
