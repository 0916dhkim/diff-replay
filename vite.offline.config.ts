import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "web",
  plugins: [solid()],
  build: {
    outDir: "../dist/public",
    emptyOutDir: false,
    rollupOptions: {
      input: "web/offline.html",
      output: { codeSplitting: false },
    },
  },
});
