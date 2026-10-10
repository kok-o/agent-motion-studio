export class StudioError extends Error {
  constructor(public code: string, public stage: string, message: string, public exitCode = 2, public field?: string) { super(message); }
}
export function normalizeError(error: unknown) {
  if (error instanceof StudioError) {
    return { exitCode: error.exitCode, error: { code: error.code, stage: error.stage, message: error.message, ...(error.field ? { field: error.field } : {}) } };
  }
  const err = error as NodeJS.ErrnoException | undefined;
  if (typeof (err as any)?.code === 'string' && (err as any).code.startsWith('ERR_PARSE_ARGS_')) {
    return { exitCode: 2, error: { code: 'INVALID_COMMAND', stage: 'input', message: err?.message || String(error) } };
  }
  const value = new StudioError('INTERNAL_ERROR', 'render', error instanceof Error ? error.message : String(error), 4);
  return { exitCode: value.exitCode, error: { code: value.code, stage: value.stage, message: value.message, ...(value.field ? { field: value.field } : {}) } };
}

