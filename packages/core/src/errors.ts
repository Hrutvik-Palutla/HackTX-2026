import type { ApiErr, ErrorCode } from '@hacktx/contracts';

const STATUS: Record<ErrorCode, number> = {
  STALE_PLAN: 409, FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400, UNRESOLVED: 422,
  BUDGET_LIMIT: 429, QUOTA_LIMIT: 429, PROVIDER: 502, INTERNAL: 500,
};

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public retryable = false) {
    super(message);
  }
  get status() { return STATUS[this.code]; }
  toBody(requestId: string): ApiErr {
    return { error: { code: this.code, message: this.message, retryable: this.retryable }, requestId };
  }
}

export const stale = (msg = 'Plan changed; reload and retry') => new AppError('STALE_PLAN', msg, true);
// Generic 404 for anything the caller may not see: never reveal existence.
export const notFound = () => new AppError('NOT_FOUND', 'Not found');
export const invalid = (msg: string) => new AppError('INVALID', msg);
export const forbidden = (msg = 'Forbidden') => new AppError('FORBIDDEN', msg);
