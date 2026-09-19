import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './regressions',
  testMatch: '**/*.spec.ts',
  timeout: 30000,
  expect: { timeout: 7000 },
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json']],
  outputDir: process.env.CZ_TEST_OUTPUT_DIR || '.data/test-results',
  use: { headless: true, viewport: { width: 1100, height: 760 } },
});
