import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
// vitest/config re-exports vite's defineConfig with the `test` key typed, which
// is what lets one file configure both the dev server and the test runner.
import { defineConfig } from "vitest/config";

const API_TARGET = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      // The API is never cached: compliance data must always be live, and the
      // audit trail must never be served from a stale cache.
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/health$/],
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
      manifest: {
        name: "ComplyTrack — Statutory Compliance Management",
        short_name: "ComplyTrack",
        description:
          "Track statutory licences, certificates and filings, their renewals, reminders and audit trail.",
        theme_color: "#0f4c81",
        background_color: "#f6f8fb",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        categories: ["business", "productivity"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    // Same-origin in development, so the browser never needs CORS.
    proxy: { "/api": { target: API_TARGET, changeOrigin: true } },
    watch: {
      // Playwright writes screenshots and traces into these directories while
      // the dev server is serving the test run. Left watched, every artifact
      // the runner writes is a file change, which Vite answers with a full
      // page reload — the test then re-triggers the artifact and the page
      // reloads forever. Nothing here is source.
      ignored: [
        "**/e2e/.artifacts/**",
        "**/e2e/.report/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          query: ["@tanstack/react-query", "@tanstack/react-table"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/main.tsx"],
    },
  },
});
