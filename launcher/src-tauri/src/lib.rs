mod core;
mod download;
mod incremental;
mod public_release;
mod source_install;
mod source_adapt;
mod source_media;
use core::{Config, Manager, Status, UpdateInfo};
use std::sync::{Arc, Mutex};
use tauri::Manager as TauriManager;

type Shared = Arc<Mutex<Manager>>;
struct OperationRoot(std::path::PathBuf);
async fn execute<T: Send + 'static>(
    state: tauri::State<'_, Shared>,
    action: impl FnOnce(&mut Manager) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut manager = manager
            .lock()
            .map_err(|_| "管理核心状态异常，请退出应用后重新打开。".to_string())?;
        action(&mut manager).map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn status(state: tauri::State<'_, Shared>) -> Result<Status, String> {
    execute(state, |m| m.status()).await
}
#[tauri::command]
async fn configure(state: tauri::State<'_, Shared>, config: Config) -> Result<Status, String> {
    execute(state, move |m| m.configure(config)).await
}
#[tauri::command]
async fn check_updates(state: tauri::State<'_, Shared>) -> Result<UpdateInfo, String> {
    execute(state, |m| m.check_updates()).await
}
#[tauri::command]
async fn install(state: tauri::State<'_, Shared>) -> Result<Status, String> {
    execute(state, |m| m.install()).await
}
#[tauri::command]
async fn switch_prepared(state: tauri::State<'_, Shared>) -> Result<Status, String> {
    execute(state, |m| m.switch_prepared()).await
}
/// Builds the newest commit without stopping the service; the manager lock is not held while it runs.
#[tauri::command]
async fn prepare_update(state: tauri::State<'_, Shared>) -> Result<String, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core::prepare_in_background(&manager).map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn start(state: tauri::State<'_, Shared>) -> Result<Status, String> {
    execute(state, |m| m.start()).await
}
#[tauri::command]
async fn stop(state: tauri::State<'_, Shared>) -> Result<Status, String> {
    execute(state, |m| m.stop()).await
}
#[tauri::command]
async fn open_browser(state: tauri::State<'_, Shared>) -> Result<(), String> {
    execute(state, |m| m.open_browser()).await
}
#[tauri::command]
async fn logs(state: tauri::State<'_, Shared>) -> Result<Vec<String>, String> {
    execute(state, |m| m.logs()).await
}

#[tauri::command]
fn operation_progress(state: tauri::State<'_, OperationRoot>) -> Option<serde_json::Value> {
    use std::io::Read;
    let file = std::fs::File::open(state.0.join("logs/source-build.progress.json")).ok()?;
    let mut bytes = Vec::new();
    file.take(4097).read_to_end(&mut bytes).ok()?;
    if bytes.len() > 4096 { return None; }
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    if value["stage"].is_string() && value["message"].is_string() && value["percent"].as_u64().is_some_and(|v| v <= 100) { Some(value) } else { None }
}
#[tauri::command]
fn open_logs_dir(state: tauri::State<'_, OperationRoot>) -> Result<(), String> {
    open::that(state.0.join("logs")).map_err(|_| "无法打开本地日志目录".into())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            #[cfg(debug_assertions)]
            let root = std::env::var_os("YINGCE_LAUNCHER_SMOKE_ROOT").map(std::path::PathBuf::from).filter(|p| p.is_absolute()).unwrap_or(root);
            // Construct the blocking HTTP client outside the async runtime.
            let manager = Manager::new(root.clone())?;
            app.manage(OperationRoot(root));
            let shared: Shared = Arc::new(Mutex::new(manager));
            app.manage(shared.clone());
            // Scheduled background check: builds the new version while the service keeps running.
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(60));
                let due = match shared.lock() {
                    Ok(mut manager) => manager.claim_scheduled(&chrono::Local::now()),
                    Err(_) => return,
                };
                if due {
                    let _ = core::prepare_in_background(&shared);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            status,
            configure,
            check_updates,
            install,
            switch_prepared,
            prepare_update,
            start,
            stop,
            open_browser,
            logs,
            operation_progress,
            open_logs_dir
        ])
        .build(tauri::generate_context!())
        .expect("无法创建影策启动器")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Closing exits and stops owned processes; no unmanaged background services.
                if let Some(state) = app.try_state::<Shared>() {
                    if let Ok(mut manager) = state.lock() {
                        let _ = manager.stop();
                    }
                }
            }
        });
}
