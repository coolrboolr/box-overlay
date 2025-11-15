import { useMemo } from "react";

export interface OntologyContextSnapshot {
  pageUrl?: string;
  domain?: string;
  entities: Array<{ id: string; label: string; type?: string }>;
  relationships: Array<{ id: string; label?: string; type?: string }>;
}

/**
  * Lightweight placeholder hook that surfaces page/domain plus any stubbed ontology detail.
  * Real ontology wiring will replace this in later specs once capture pipelines are ready.
  */
export function useOntologyContext(): OntologyContextSnapshot {
  return useMemo(() => {
    const href = typeof window !== "undefined" ? window.location.href : undefined;
    const domain = href
      ? (() => {
          try {
            return new URL(href).hostname;
          } catch {
            return undefined;
          }
        })()
      : undefined;

    return {
      pageUrl: href,
      domain,
      entities: [],
      relationships: []
    };
  }, []);
}
