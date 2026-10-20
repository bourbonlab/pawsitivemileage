/** `{ulid}-` prefix the API adds to uploaded filenames so same-named uploads don't collide */
const UNIQUE_PREFIX = /^[0-9A-HJKMNP-TV-Z]{26}-/;

/**
 * Original filename of an uploaded photo/document from its S3 key.
 * Handles both `{user}/{vehicle}/{type}/{ulid}-{filename}` and the older
 * `{user}/{vehicle}/{type}/{filename}` keys.
 */
export function photoKeyFilename(key: string): string {
  const name = key.split('/').pop() ?? key;
  return name.replace(UNIQUE_PREFIX, '');
}
