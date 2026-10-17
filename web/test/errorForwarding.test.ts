import { describe, it, expect, vi } from "vitest";
import { formatErrorEvent, formatRejection, wireErrorForwarding, MAX_FORWARDED } from "../src/errorForwarding.js";

/** jsdom has no `PromiseRejectionEvent`; the listener only reads `.reason`. */
function rejectionEvent(reason: unknown): Event {
    return Object.assign(new Event("unhandledrejection"), { reason });
}

describe("formatErrorEvent", () => {
    it("includes message, location and the error's stack", () => {
        const error = new TypeError("x is undefined");
        error.stack = "TypeError: x is undefined\n    at f (mdviewer.js:10:5)";
        const text = formatErrorEvent({ message: "TypeError: x is undefined", filename: "tauri://localhost/mdviewer.js", lineno: 10, colno: 5, error });
        expect(text).toBe("error: TypeError: x is undefined (tauri://localhost/mdviewer.js:10:5)\nTypeError: x is undefined\n    at f (mdviewer.js:10:5)");
    });

    it("omits location and stack when the event has neither", () => {
        expect(formatErrorEvent({ message: "Script error.", filename: "", lineno: 0, colno: 0, error: null })).toBe("error: Script error.");
    });

    it("truncates a runaway message", () => {
        const text = formatErrorEvent({ message: "x".repeat(5000), filename: "", lineno: 0, colno: 0, error: null });
        expect(text.length).toBeLessThan(2100);
        expect(text.endsWith("… [truncated]")).toBe(true);
    });
});

describe("formatRejection", () => {
    it("formats an Error reason with its stack", () => {
        const error = new Error("boom");
        error.stack = "Error: boom\n    at g";
        expect(formatRejection(error)).toBe("unhandled rejection: boom\nError: boom\n    at g");
    });

    it("formats string, object and unserializable reasons", () => {
        expect(formatRejection("access_denied: nope")).toBe("unhandled rejection: access_denied: nope");
        expect(formatRejection({ code: 3 })).toBe('unhandled rejection: {"code":3}');
        expect(formatRejection(undefined)).toBe("unhandled rejection: undefined");
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(formatRejection(cyclic)).toBe("unhandled rejection: [object Object]");
    });
});

describe("wireErrorForwarding", () => {
    it("forwards both error events and unhandled rejections", () => {
        const target = new EventTarget();
        const send = vi.fn(() => Promise.resolve());
        wireErrorForwarding(target, send);

        target.dispatchEvent(new ErrorEvent("error", { message: "bad" }));
        target.dispatchEvent(rejectionEvent("worse"));

        expect(send.mock.calls).toEqual([["error: bad"], ["unhandled rejection: worse"]]);
    });

    it("caps a flood at MAX_FORWARDED plus one suppression line", () => {
        const target = new EventTarget();
        const send = vi.fn(() => Promise.resolve());
        wireErrorForwarding(target, send);

        for (let i = 0; i < MAX_FORWARDED + 20; i++) {
            target.dispatchEvent(new ErrorEvent("error", { message: `e${i}` }));
        }

        expect(send).toHaveBeenCalledTimes(MAX_FORWARDED + 1);
        expect(send).toHaveBeenLastCalledWith(`further errors suppressed after ${MAX_FORWARDED}`);
    });

    it("swallows a send that rejects or throws, so forwarding can't feed itself", async () => {
        const target = new EventTarget();
        const rejecting = vi.fn(() => Promise.reject(new Error("ipc down")));
        wireErrorForwarding(target, rejecting);
        expect(() => target.dispatchEvent(new ErrorEvent("error", { message: "a" }))).not.toThrow();
        await Promise.resolve(); // let the rejection settle — vitest fails on an unhandled one

        const other = new EventTarget();
        const throwing = vi.fn(() => {
            throw new Error("no __TAURI__");
        });
        wireErrorForwarding(other, throwing);
        expect(() => other.dispatchEvent(new ErrorEvent("error", { message: "b" }))).not.toThrow();
    });
});
