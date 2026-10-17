// Out-of-band debug log for builds installed over OTA (2026-10-17, the
// user's request). The real-device "starts and immediately crashes" report
// stayed undiagnosed for weeks because the only ways to read a phone's
// console or crash logs (Xcode, `idevicesyslog`, `idevicecrashreport`) all
// need USB, and USB debugging isn't available in this workflow. So the app
// writes its own log into its own Documents folder, which
// `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` (see
// configure-ios-project.sh) expose in the Files app under
// On My iPhone → MDViewer — from there it can be AirDropped or shared off
// the phone with no cable at all.
//
// What this can and can't catch: Rust panics (via the panic hook below —
// message, location and backtrace), plus breadcrumbs `lib.rs` writes at
// each startup step, flushed to disk line by line, so after a hard crash
// the *last* line says how far startup got even when the crash itself was
// native (Swift/ObjC/WebKit) and left no message here. The native crash
// report itself is iOS's own `.ips` file (Settings → Privacy & Security →
// Analytics & Improvements → Analytics Data), which this complements
// rather than replaces.
//
// iOS-only on purpose: desktop has a terminal and Android has `adb
// logcat`. Everywhere else `init_for_platform` doesn't open anything and
// `log` is a no-op.
//
// And debug builds only (the user's call, 2026-10-17, ahead of the first
// App Store submission): OTA dev builds are debug and keep logging; the
// App Store build is release and writes nothing, since the log puts file
// paths into a folder the user can see.

// Off iOS, and in release builds, nothing ever calls `init_in`, so
// everything it reaches is dead code there — expected, not a leftover.
#![cfg_attr(not(all(target_os = "ios", debug_assertions)), allow(dead_code))]

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const LOG_FILE_NAME: &str = "mdviewer-debug.log";

/// Past this size the log is rotated to `<name>.1` (replacing any older
/// one) at the next launch, so a long-lived install can't grow it without
/// bound but the previous session — the one that probably crashed — is
/// still there to read.
const MAX_LOG_BYTES: u64 = 512 * 1024;

static LOG: Mutex<Option<DebugLog>> = Mutex::new(None);

pub struct DebugLog {
    file: File,
}

impl DebugLog {
    /// Opens (creating `dir` if needed) `dir/LOG_FILE_NAME` for appending,
    /// rotating it first if it's grown past `MAX_LOG_BYTES`. Path injected
    /// so tests never touch a real Documents folder — same split as the
    /// state-file helpers in lib.rs.
    pub fn open_in(dir: &Path) -> std::io::Result<(DebugLog, PathBuf)> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(LOG_FILE_NAME);
        if std::fs::metadata(&path).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
            std::fs::rename(&path, dir.join(format!("{LOG_FILE_NAME}.1")))?;
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok((DebugLog { file }, path))
    }

    /// One line per call, synced to disk before returning — the whole point
    /// is surviving a crash that happens immediately afterwards, which a
    /// buffered write wouldn't. Startup logs a handful of lines, so the
    /// per-line fsync costs nothing that matters.
    pub fn write_line(&mut self, msg: &str) {
        let line = format_line(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default(), msg);
        let _ = self.file.write_all(line.as_bytes());
        let _ = self.file.sync_data();
    }
}

/// Starts logging to the platform's out-of-band location — the app's
/// Documents folder on iOS (`$HOME` is the app's own data container
/// there) — and installs the panic hook. Does nothing on other platforms
/// or in release builds. Called first thing in `run()`, before Tauri
/// itself starts, so even a crash during `Builder::build` leaves a
/// "session start" line behind.
pub fn init_for_platform() {
    #[cfg(all(target_os = "ios", debug_assertions))]
    if let Some(home) = std::env::var_os("HOME") {
        init_in(&PathBuf::from(home).join("Documents"));
    }
}

fn init_in(dir: &Path) {
    let Ok((opened, _path)) = DebugLog::open_in(dir) else { return };
    *LOG.lock().unwrap_or_else(|e| e.into_inner()) = Some(opened);

    let profile = if cfg!(debug_assertions) { "debug" } else { "release" };
    log(&format!(
        "=== session start: v{} {profile} build, pid {} ===",
        env!("CARGO_PKG_VERSION"),
        std::process::id()
    ));

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let msg = format!(
            "PANIC on thread '{}': {info}\n{}",
            thread.name().unwrap_or("<unnamed>"),
            std::backtrace::Backtrace::force_capture()
        );
        // `try_lock`, not `lock`: a panic raised while this same thread
        // already holds the log (i.e. inside `log` itself) would otherwise
        // deadlock right here instead of dying.
        if let Ok(mut guard) = LOG.try_lock() {
            if let Some(log) = guard.as_mut() {
                log.write_line(&msg);
            }
        }
        previous(info);
    }));
}

/// Appends one breadcrumb line. A no-op until `init_for_platform` has run
/// (and always, off iOS), so call sites don't need their own `cfg`.
pub fn log(msg: &str) {
    if let Some(log) = LOG.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        log.write_line(msg);
    }
}

/// `2026-10-17T07:41:02.123Z <msg>\n` — UTC, so it lines up with the
/// timestamps in an iOS `.ips` crash report without guessing time zones.
/// Hand-rolled rather than adding a date crate for one format string.
fn format_line(since_epoch: Duration, msg: &str) -> String {
    let secs = since_epoch.as_secs();
    let (year, month, day) = civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z {msg}\n",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        since_epoch.subsec_millis()
    )
}

/// Days since 1970-01-01 → (year, month, day), proleptic Gregorian.
/// Howard Hinnant's `civil_from_days` algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mdviewer-debug-log-{name}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        dir
    }

    #[test]
    fn format_line_renders_utc_iso8601_with_millis() {
        // 2026-10-17T07:41:02.123Z
        let t = Duration::from_millis(1_792_222_862_123);
        assert_eq!(format_line(t, "hello"), "2026-10-17T07:41:02.123Z hello\n");
    }

    #[test]
    fn civil_from_days_handles_epoch_and_leap_days() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
        assert_eq!(civil_from_days(11_017), (2000, 3, 1));
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
    }

    #[test]
    fn open_in_creates_the_folder_and_appends_across_opens() {
        let dir = temp_dir("append");
        let (mut log, path) = DebugLog::open_in(&dir).unwrap();
        log.write_line("first");
        drop(log);
        let (mut log, _) = DebugLog::open_in(&dir).unwrap();
        log.write_line("second");

        let text = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("Z first"));
        assert!(lines[1].ends_with("Z second"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_in_rotates_an_oversized_log_and_keeps_the_previous_one() {
        let dir = temp_dir("rotate");
        std::fs::create_dir_all(&dir).unwrap();
        let big = "x".repeat(MAX_LOG_BYTES as usize + 1);
        std::fs::write(dir.join(LOG_FILE_NAME), &big).unwrap();

        let (mut log, path) = DebugLog::open_in(&dir).unwrap();
        log.write_line("fresh");

        assert!(std::fs::read_to_string(&path).unwrap().ends_with("Z fresh\n"));
        assert_eq!(std::fs::read_to_string(dir.join(format!("{LOG_FILE_NAME}.1"))).unwrap(), big);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_in_leaves_a_small_log_alone() {
        let dir = temp_dir("small");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(LOG_FILE_NAME), "old line\n").unwrap();

        let (mut log, path) = DebugLog::open_in(&dir).unwrap();
        log.write_line("new");

        assert!(std::fs::read_to_string(&path).unwrap().starts_with("old line\n"));
        assert!(!dir.join(format!("{LOG_FILE_NAME}.1")).exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
