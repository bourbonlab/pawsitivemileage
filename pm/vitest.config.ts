import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'pm',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
