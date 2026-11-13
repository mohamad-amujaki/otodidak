/// <reference types="astro/client" />
/// <reference types="@clerk/astro/env" />

declare namespace App {
  interface Locals {
    csrf: string;
  }
}

interface Env {
  PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
}

declare module 'virtual:astro-cloudflare:config' {
  export const compileImageConfig: null;
  export const isPrerender: boolean;
  export const loadPrerenderScope: undefined;
  export const cacheProviderEnabled: boolean;
}
