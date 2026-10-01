// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `instantnotes mcp ...` serves agents over stdio and never starts the
    // app (see src-tauri/agents). Checked before anything else, the
    // single-instance plugin included, which would hand this process's
    // arguments to the running app and exit.
    if let Some(code) = instantnotes_agents::run_from_args(std::env::args_os().skip(1)) {
        std::process::exit(code);
    }

    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    instantnotes_lib::run()
}
