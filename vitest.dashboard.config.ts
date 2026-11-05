import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

// Vite 5 resolves absolute setup files against cwd as well as root on Windows.
// Normalize a junction entry point before the test server builds its filesystem allowlist.
process.chdir(realpathSync(process.cwd()));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/dashboard-web/**/*.test.{ts,tsx}"],
    setupFiles: [fileURLToPath(new URL("./src/dashboard-web/test-setup.ts", import.meta.url))],
  },
});
