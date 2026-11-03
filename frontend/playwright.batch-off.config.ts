import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({ ...config, testMatch: '**/batch-default-off.ts',
  outputDir: '../local_docs/task-10-artifacts/e2e-off',
  reporter: [['list'], ['json', { outputFile: '../local_docs/task-10-artifacts/e2e-off-results.json' }]],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4179 --strictPort',
    env: { VITE_ENABLE_CHECKPOINT_BATCH: 'false' }, url: 'http://127.0.0.1:4179', reuseExistingServer: false, timeout: 30_000,
  },
});
