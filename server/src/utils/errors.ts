export function formatErrorDetails(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }
  return error;
}
