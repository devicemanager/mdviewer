import { describe, it, expect } from "vitest";
import { resolveEmoji } from "../src/emoji.js";

describe("resolveEmoji", () => {
    it("resolves a simple word shortcode", () => {
        expect(resolveEmoji("I :heart: this")).toBe("I ❤ this");
    });

    it("resolves underscore shortcodes", () => {
        expect(resolveEmoji(":white_check_mark: done")).toBe("✔️ done");
    });

    it("resolves the +1 / -1 shortcodes", () => {
        // These are extremely common GitHub shortcodes and must work.
        expect(resolveEmoji(":+1:")).toBe("👍");
        expect(resolveEmoji(":-1:")).toBe("✖️");
    });

    it("leaves unknown shortcodes untouched", () => {
        expect(resolveEmoji(":not_a_real_code:")).toBe(":not_a_real_code:");
    });

    it("resolves multiple shortcodes in one string", () => {
        expect(resolveEmoji(":rocket: to :star:")).toBe("🚀 to ⭐");
    });
});
