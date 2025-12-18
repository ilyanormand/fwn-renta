import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Where to find tests? (files ending with .test.ts)
    include: ["app/services/unitTest/tests/**/*.test.ts"],

    // What environment? (Node.js for server code)
    environment: "node",

    // Automatically available describe, it, expect
    globals: true,
  },
});
