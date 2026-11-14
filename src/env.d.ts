/// <reference types="astro/client" />
/// <reference types="@clerk/astro/env" />

declare namespace App {
  interface Locals {
    csrf: string;
  }
}

declare namespace Cloudflare {
  interface Env {
    /** Legacy var; prefer PUBLIC_CLERK_PUBLISHABLE_KEY secret. */
    CLERK_PUBLISHABLE_KEY?: string;
  }
}

declare module 'virtual:astro-cloudflare:config' {
  export const compileImageConfig: null;
  export const isPrerender: boolean;
  export const loadPrerenderScope: undefined;
  export const cacheProviderEnabled: boolean;
}
