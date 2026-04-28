import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    // Default to node; individual test files may override with
    // @vitest-environment jsdom (or happy-dom) at the top of the file.
    environment: "node",
    include: [
      "src/**/__tests__/**/*.test.ts",
      "src/**/__tests__/**/*.test.tsx",
    ],
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
});
