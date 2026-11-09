import { defineConfig } from 'vitest/config';
import path from 'node:path';

const alias = { '@': path.resolve(__dirname, '.') };

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'security',
          include: ['tests/security/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'contract',
          include: ['tests/contract/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'lib/auth/**/*.ts',
        'lib/validation/**/*.ts',
        'lib/security/**/*.ts',
        'lib/storage/**/*.ts',
        'lib/lessons/**/*.ts',
        'lib/materials/**/*.ts',
        'lib/http/**/*.ts',
      ],
      exclude: ['**/*.d.ts', 'lib/**/index.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        'lib/auth/**/*.ts': { branches: 100 },
        'lib/validation/**/*.ts': { branches: 100 },
        'lib/security/sanitize.ts': { branches: 100 },
        'lib/security/upload-rate-limit.ts': { branches: 100 },
        'lib/storage/verify-object.ts': { branches: 100 },
      },
    },
  },
});
