import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'input_not_found'
  | 'task_not_found'
  | 'file_in_use'
  | 'upload_too_large'
  | 'unsupported_format'
  | 'invalid_options'
  | 'import_failed'
  | 'checksum_mismatch'
  | 'render_failed'
  | 'queue_full'
  | 'render_timeout'
  | 'storage_full';

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: ContentfulStatusCode;
  public readonly details: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    status: ContentfulStatusCode,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createErrorResponse(
  c: Context,
  code: ErrorCode,
  message: string,
  status: ContentfulStatusCode,
  details: Record<string, unknown> = {},
) {
  return c.json<ApiErrorBody>(
    {
      code,
      message,
      details,
    },
    status,
  );
}
