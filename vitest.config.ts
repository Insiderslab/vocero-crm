import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Como Next: JSX automático, para poder renderizar componentes en los tests.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
