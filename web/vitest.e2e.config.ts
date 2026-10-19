import { defineConfig } from "vitest/config";

// End-to-end behaviour tests (e2e/*.e2e.ts): the real app page in WebKit via
// Playwright, so node environment and one file at a time. Kept out of the
// default config so `npm test` stays fast.
export default defineConfig({
    test: {
        environment: "node",
        include: ["e2e/**/*.e2e.ts"],
        testTimeout: 60_000,
        hookTimeout: 60_000,
        fileParallelism: false,
    },
});
