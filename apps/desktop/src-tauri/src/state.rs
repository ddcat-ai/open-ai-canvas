//! 壳的运行时状态：进程内可共享的应用环境与本地服务快照。

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandChild;

use crate::config::AppPaths;
use crate::keep_awake::KeepAwake;
use crate::log::LogSink;
use crate::prefs::Prefs;

/// 互斥锁中毒不构成数据损坏：这里的取值没有跨线程不变量，
/// 因为中毒就让壳停摆，代价远高于继续用当前快照。
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupPhase {
    Booting,
    Ready,
    Failed,
    Dev,
    External,
}

/// 启动页与托盘读取的唯一进度真相：字段名按 `camelCase` 序列化给启动页直接使用。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupSnapshot {
    pub phase: StartupPhase,
    pub message: String,
    pub detail: Option<String>,
    pub log_path: Option<String>,
    pub base_url: Option<String>,
}

impl StartupSnapshot {
    pub fn booting(message: impl Into<String>, log_path: Option<PathBuf>) -> Self {
        Self {
            phase: StartupPhase::Booting,
            message: message.into(),
            detail: None,
            log_path: path_text(log_path),
            base_url: None,
        }
    }

    pub fn ready(base_url: String, message: impl Into<String>, log_path: Option<PathBuf>) -> Self {
        Self {
            phase: StartupPhase::Ready,
            message: message.into(),
            detail: None,
            log_path: path_text(log_path),
            base_url: Some(base_url),
        }
    }

    pub fn external(base_url: String, message: impl Into<String>, log_path: Option<PathBuf>) -> Self {
        Self {
            phase: StartupPhase::External,
            message: message.into(),
            detail: None,
            log_path: path_text(log_path),
            base_url: Some(base_url),
        }
    }

    pub fn dev(base_url: String, message: impl Into<String>, log_path: Option<PathBuf>) -> Self {
        Self {
            phase: StartupPhase::Dev,
            message: message.into(),
            detail: None,
            log_path: path_text(log_path),
            base_url: Some(base_url),
        }
    }

    /// 失败时保留 detail 原文：启动页只有一行位置，完整输出仍写日志。
    pub fn failed(detail: impl Into<String>, message: impl Into<String>, log_path: Option<PathBuf>) -> Self {
        Self {
            phase: StartupPhase::Failed,
            message: message.into(),
            detail: Some(detail.into()),
            log_path: path_text(log_path),
            base_url: None,
        }
    }
}

fn path_text(path: Option<PathBuf>) -> Option<String> {
    path.map(|path| path.to_string_lossy().to_string())
}

/// 壳级环境：日志、应用数据目录、偏好与 keep-awake 都只建一次。
pub struct ShellEnv {
    pub log: Arc<LogSink>,
    pub paths: Option<AppPaths>,
    /// 应用数据目录不可用等致命问题的原因，启动快照用它解释失败。
    pub boot_error: Option<String>,
    pub prefs: Mutex<Prefs>,
    pub keep_awake: KeepAwake,
}

impl ShellEnv {
    /// 数据目录不可用时不让壳直接退出：启动页要能显示原因与日志入口。
    pub fn bootstrap(app: &AppHandle) -> Self {
        let paths = crate::config::resolve_app_paths(app);
        let (paths, mut boot_error) = match paths {
            Ok(paths) => (Some(paths), None),
            Err(err) => (None, Some(err)),
        };

        let log = match paths.as_ref() {
            Some(paths) => match LogSink::to_file(&paths.logs_dir) {
                Ok(sink) => Arc::new(sink),
                Err(err) => {
                    boot_error.get_or_insert_with(|| format!("日志文件不可写：{err}"));
                    Arc::new(LogSink::to_stderr())
                }
            },
            None => Arc::new(LogSink::to_stderr()),
        };

        let prefs = match paths.as_ref() {
            Some(paths) => crate::prefs::load(&paths.root),
            None => Prefs::default(),
        };
        let keep_awake = KeepAwake::new();
        keep_awake.set(prefs.keep_awake);

        Self {
            log,
            paths,
            boot_error,
            prefs: Mutex::new(prefs),
            keep_awake,
        }
    }

    pub fn prefs(&self) -> Prefs {
        lock(&self.prefs).clone()
    }

    pub fn log_path(&self) -> Option<PathBuf> {
        self.log.path()
    }

    pub fn save_prefs(&self, prefs: &Prefs) {
        if let Some(paths) = &self.paths {
            if let Err(err) = crate::prefs::save(&paths.root, prefs) {
                self.log.line("shell", &format!("写入壳偏好失败：{err}"));
            }
        }
    }
}

/// 被托管的本地服务进程。`exited` 由输出泵维护，健康门据此区分「还没就绪」与「已经死了」。
pub struct DesktopService {
    pub child: CommandChild,
    pub exited: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct ShellState {
    pub snapshot: Mutex<Option<StartupSnapshot>>,
    pub service: Mutex<Option<DesktopService>>,
    /// 启动流程的互斥位：启动页重试与托盘重启都不应叠加出第二个子进程。
    pub booting: AtomicBool,
}
