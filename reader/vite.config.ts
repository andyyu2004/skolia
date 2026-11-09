import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// The dev server forwards /api to skolia-api, so the reader and API share an origin.
// To try it on a phone on the same network: pnpm dev --host
// To read staging's texts without running the API: SKOLIA_API=https://staging.skolia.io pnpm dev
export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: { "/api": { target: process.env.SKOLIA_API ?? "http://127.0.0.1:8787", changeOrigin: true } },
  },
});
