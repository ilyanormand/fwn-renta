import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Где искать тесты? (файлы, заканчивающиеся на .test.ts)
    include: ["app/services/unityTest2/tests/**/*.test.ts"],

    // Какое окружение? (Node.js для серверного кода)
    environment: "node",

    // Автоматически доступны describe, it, expect
    globals: true,
  },
});
