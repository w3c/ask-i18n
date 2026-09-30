import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { defineConfig } from '@playwright/test';

// Workers inherit this path so every process in one run shares its artifacts.
const runDirectory = process.env.ASK_I18N_E2E_RUN_DIR ||= resolve('.data/e2e', randomUUID());

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  outputDir: join(runDirectory, 'test-results'),
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: join(runDirectory, 'report') }]
  ],
  use: {
    screenshot: 'only-on-failure',
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } }
  ],
  webServer: {
    command: 'npm run index -- --source-mode=local --source-repo-path=tests/fixtures/i18n-mini && npm start',
    wait: {
      stdout: /Ask W3C i18n listening at http:\/\/127\.0\.0\.1:(?<ask_i18n_e2e_port>\d+)/
    },
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      PORT: '0',
      INDEX_PATH: join(runDirectory, 'index.json'),
      QUERY_LOG_PATH: join(runDirectory, 'query-log.jsonl'),
      SOURCE_MODE: 'local',
      SOURCE_REPO_PATH: 'tests/fixtures/i18n-mini',
      SOURCES: '',
      MODEL_PROVIDER: 'local',
      BASE_PATH: '',
      SOURCE_REFRESH_MODE: 'manual',
      IS_PULL_REQUEST: 'false',
      ADMIN_TOKEN: '',
      TRUSTED_PROXIES: '',
      RATE_LIMIT_MAX: '10000'
    }
  }
});
