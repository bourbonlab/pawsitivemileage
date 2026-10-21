import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'infra',
    environment: 'node',
    // Only the TypeScript sources: `tsc` output in dist/test/ would otherwise run as duplicates
    include: ['test/**/*.test.ts'],
  },
});
