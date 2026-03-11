import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/cli/**",
        "src/setup.ts",
        "src/oauth/**",
      ],
    },
    testTimeout: 10_000,
  },
});
