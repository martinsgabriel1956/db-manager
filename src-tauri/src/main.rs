// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // ssh runs this same binary as its askpass (SSH_ASKPASS) for the tunnel's password:
    // answer and leave before any window or other instance check
    if let Some(reply) = ordo_lib::askpass_reply() {
        println!("{reply}");
        return;
    }
    // WebKitGTK's DMA-BUF renderer leaks shared memory on some GPUs (NVIDIA
    // hybrid on Wayland): big pages like the ER diagram ate all RAM until the
    // OOM killer took the app and the browser with it
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // SAFETY: first thing in main, before any thread exists
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    ordo_lib::run()
}
