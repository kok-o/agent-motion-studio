export class StudioError extends Error {
  constructor(public code: string, public stage: string, message: string, public exitCode = 2, public field?: string) { super(message); }
}
export function normalizeError(error: unknown) {
  const value = error instanceof StudioError ? error : new StudioError('INTERNAL_ERROR', 'render', error instanceof Error ? error.message : String(error), 4);
  return { exitCode: value.exitCode, error: { code: value.code, stage: value.stage, message: value.message, ...(value.field ? { field: value.field } : {}) } };
}
