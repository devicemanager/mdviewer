// Forwards uncaught JS errors and unhandled promise rejections to the
// native debug log (2026-10-17 — the Rust side, `debug_log.rs`, has the
// full story). On an OTA-installed iPhone there's no Safari Web Inspector
// either (it needs the same USB/pairing the crash logs do), so without
// this a frontend failure leaves no trace anywhere a person can read.
//
// No Swift source to port — new for the TypeScript port. Kept out of
// main.ts so the formatting and the flood cap are testable with plain
// `EventTarget`s and a fake `send`, same reasoning as toolbarAutoHide.ts;
// main.ts supplies the real `window` and the real `invoke`.

/** More than this many per page load and the rest are dropped after one
 * "suppressed" line — an error inside a scroll or resize handler would
 * otherwise write (and fsync) a line per frame. */
export const MAX_FORWARDED = 50;

/** Long enough for a message plus a short stack, short enough that one
 * runaway error string can't dominate the log. */
const MAX_MESSAGE_LENGTH = 2000;

export function formatErrorEvent(event: Pick<ErrorEvent, "message" | "filename" | "lineno" | "colno" | "error">): string {
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
    const stack = event.error instanceof Error && event.error.stack ? `\n${event.error.stack}` : "";
    return truncate(`error: ${event.message}${where}${stack}`);
}

export function formatRejection(reason: unknown): string {
    if (reason instanceof Error) {
        return truncate(`unhandled rejection: ${reason.message}${reason.stack ? `\n${reason.stack}` : ""}`);
    }
    let text: string;
    try {
        text = typeof reason === "string" ? reason : JSON.stringify(reason) ?? String(reason);
    } catch {
        text = String(reason);
    }
    return truncate(`unhandled rejection: ${text}`);
}

function truncate(text: string): string {
    return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}… [truncated]` : text;
}

/**
 * Listens on `target` (the real `window` in main.ts) for `error` and
 * `unhandledrejection` and hands each formatted message to `send`. A
 * failing `send` is swallowed — it must never itself raise an error that
 * this same listener would then try to forward.
 */
export function wireErrorForwarding(target: EventTarget, send: (message: string) => Promise<unknown>): void {
    let forwarded = 0;

    function forward(message: string): void {
        if (forwarded > MAX_FORWARDED) return;
        forwarded += 1;
        const text = forwarded > MAX_FORWARDED ? `further errors suppressed after ${MAX_FORWARDED}` : message;
        try {
            send(text).catch(() => {});
        } catch {
            // `send` threw synchronously (e.g. the Tauri global missing) —
            // nothing to log to, and nothing useful to do about it.
        }
    }

    target.addEventListener("error", (event) => {
        forward(formatErrorEvent(event as ErrorEvent));
    });
    target.addEventListener("unhandledrejection", (event) => {
        forward(formatRejection((event as PromiseRejectionEvent).reason));
    });
}
