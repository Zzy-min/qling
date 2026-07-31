import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  root: resolve(rootDir, "src/dashboard-web"),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(rootDir, "dist/dashboard-web"),
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      output: {
        entryFileNames: "assets/dashboard.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: ({ names }) =>
          names?.some((name) => name.endsWith(".css"))
            ? "assets/dashboard.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
