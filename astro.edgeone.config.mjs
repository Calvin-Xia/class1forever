// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';

/** The build script mirrors the page tree here without API routes or middleware. */
export default defineConfig({
    // Astro derives .astro/ from root; this also isolates generated types from CF.
    root: fileURLToPath(new URL('./.edgeone-build/', import.meta.url)),
    output: 'static',
    srcDir: fileURLToPath(new URL('./.edgeone-build/src/', import.meta.url)),
    publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
    outDir: fileURLToPath(new URL('./dist-edgeone/static/', import.meta.url)),
    cacheDir: fileURLToPath(new URL('./.edgeone-build/cache/', import.meta.url)),
    integrations: [react()],
    // Build-time environment files are not inputs to the static page shell.
    vite: { envDir: fileURLToPath(new URL('./.edgeone-build/env/', import.meta.url)), build: { assetsInlineLimit: 0 } }
});
