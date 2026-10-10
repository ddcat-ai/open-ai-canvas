//! 托盘：菜单文案来自文案表，语言变化时整块重建。

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use crate::shell_i18n;
use crate::{server, MAIN_WINDOW};

pub const TRAY_ID: &str = "desktop-tray";
const MENU_OPEN: &str = "open";
const MENU_RESTART: &str = "restart";
const MENU_DATA_DIR: &str = "data-dir";
const MENU_LOGS: &str = "logs";
const MENU_QUIT: &str = "quit";

pub fn install(app: &AppHandle, lang: &str) -> tauri::Result<()> {
    let text = shell_i18n::text(lang);
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, MENU_OPEN, text.tray_open, true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_RESTART, text.tray_restart, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_DATA_DIR, text.tray_data_dir, true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_LOGS, text.tray_logs, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_QUIT, text.tray_quit, true, None::<&str>)?,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(text.app_name)
        .on_menu_event(handle_menu_event);
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

/// 文案表变化时先移除再安装：托盘菜单是原生对象，没有逐项改文案的通道。
pub fn set_language(app: &AppHandle, lang: &str) -> tauri::Result<()> {
    let _ = app.remove_tray_by_id(TRAY_ID);
    install(app, lang)
}

pub fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        MENU_OPEN => focus_main(app),
        MENU_RESTART => server::restart(app),
        MENU_DATA_DIR => {
            let _ = crate::commands::open_data_dir(app);
        }
        MENU_LOGS => {
            let _ = crate::commands::open_logs(app);
        }
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}
