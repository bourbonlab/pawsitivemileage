import { describe, it, expect } from 'vitest';
import { ApiError } from '../../src/api/client';

describe('ApiError', () => {
  it('creates an error with all properties', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'Vehicle not found', 'req-123');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Vehicle not found');
    expect(err.requestId).toBe('req-123');
  });

  it('works without requestId', () => {
    const err = new ApiError(500, 'INTERNAL_ERROR', 'Something broke');

    expect(err.status).toBe(500);
    expect(err.requestId).toBeUndefined();
  });

  it('has a proper stack trace', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'Bad input');
    expect(err.stack).toBeDefined();
  });
});
