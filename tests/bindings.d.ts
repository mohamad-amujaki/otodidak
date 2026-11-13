/// <reference path="../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />

declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
  }
}
