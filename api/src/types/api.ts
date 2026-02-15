export interface ApiErrorResponse {
  statusCode: number;
  body: {
    error: string;
    code: string;
    requestId: string;
  };
}

export interface ApiSuccessResponse<T = unknown> {
  statusCode: number;
  body: {
    data: T;
    requestId: string;
  };
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';
