import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // jsdom gives us a DOM for the modules that operate on elements
        // (e.g. local-resource rewriting). Pure-string modules don't need it
        // but a single environment keeps the config simple.
        environment: "jsdom",
        include: ["test/**/*.test.ts"],
    },
});
