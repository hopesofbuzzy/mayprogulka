import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({ ...config, testMatch: '**/normal-runtime.ts',
  outputDir: '../local_docs/task-11-artifacts/normal-e2e',
  reporter: [['list'], ['json', { outputFile: '../local_docs/task-11-artifacts/normal-results.json' }]],
  use: { ...config.use, baseURL: 'http://127.0.0.1:4181' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4181 --strictPort --mode development',
    env: { VITE_ENABLE_CHECKPOINT_BATCH: 'true' },
    url: 'http://127.0.0.1:4181', reuseExistingServer: false, timeout: 30_000,
  },
});
