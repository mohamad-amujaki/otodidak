/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    csrf: string;
  }
}

declare module 'virtual:astro-cloudflare:config' {
  export const compileImageConfig: null;
  export const isPrerender: boolean;
  export const loadPrerenderScope: undefined;
  export const cacheProviderEnabled: boolean;
}
