import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

// @serwist/next (webpack-plugin based) does not work under Turbopack, the
// default and only bundler in Next.js 16 (AGENTS.md: "Turbopack is the
// default bundler"). @serwist/turbopack is the maintained replacement: it
// serves the built service worker through a Route Handler
// (app/sw/[...path]/route.ts) instead of hooking into the bundler, so it
// needs no webpack() config here — just the serverExternalPackages this
// adds for esbuild/esbuild-wasm, which bundle the worker at request time.
const nextConfig: NextConfig = {
  /* config options here */
};

export default withSerwist(nextConfig);
