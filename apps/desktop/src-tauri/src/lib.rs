//! 影策桌面壳：Tauri 2 host 托管本地 Go 服务，窗口加载本地服务地址。
//!
//! 壳不拥有任何模型，只做进程监督、窗口与系统集成；画布与时间线真相源仍在 TS 与 Go。

mod commands;
mod config;
mod keep_awake;
mod log;
mod prefs;
mod server;
mod shell_i18n;
mod state;
mod tray;

use tauri::{Manager, WindowEvent};

pub const MAIN_WINDOW: &str = "main";

pub fn run() {
    tauri::Builder::default()
        // 单实例插件必须排在最前：第二次启动只聚焦已有窗口，不重复拉起本地服务。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::focus_main(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::desktop_startup_state,
            commands::desktop_retry_startup,
            commands::desktop_restart_local_service,
            commands::desktop_server_base_url,
            commands::desktop_open_logs,
            commands::desktop_open_data_dir,
            commands::desktop_quit,
            commands::desktop_prefs,
            commands::desktop_set_prefs,
        ])
        .setup(|app| {
            let env = state::ShellEnv::bootstrap(app.handle());
            let lang = env.prefs().lang.clone();
            env.log.note(&format!("桌面壳启动，偏好语言 {lang}"));
            app.manage(env);
            app.manage(state::ShellState::default());

            tray::install(app.handle(), &lang)?;
            apply_window_prefs(app.handle());

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                server::boot(handle).await;
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 关闭窗口只收起窗口：本地服务继续运行，退出走托盘或系统菜单。
                api.prevent_close();
                let _ = window.hide();
                save_window_prefs(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("构建桌面壳失败")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                server::stop(app);
            }
        });
}

/// 把窗口放到当前显示器可用工作区内再显示。
///
/// 配置里的尺寸只是「偏好值」：它可能来自更大屏幕上的保存值，也可能大于当前
/// 逻辑分辨率（Retina 上 1440×900 的窗口会超出 1204×753 的屏幕），所以创建时
/// 先不显示（`tauri.conf.json` 的 `visible: false`），裁剪完再 `show`，
/// 避免先闪一下超屏窗口。
fn apply_window_prefs(app: &tauri::AppHandle) {
    let env = app.state::<state::ShellEnv>();
    let mut prefs = env.prefs();
    apply_window_title(app, &prefs.lang);
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };

    let work = monitor_work_area(&window);
    let desired = (prefs.window.width, prefs.window.height);
    prefs.window.fit_to(work);
    let fitted = (prefs.window.width, prefs.window.height);
    if fitted != desired {
        let area = match work {
            Some((w, h)) => format!("{}×{}", w, h),
            None => "未知".to_string(),
        };
        env.log.note(&format!(
            "窗口尺寸 {}×{} 超出可用工作区 {}，调整为 {}×{}",
            desired.0, desired.1, area, fitted.0, fitted.1
        ));
    }

    let (min_w, min_h) = prefs::min_size(work);
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(min_w, min_h)));
    let _ = window.set_size(tauri::LogicalSize::new(fitted.0, fitted.1));
    let _ = window.center();
    let _ = window.show();
}

/// 窗口所在显示器的工作区（扣除菜单栏与 Dock 后的逻辑尺寸）。
///
/// 拿不到显示器、缩放异常、或平台返回 0 时返回 `None`，此时不裁剪：把窗口缩成
/// 不可用的大小比偶尔高一点更糟。
fn monitor_work_area(window: &tauri::WebviewWindow) -> Option<(u32, u32)> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let area = monitor.work_area().size;
    let scale = monitor.scale_factor();
    if scale <= 0.0 || area.width == 0 || area.height == 0 {
        return None;
    }
    Some((
        (area.width as f64 / scale) as u32,
        (area.height as f64 / scale) as u32,
    ))
}

/// 标题与语言绑定。单独成一个函数，语言切换时复用而不会牵动窗口几何：
/// 切语言去调 apply_window_prefs 会把用户当前尺寸拉回上次保存的值。
pub(crate) fn apply_window_title(app: &tauri::AppHandle, lang: &str) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.set_title(shell_i18n::text(lang).window_title);
    }
}

fn save_window_prefs(app: &tauri::AppHandle) {
    let env = app.state::<state::ShellEnv>();
    let mut prefs = env.prefs();
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
            let logical = size.to_logical::<u32>(scale);
            prefs.window.width = logical.width;
            prefs.window.height = logical.height;
        }
    }
    *state::lock(&env.prefs) = prefs.clone();
    env.save_prefs(&prefs);
}
