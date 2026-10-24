export class FulfillmentError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status = 422, retryable = false) {
    super(message);
    this.name = 'FulfillmentError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function assert(condition: unknown, code: string, message: string, status = 422): asserts condition {
  if (!condition) throw new FulfillmentError(code, message, status);
}

export function parseObject(value: unknown): Record<string, unknown> {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), 'INVALID_INPUT', 'Expected a JSON object.', 400);
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, name: string, max = 200): string {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'INVALID_INPUT', `Invalid ${name}.`, 400);
  return value;
}

export function requiredRevision(value: unknown): number {
  assert(Number.isSafeInteger(value) && (value as number) >= 0, 'INVALID_INPUT', 'Invalid expectedRevision.', 400);
  return value as number;
}

export function errorResponse(error: unknown): Response {
  const id = crypto.randomUUID();
  const known = error instanceof FulfillmentError;
  return Response.json({ error: {
    code: known ? error.code : 'INTERNAL_ERROR',
    message: known ? error.message : 'The request could not be completed.',
    retryable: known ? error.retryable : false,
  }, requestId: id }, { status: known ? error.status : 500, headers: { 'Cache-Control': 'private, no-store' } });
}
