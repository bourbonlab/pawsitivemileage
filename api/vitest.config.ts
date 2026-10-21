import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.property.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/handlers/**/*.ts'],
    },
  },
});
