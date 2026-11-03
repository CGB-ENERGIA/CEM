import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    // Duas entradas: o sistema administrativo (/) e o app de campo (/campo/), cada um com seu PWA.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        campo: fileURLToPath(new URL("campo/index.html", import.meta.url)),
      },
    },
  },
});
