// No JS commands (Rust calls the Kotlin side directly), so none to list.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
