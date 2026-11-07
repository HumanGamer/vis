//! Native desktop shell for Vis.
//!
//! The UI is the existing Vue app, bundled into the binary. In release builds it
//! is served from a loopback-only HTTP server on a fixed port, so the page has a
//! stable `http://` origin that the OpenCode service accepts in its CORS list
//! (it rejects the default `tauri://localhost` custom-protocol origin). Rust also
//! owns the window, opens external links in the system browser, and provides
//! native notifications (the notification plugin backs the web `Notification` API).

use std::net::TcpListener;
use std::sync::Mutex;

use tauri::webview::NewWindowResponse;
use tauri::{Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;

/// Loopback address the bundled UI is served from. Keep this stable: it is the
/// origin users allow in `opencode service set cors`, and the webview's saved
/// credentials are scoped to it.
const UI_HOST: &str = "127.0.0.1";
const UI_PORT: u16 = 41730;

/// Window size (logical px) at which the UI shows at 100%; smaller windows zoom
/// the whole page out so the layout keeps its proportions.
const FULL_SIZE: (f64, f64) = (1400.0, 860.0);
const MIN_ZOOM: f64 = 0.6;

fn zoom_for(width: f64, height: f64) -> f64 {
    (width / FULL_SIZE.0).min(height / FULL_SIZE.1).clamp(MIN_ZOOM, 1.0)
}

/// Scale the whole page (like browser zoom) to fit the window's current size.
fn fit_zoom(window: &WebviewWindow, last: &Mutex<f64>) {
    let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
        return;
    };
    let logical = size.to_logical::<f64>(scale);
    let zoom = zoom_for(logical.width, logical.height);
    let mut last = last.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // Skip tiny changes so dragging the window edge does not re-lay out every pixel.
    if (zoom - *last).abs() < 0.01 {
        return;
    }
    if window.set_zoom(zoom).is_ok() {
        *last = zoom;
    }
}

fn ui_origin() -> String {
    format!("http://{UI_HOST}:{UI_PORT}")
}

/// URLs that belong to the UI stay in the webview; everything else is external.
fn is_app_url(url: &Url, app_origin: &str) -> bool {
    matches!(url.scheme(), "about" | "data" | "blob")
        || url.origin().ascii_serialization() == app_origin
}

fn open_external(app: &tauri::AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

fn port_unavailable_page() -> WebviewUrl {
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>Vis</title>\
         <body style=\"font:15px system-ui;padding:40px;background:#0f172a;color:#e2e8f0\">\
         <h2>Vis could not start</h2>\
         <p>Port {UI_PORT} on {UI_HOST} is already in use. Vis serves its interface from \
         <code>{origin}</code>, the origin allowed in OpenCode's CORS settings.</p>\
         <p>Close the other program using that port (or another running copy of Vis) and reopen Vis.</p>",
        origin = ui_origin()
    );
    let encoded: String = html
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect();
    WebviewUrl::External(format!("data:text/html,{encoded}").parse().expect("valid data URL"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Dev builds load the Vite dev server (devUrl); release builds serve the
    // bundled assets on the fixed loopback origin.
    let dev = tauri::is_dev();
    let port_free = dev || TcpListener::bind((UI_HOST, UI_PORT)).is_ok();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());
    if !dev && port_free {
        builder = builder.plugin(tauri_plugin_localhost::Builder::new(UI_PORT).host(UI_HOST).build());
    }

    builder
        .setup(move |app| {
            let (url, app_origin) = if dev {
                let dev_url = app.config().build.dev_url.clone().expect("devUrl is configured");
                let origin = dev_url.origin().ascii_serialization();
                (WebviewUrl::External(dev_url), origin)
            } else if port_free {
                let origin = ui_origin();
                (WebviewUrl::External(origin.parse().expect("valid UI origin")), origin)
            } else {
                (port_unavailable_page(), String::new())
            };

            let nav_handle = app.handle().clone();
            let popup_handle = app.handle().clone();
            let window = WebviewWindowBuilder::new(app, "main", url)
                .title("Vis")
                .inner_size(1440.0, 900.0)
                .min_inner_size(720.0, 480.0)
                .resizable(true)
                // Links to other sites go to the default browser instead of
                // replacing the app inside the webview.
                .on_navigation(move |url| {
                    if is_app_url(url, &app_origin) {
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
            let _ = window.set_focus();

            // Zoom the page with the window size (desktop builds only).
            let last_zoom = std::sync::Arc::new(Mutex::new(1.0));
            fit_zoom(&window, &last_zoom);
            let zoom_window = window.clone();
            window.on_window_event(move |event| {
                if matches!(event, WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) {
                    fit_zoom(&zoom_window, &last_zoom);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Vis");
}
