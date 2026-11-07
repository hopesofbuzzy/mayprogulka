import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  outputDir: '../local_docs/task-05-artifacts/e2e',
  reporter: [['list'], ['json', { outputFile: '../local_docs/task-05-artifacts/e2e-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4179',
    browserName: 'chromium',
    serviceWorkers: 'block',
    trace: 'off', // Network traces/HAR can contain credentials; keep them off.
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
    { name: 'compact', use: { viewport: { width: 360, height: 800 } } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 } } },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4179 --strictPort --mode e2e',
    env: { VITE_ENABLE_CHECKPOINT_BATCH: 'true' },
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
