//! 前端可调用的壳命令。除壳偏好外都只读或只做进程控制，不携带业务语义。

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::prefs::Prefs;
use crate::server;
use crate::shell_i18n;
use crate::state::{lock, ShellEnv, ShellState, StartupSnapshot};

#[tauri::command]
pub fn desktop_startup_state(app: AppHandle) -> StartupSnapshot {
    let state = app.state::<ShellState>();
    if let Some(snapshot) = lock(&state.snapshot).clone() {
        return snapshot;
    }
    let env = app.state::<ShellEnv>();
    StartupSnapshot::booting(
        shell_i18n::text(&env.prefs().lang).phase_starting_service,
        env.log_path(),
    )
}

#[tauri::command]
pub fn desktop_retry_startup(app: AppHandle) {
    server::restart(&app);
}

#[tauri::command]
pub fn desktop_restart_local_service(app: AppHandle) {
    server::restart(&app);
}

#[tauri::command]
pub fn desktop_server_base_url(app: AppHandle) -> Option<String> {
    let state = app.state::<ShellState>();
    // 先把快照取出到局部变量：锁 guard 留在尾表达式里会因临时值释放顺序借用不到 state。
    let snapshot = lock(&state.snapshot).clone();
    snapshot.and_then(|snapshot| snapshot.base_url)
}

#[tauri::command]
pub fn desktop_open_logs(app: AppHandle) -> Result<(), String> {
    open_logs(&app)
}

#[tauri::command]
pub fn desktop_open_data_dir(app: AppHandle) -> Result<(), String> {
    open_data_dir(&app)
}

#[tauri::command]
pub fn desktop_quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn desktop_prefs(env: State<'_, ShellEnv>) -> Prefs {
    env.prefs()
}

#[tauri::command]
pub fn desktop_set_prefs(
    app: AppHandle,
    lang: Option<String>,
    keep_awake: Option<bool>,
) -> Result<Prefs, String> {
    let env = app.state::<ShellEnv>();
    let mut prefs = env.prefs();
    let mut language_changed = false;

    if let Some(lang) = lang {
        let normalized = shell_i18n::normalize(&lang);
        language_changed = normalized != prefs.lang;
        prefs.lang = normalized;
    }
    if let Some(keep_awake) = keep_awake {
        prefs.keep_awake = keep_awake;
        env.keep_awake.set(keep_awake);
    }

    *lock(&env.prefs) = prefs.clone();
    env.save_prefs(&prefs);
    if language_changed {
        crate::tray::set_language(&app, &prefs.lang).map_err(|err| format!("重建托盘失败：{err}"))?;
        crate::apply_window_title(&app, &prefs.lang);
    }
    Ok(prefs)
}

/// 托盘与设置页共用：优先打开日志文件本身，没有文件时退回日志目录。
pub fn open_logs(app: &AppHandle) -> Result<(), String> {
    let env = app.state::<ShellEnv>();
    if let Some(path) = env.log_path() {
        if path.is_file() {
            return open_path(app, path);
        }
        if let Some(parent) = path.parent() {
            return open_path(app, parent.to_path_buf());
        }
    }
    let root = env
        .paths
        .as_ref()
        .map(|paths| paths.root.clone())
        .ok_or_else(|| "应用数据目录不可用，无法打开日志".to_string())?;
    open_path(app, root)
}

pub fn open_data_dir(app: &AppHandle) -> Result<(), String> {
    let env = app.state::<ShellEnv>();
    let root = env
        .paths
        .as_ref()
        .map(|paths| paths.root.clone())
        .ok_or_else(|| "应用数据目录不可用".to_string())?;
    open_path(app, root)
}

fn open_path(app: &AppHandle, path: PathBuf) -> Result<(), String> {
    // opener 插件只收 String；目标都是日志文件与用户目录，非 UTF-8 字节在这里有损退化即可，
    // 不值得为极罕见路径拒绝打开。
    let target = path.to_string_lossy().into_owned();
    app.opener()
        .open_path(target, None::<&str>)
        .map_err(|err| format!("打开路径失败：{err}"))
}
