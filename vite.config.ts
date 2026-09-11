import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "web",
  plugins: [solid()],
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
