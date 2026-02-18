import { describe, it, expect } from 'vitest';
import {
  validateRequired,
  validateTypes,
  validateRange,
  parseBody,
  validateStringLength,
  validateCoordinates,
  sanitizeFilename,
} from '../../src/lib/validation';

describe('validateRequired', () => {
  it('returns no errors when all fields are present', () => {
    const body = { name: 'Test', age: 25 };
    expect(validateRequired(body, ['name', 'age'])).toEqual([]);
  });

  it('returns errors for missing fields', () => {
    const errors = validateRequired({}, ['name', 'email']);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual({ field: 'name', message: 'name is required' });
    expect(errors[1]).toEqual({ field: 'email', message: 'email is required' });
  });

  it('treats null as missing', () => {
    const errors = validateRequired({ name: null }, ['name']);
    expect(errors).toHaveLength(1);
  });

  it('treats empty string as missing', () => {
    const errors = validateRequired({ name: '' }, ['name']);
    expect(errors).toHaveLength(1);
  });

  it('accepts zero and false as present', () => {
    const body = { count: 0, active: false };
    expect(validateRequired(body, ['count', 'active'])).toEqual([]);
  });
});

describe('validateTypes', () => {
  it('returns no errors when types match', () => {
    const body = { name: 'Test', age: 25, active: true };
    const schema = { name: 'string' as const, age: 'number' as const, active: 'boolean' as const };
    expect(validateTypes(body, schema)).toEqual([]);
  });

  it('returns errors for type mismatches', () => {
    const body = { age: 'not a number' };
    const errors = validateTypes(body, { age: 'number' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({ field: 'age', message: 'age must be a number' });
  });

  it('skips undefined fields', () => {
    expect(validateTypes({}, { name: 'string' })).toEqual([]);
  });

  it('skips null fields', () => {
    expect(validateTypes({ name: null }, { name: 'string' })).toEqual([]);
  });
});

describe('validateRange', () => {
  it('returns no errors when values are in range', () => {
    const body = { age: 25 };
    expect(validateRange(body, { age: { min: 0, max: 150 } })).toEqual([]);
  });

  it('returns error when value is below min', () => {
    const errors = validateRange({ age: -1 }, { age: { min: 0 } });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('age must be at least 0');
  });

  it('returns error when value exceeds max', () => {
    const errors = validateRange({ age: 200 }, { age: { max: 150 } });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('age must be at most 150');
  });

  it('rejects Infinity', () => {
    const errors = validateRange({ val: Infinity }, { val: { min: 0 } });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('val must be a finite number');
  });

  it('rejects NaN', () => {
    const errors = validateRange({ val: NaN }, { val: { min: 0 } });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('val must be a finite number');
  });

  it('skips non-number values', () => {
    expect(validateRange({ val: 'hello' }, { val: { min: 0 } })).toEqual([]);
  });

  it('accepts boundary values (inclusive)', () => {
    expect(validateRange({ val: 0 }, { val: { min: 0, max: 100 } })).toEqual([]);
    expect(validateRange({ val: 100 }, { val: { min: 0, max: 100 } })).toEqual([]);
  });
});

describe('parseBody', () => {
  it('parses valid JSON', () => {
    expect(parseBody('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('returns null for null input', () => {
    expect(parseBody(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseBody(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseBody('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseBody('{bad json}')).toBeNull();
  });

  it('returns null when body exceeds maxBytes', () => {
    const bigBody = JSON.stringify({ data: 'x'.repeat(100_000) });
    expect(parseBody(bigBody, 1000)).toBeNull();
  });

  it('accepts body within maxBytes', () => {
    const body = JSON.stringify({ ok: true });
    expect(parseBody(body, 1000)).toEqual({ ok: true });
  });

  it('uses default maxBytes of 65536', () => {
    const body = JSON.stringify({ data: 'x'.repeat(60_000) });
    expect(parseBody(body)).not.toBeNull();

    const tooBig = JSON.stringify({ data: 'x'.repeat(70_000) });
    expect(parseBody(tooBig)).toBeNull();
  });
});

describe('validateStringLength', () => {
  it('returns no errors when strings are within limits', () => {
    expect(validateStringLength({ name: 'hi' }, { name: 10 })).toEqual([]);
  });

  it('returns error when string exceeds limit', () => {
    const errors = validateStringLength({ name: 'a'.repeat(300) }, { name: 255 });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('name must be at most 255 characters');
  });

  it('skips non-string values', () => {
    expect(validateStringLength({ count: 12345 }, { count: 3 })).toEqual([]);
  });

  it('accepts string at exact limit', () => {
    expect(validateStringLength({ name: 'abc' }, { name: 3 })).toEqual([]);
  });
});

describe('validateCoordinates', () => {
  it('returns no errors for valid coordinates', () => {
    expect(validateCoordinates({ locationLat: 38.5, locationLng: -77.3 })).toEqual([]);
  });

  it('rejects latitude out of range', () => {
    const errors = validateCoordinates({ locationLat: 91 });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('locationLat must be between -90 and 90');
  });

  it('rejects latitude below -90', () => {
    const errors = validateCoordinates({ locationLat: -91 });
    expect(errors).toHaveLength(1);
  });

  it('rejects longitude out of range', () => {
    const errors = validateCoordinates({ locationLng: 181 });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('locationLng must be between -180 and 180');
  });

  it('rejects longitude below -180', () => {
    const errors = validateCoordinates({ locationLng: -181 });
    expect(errors).toHaveLength(1);
  });

  it('rejects non-finite latitude', () => {
    const errors = validateCoordinates({ locationLat: NaN });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('locationLat must be a finite number');
  });

  it('rejects non-finite longitude', () => {
    const errors = validateCoordinates({ locationLng: Infinity });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('locationLng must be a finite number');
  });

  it('rejects non-number latitude', () => {
    const errors = validateCoordinates({ locationLat: 'north' });
    expect(errors).toHaveLength(1);
  });

  it('skips when coordinates are not present', () => {
    expect(validateCoordinates({})).toEqual([]);
  });

  it('skips null coordinates', () => {
    expect(validateCoordinates({ locationLat: null, locationLng: null })).toEqual([]);
  });

  it('skips undefined coordinates', () => {
    expect(validateCoordinates({ locationLat: undefined })).toEqual([]);
  });

  it('accepts boundary values', () => {
    expect(validateCoordinates({ locationLat: 90, locationLng: 180 })).toEqual([]);
    expect(validateCoordinates({ locationLat: -90, locationLng: -180 })).toEqual([]);
  });
});

describe('sanitizeFilename', () => {
  it('returns a clean filename unchanged', () => {
    expect(sanitizeFilename('photo.jpg')).toBe('photo.jpg');
  });

  it('strips path separators', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('....etcpasswd');
  });

  it('strips backslash separators', () => {
    expect(sanitizeFilename('C:\\Users\\file.txt')).toBe('CUsersfile.txt');
  });

  it('removes disallowed characters', () => {
    expect(sanitizeFilename('file<>:"|?*.jpg')).toBe('file.jpg');
  });

  it('trims whitespace', () => {
    expect(sanitizeFilename('  photo.jpg  ')).toBe('photo.jpg');
  });

  it('truncates to 255 characters', () => {
    const longName = 'a'.repeat(300) + '.jpg';
    const result = sanitizeFilename(longName);
    expect(result!.length).toBe(255);
  });

  it('returns null for empty result after sanitization', () => {
    expect(sanitizeFilename('///\\\\///')).toBeNull();
  });

  it('returns null for only special characters', () => {
    expect(sanitizeFilename('<>:"|?*')).toBeNull();
  });

  it('preserves spaces in filenames', () => {
    expect(sanitizeFilename('my photo 2024.jpg')).toBe('my photo 2024.jpg');
  });

  it('preserves hyphens and underscores', () => {
    expect(sanitizeFilename('my-photo_2024.jpg')).toBe('my-photo_2024.jpg');
  });
});
