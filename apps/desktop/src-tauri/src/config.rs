//! 启动形态与路径解析：壳只在这里读环境变量，其余模块拿到的是已校验的值。

use std::path::PathBuf;
use std::time::Duration;

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

pub const DEFAULT_HEALTH_TIMEOUT_SECS: u64 = 60;
pub const DATA_SUBDIR: &str = "data";
pub const LOGS_SUBDIR: &str = "logs";
const WEB_RESOURCE_DIR: &str = "web";
const PI_ARCHIVE_RESOURCE: &str = "pi-runtime.tar.gz";
const PLUGIN_PACKAGES_RESOURCE: &str = "plugin-packages";

/// 壳自己的目录（日志、偏好）与注入子进程的数据目录。
/// 默认都在 OS 应用数据目录下，与仓库内 `.local/` 的开发账号库物理隔离。
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root: PathBuf,
    pub data_dir: PathBuf,
    pub logs_dir: PathBuf,
}

pub struct ManagedBoot {
    pub data_dir: PathBuf,
    pub static_dir: PathBuf,
    pub server_bin: Option<PathBuf>,
    /// 打包时随包携带的 pi 运行时压缩包（`bundle.resources`）。
    ///
    /// 只有这个路径，子进程才知道从哪里解包；源码目录下的候选路径在 `-trimpath`
    /// 构建后是拿不到的。
    pub pi_archive: Option<PathBuf>,
    /// 随包携带的官方协议插件目录（`bundle.resources`）。
    ///
    /// 后端把“找不到官方 plugin-packages”当作启动失败；壳的 cwd 是 `/`，
    /// 靠后端从工作目录向上找是找得到的反面——所以打包形态必须显式给这个路径。
    pub plugin_dir: Option<PathBuf>,
    pub health_timeout: Duration,
}

/// 三种启动形态互斥：开发直连、复用已有服务、托管子进程。
pub enum BootMode {
    DevUrl(String),
    External {
        base_url: String,
        timeout: Duration,
    },
    Managed(ManagedBoot),
}

pub fn boot_mode(app: &AppHandle, paths: &AppPaths) -> Result<BootMode, String> {
    let timeout = health_timeout()?;
    if let Some(url) = env_trim("CANVAS_DESKTOP_DEV_URL") {
        return Ok(BootMode::DevUrl(trim_trailing_slashes(url)));
    }
    if let Some(url) = env_trim("CANVAS_DESKTOP_SERVER_URL") {
        return Ok(BootMode::External {
            base_url: trim_trailing_slashes(url),
            timeout,
        });
    }
    Ok(BootMode::Managed(ManagedBoot {
        data_dir: paths.data_dir.clone(),
        static_dir: resolve_static_dir(app)?,
        server_bin: resolve_server_bin()?,
        pi_archive: resolve_pi_archive(app),
        plugin_dir: resolve_plugin_dir(app),
        health_timeout: timeout,
    }))
}

pub fn resolve_app_paths(app: &AppHandle) -> Result<AppPaths, String> {
    let root = match env_trim("CANVAS_DESKTOP_APP_DIR") {
        Some(raw) => PathBuf::from(raw),
        None => app
            .path()
            .app_data_dir()
            .map_err(|err| format!("无法定位应用数据目录：{err}"))?,
    };
    std::fs::create_dir_all(&root).map_err(|err| format!("创建应用数据目录失败：{err}"))?;

    let data_dir = match env_trim("CANVAS_DESKTOP_DATA_DIR") {
        Some(raw) => PathBuf::from(raw),
        None => root.join(DATA_SUBDIR),
    };
    std::fs::create_dir_all(&data_dir)
        .map_err(|err| format!("创建本地服务数据目录失败：{err}"))?;

    Ok(AppPaths {
        root: root.clone(),
        data_dir,
        logs_dir: root.join(LOGS_SUBDIR),
    })
}

/// 前端构建产物的查找顺序：显式覆盖 → bundle 资源 → 调试构建下的 `web/dist`。
/// 找不到就直接失败：壳不该导航到一个只有 API 的空地址。
fn resolve_static_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(raw) = env_trim("CANVAS_DESKTOP_STATIC_DIR") {
        let dir = PathBuf::from(raw);
        if is_static_dir(&dir) {
            return Ok(dir);
        }
        return Err(format!(
            "CANVAS_DESKTOP_STATIC_DIR 指向的目录没有 index.html：{}",
            dir.display()
        ));
    }

    if let Ok(dir) = app.path().resolve(WEB_RESOURCE_DIR, BaseDirectory::Resource) {
        if is_static_dir(&dir) {
            return Ok(dir);
        }
    }

    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../web/dist");
        if is_static_dir(&dev) {
            return Ok(dev);
        }
    }

    Err("未找到前端构建产物：先运行 apps/desktop 的 bun run stage，或用 CANVAS_DESKTOP_STATIC_DIR 指定包含 index.html 的目录".to_string())
}

fn is_static_dir(dir: &std::path::Path) -> bool {
    dir.join("index.html").is_file()
}

fn resolve_server_bin() -> Result<Option<PathBuf>, String> {
    match env_trim("CANVAS_SERVER_BIN") {
        Some(raw) => {
            let path = PathBuf::from(raw);
            if path.is_file() {
                Ok(Some(path))
            } else {
                Err(format!("CANVAS_SERVER_BIN 指向的文件不存在：{}", path.display()))
            }
        }
        None => Ok(None),
    }
}

/// pi 运行时压缩包：显式环境变量优先，其次 bundle 资源。
///
/// 拿不到不是错误：源码方式运行（`bun run tauri dev`）时压缩包本来就不存在，
/// 后端会回退到仓库内的 `agent-runtime/pi`。
fn resolve_pi_archive(app: &AppHandle) -> Option<PathBuf> {
    if let Some(raw) = env_trim("CANVAS_PI_ARCHIVE") {
        let path = PathBuf::from(raw);
        if path.is_file() {
            return Some(path);
        }
    }
    app.path()
        .resolve(PI_ARCHIVE_RESOURCE, BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_file())
}

/// 官方协议插件目录：显式环境变量优先，其次 bundle 资源。
///
/// 拿不到不是错误：源码方式运行（`bun run tauri dev`）时没有这份资源，
/// 后端会从工作目录向上找到仓库里的 `plugin-packages`。
fn resolve_plugin_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Some(raw) = env_trim("CANVAS_OFFICIAL_PLUGIN_DIR") {
        let dir = PathBuf::from(raw);
        if dir.is_dir() {
            return Some(dir);
        }
    }
    app.path()
        .resolve(PLUGIN_PACKAGES_RESOURCE, BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_dir())
}

fn health_timeout() -> Result<Duration, String> {
    match env_trim("CANVAS_DESKTOP_HEALTH_TIMEOUT_SECS") {
        Some(raw) => match raw.parse::<u64>() {
            Ok(0) | Err(_) => Err(format!(
                "CANVAS_DESKTOP_HEALTH_TIMEOUT_SECS 必须是正整数，当前为 {raw}"
            )),
            Ok(seconds) => Ok(Duration::from_secs(seconds)),
        },
        None => Ok(Duration::from_secs(DEFAULT_HEALTH_TIMEOUT_SECS)),
    }
}

fn env_trim(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn trim_trailing_slashes(url: String) -> String {
    url.trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_trailing_slashes_only() {
        assert_eq!(trim_trailing_slashes("http://127.0.0.1:8080/".into()), "http://127.0.0.1:8080");
        assert_eq!(trim_trailing_slashes("http://127.0.0.1:8080".into()), "http://127.0.0.1:8080");
        assert_eq!(trim_trailing_slashes("http://127.0.0.1:8080/a/".into()), "http://127.0.0.1:8080/a");
    }

    #[test]
    fn empty_env_is_absent() {
        std::env::remove_var("CANVAS_DESKTOP_TEST_EMPTY");
        assert!(env_trim("CANVAS_DESKTOP_TEST_EMPTY").is_none());
        std::env::set_var("CANVAS_DESKTOP_TEST_EMPTY", "  ");
        assert!(env_trim("CANVAS_DESKTOP_TEST_EMPTY").is_none());
        std::env::set_var("CANVAS_DESKTOP_TEST_EMPTY", " value ");
        assert_eq!(env_trim("CANVAS_DESKTOP_TEST_EMPTY").as_deref(), Some("value"));
        std::env::remove_var("CANVAS_DESKTOP_TEST_EMPTY");
    }
}
