import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/dashboard-web/**/*.test.tsx"],
    setupFiles: ["./src/dashboard-web/test-setup.ts"],
  },
});
