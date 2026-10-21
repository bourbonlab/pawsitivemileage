import { describe, it, expect } from 'vitest';
import { parseBody, sanitizeFilename } from '../../src/lib/validation';

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
