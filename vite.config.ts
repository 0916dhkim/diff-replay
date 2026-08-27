import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  build: {
    emptyOutDir: true,
    outDir: "../dist/public",
  },
  server: {
    port: 7891,
    proxy: {
      "/api": "http://127.0.0.1:7890",
    },
  },
});
