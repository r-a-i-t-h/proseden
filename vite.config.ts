import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    outDir: "public",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        styles: resolve(__dirname, "client/styles.css"),
        panel: resolve(__dirname, "client/panel.ts"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
