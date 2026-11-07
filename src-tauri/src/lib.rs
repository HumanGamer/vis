//! Native desktop shell for Vis.
//!
//! The UI is the existing Vue app, bundled into the binary and served from the
//! `tauri://` custom protocol. Rust owns the window, opens external links in the
//! system browser, and provides native notifications (the notification plugin
//! backs the web `Notification` API used by the UI).

use tauri::webview::NewWindowResponse;
use tauri::{Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// URLs that belong to the bundled UI (or the Vite dev server) stay in the webview.
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "data" | "blob" => true,
        "http" | "https" => matches!(url.host_str(), Some("tauri.localhost" | "localhost" | "127.0.0.1")),
        _ => false,
    }
}

fn open_external(app: &tauri::AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let nav_handle = app.handle().clone();
            let popup_handle = app.handle().clone();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Vis")
                .inner_size(1440.0, 900.0)
                .min_inner_size(720.0, 480.0)
                .resizable(true)
                // Links to other sites go to the default browser instead of
                // replacing the app inside the webview.
                .on_navigation(move |url| {
                    if is_app_url(url) {
                        return true;
                    }
                    open_external(&nav_handle, url);
                    false
                })
                // `target="_blank"` / `window.open` requests.
                .on_new_window(move |url, _features| {
                    open_external(&popup_handle, &url);
                    NewWindowResponse::Deny
                })
                .build()?;
            #[cfg(debug_assertions)]
            window.open_devtools();
            let _ = window.set_focus();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Vis");
}
