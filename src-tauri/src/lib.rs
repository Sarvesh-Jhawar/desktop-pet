use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    webview::WebviewWindowBuilder,
    Manager,
    WebviewUrl,
    WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            if let Some(settings_window) = app.get_webview_window("settings") {
                let window_for_close = settings_window.clone();

                settings_window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                    }
                });
            }

            if let Some(tasks_window) = app.get_webview_window("tasks") {
                let window_for_close = tasks_window.clone();

                tasks_window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                    }
                });
            }

            // --- System tray setup ---
            let show_item = MenuItem::with_id(app, "show", "Show Pet", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide Pet", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let tasks_item = MenuItem::with_id(app, "tasks", "Tasks", true, None::<&str>)?;
            let timer_item = MenuItem::with_id(app, "timer", "Timer", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &settings_item, &tasks_item, &timer_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "settings" => {
                        if let Some(w) = app.get_webview_window("settings") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "tasks" => {
                        if let Some(w) = app.get_webview_window("tasks") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "timer" => {
                        if let Some(w) = app.get_webview_window("timer") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        } else {
                            let _ = WebviewWindowBuilder::new(
                                app,
                                "timer",
                                WebviewUrl::App("index.html#/timer".into()),
                            )
                            .title("Focus Timer")
                            .inner_size(320.0, 300.0)
                            .resizable(false)
                            .decorations(true)
                            .visible(true)
                            .build();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .plugin(tauri_plugin_autostart::init(
    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
    Some(vec!["--flags-unused-on-windows"]),
))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
