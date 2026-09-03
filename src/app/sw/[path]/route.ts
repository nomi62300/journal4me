import { createSerwistRoute } from "@serwist/turbopack";

// Serves the service worker, bundled from app/sw.ts at request time by
// esbuild, under /sw/sw.js — the only way to get a custom (push-handling)
// service worker out of Turbopack, which @serwist/next's webpack plugin
// cannot run under. See next.config.ts's comment for the full story.
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "src/app/sw.ts",
    // This package defaults to esbuild-wasm on non-Windows, which is a
    // second bundler this app has no other use for. Native esbuild (added
    // as a direct dependency) does the same job without it.
    useNativeEsbuild: true,
  });
