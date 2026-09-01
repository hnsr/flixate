import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/flixate/" : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["flixate.svg", "tmdb.svg"],
      manifest: {
        name: "Flixate",
        short_name: "Flixate",
        description: "Find the next film or series worth watching.",
        theme_color: "#11130f",
        background_color: "#11130f",
        display: "standalone",
        start_url: ".",
        icons: [
          {
            src: "flixate.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith("/data/live/manifest.json"),
            handler: "NetworkFirst",
            options: {
              cacheName: "flixate-catalog-manifest",
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.endsWith("/data/catalog.fixture.json"),
            handler: "NetworkFirst",
            options: {
              cacheName: "flixate-core-catalog",
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => /\/data\/live\/catalog-[a-f0-9]+\.json\.gz\.bin$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "flixate-core-catalog",
              expiration: { maxEntries: 3, maxAgeSeconds: 60 * 60 * 24 * 45 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes("/data/synopsis/"),
            handler: "CacheFirst",
            options: {
              cacheName: "flixate-synopses",
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes("/data/live/synopsis/"),
            handler: "CacheFirst",
            options: {
              cacheName: "flixate-synopses",
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/image\.tmdb\.org\/t\/p\//,
            handler: "CacheFirst",
            options: {
              cacheName: "tmdb-posters",
              expiration: { maxEntries: 160, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    exclude: ["test/e2e/**", "node_modules/**", "dist/**"],
    css: true,
  },
});
