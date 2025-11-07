declare const __LLM_OVERLAY_DEV__: boolean | undefined;

declare const process: {
  env?: {
    NODE_ENV?: string;
  };
};

const hasInjectedFlag = typeof __LLM_OVERLAY_DEV__ !== "undefined";

export const isDev =
  hasInjectedFlag
    ? (__LLM_OVERLAY_DEV__ as boolean)
    : typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
