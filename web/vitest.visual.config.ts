import { defineConfig } from "vitest/config";

// The visual contrast audit (visual/audit.visual.ts): real WebKit via
// Playwright, so node environment, long timeouts, and one file at a time.
// Kept out of the default config so `npm test` stays fast.
export default defineConfig({
    test: {
        environment: "node",
        include: ["visual/**/*.visual.ts"],
        testTimeout: 120_000,
        hookTimeout: 60_000,
        fileParallelism: false,
    },
});
