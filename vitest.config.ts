import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/entry.ts',
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          CLERK_SECRET_KEY: 'mock',
          BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
          SUMOPOD_API_KEY: 'mock',
          SUMOPOD_WEBHOOK_SECRET:
            'whsec_b3RvZGlkYWstdGVzdC13ZWJob29rLXNlY3JldC1rZXk=',
          SUMOPOD_API_BASE: 'https://api-pay-sandbox.sumopod.com/api/v1',
          OPENAI_API_KEY: 'mock',
          YOUTUBE_API_KEY: 'mock',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false,
  },
});
