//! 壳偏好：`<app_data_dir>/desktop.json`，字段缺省即默认值，未知字段忽略。

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::shell_i18n;

pub const FILE_NAME: &str = "desktop.json";
/// 首次启动的“偏好尺寸”：最终还会被可用工作区裁剪，见 `WindowPrefs::fit_to`。
pub const DEFAULT_WIDTH: u32 = 1280;
pub const DEFAULT_HEIGHT: u32 = 800;
// 产品下限，保证 260px 侧栏（`--workspace-sidebar-width`）之外仍有可用的主区：
// 这是产品选择，不是从设计断点实测算出来的值。
const MIN_WIDTH: u32 = 960;
const MIN_HEIGHT: u32 = 640;
/// 窗口最多占可用工作区的比例；留出菜单栏、Dock 与拖拽边距。
const MAX_WORK_AREA_RATIO: f64 = 0.92;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Prefs {
    pub lang: String,
    pub keep_awake: bool,
    pub window: WindowPrefs,
    /// 上次成功监听的本地端口。
    ///
    /// 前端配置（个人渠道等）按 origin 存在浏览器存储里，端口一变就等于换了站点，
    /// 所以下次启动优先复用这个端口；被占用时再退回系统分配的临时端口。
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WindowPrefs {
    pub width: u32,
    pub height: u32,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            lang: shell_i18n::DEFAULT_LANG.to_string(),
            keep_awake: false,
            window: WindowPrefs::default(),
            port: None,
        }
    }
}

impl Default for WindowPrefs {
    fn default() -> Self {
        Self {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
        }
    }
}

/// 窗口尺寸的允许区间 `((最小宽, 最小高), (最大宽, 最大高))`。
///
/// 拿不到工作区（部分平台返回 0）时既不下调下限也不设上限：把窗口缩成不可用的
/// 大小比偶尔高一点更糟。屏幕比产品下限还小时，下限必须跟着降，否则会出现一个
/// 永远比屏幕大的窗口。
fn bounds(work: Option<(u32, u32)>) -> ((u32, u32), (u32, u32)) {
    match work {
        Some((work_w, work_h)) if work_w > 0 && work_h > 0 => {
            let max_w = ((work_w as f64) * MAX_WORK_AREA_RATIO) as u32;
            let max_h = ((work_h as f64) * MAX_WORK_AREA_RATIO) as u32;
            ((MIN_WIDTH.min(max_w), MIN_HEIGHT.min(max_h)), (max_w, max_h))
        }
        _ => ((MIN_WIDTH, MIN_HEIGHT), (u32::MAX, u32::MAX)),
    }
}

/// 当前工作区允许的窗口最小尺寸，供 `set_min_size` 使用。
pub fn min_size(work: Option<(u32, u32)>) -> (u32, u32) {
    bounds(work).0
}

impl WindowPrefs {
    /// 窗口尺寸来自本地文件，可能是手改或屏幕变化后的旧值，落到最小尺寸以上才可用。
    fn clamp(&mut self) {
        self.width = self.width.max(MIN_WIDTH);
        self.height = self.height.max(MIN_HEIGHT);
    }

    /// 裁剪到可用工作区：桌面窗口不能比屏幕还大。
    ///
    /// 恢复上次保存的尺寸也会走这里：外接显示器拔掉或换到小屏后，旧尺寸不该
    /// 原样还原成一个超出屏幕的窗口。
    pub fn fit_to(&mut self, work: Option<(u32, u32)>) {
        let ((min_w, min_h), (max_w, max_h)) = bounds(work);
        // bounds 保证 min <= max，clamp 不会 panic。
        self.width = self.width.clamp(min_w, max_w);
        self.height = self.height.clamp(min_h, max_h);
    }
}

/// 读不到或损坏时回到默认偏好：壳的启动不该被一个配置文件卡住。
pub fn load(dir: &Path) -> Prefs {
    let raw = match std::fs::read_to_string(dir.join(FILE_NAME)) {
        Ok(raw) => raw,
        Err(_) => return Prefs::default(),
    };
    match serde_json::from_str::<Prefs>(&raw) {
        Ok(mut prefs) => {
            prefs.lang = shell_i18n::normalize(&prefs.lang);
            prefs.window.clamp();
            prefs
        }
        Err(_) => Prefs::default(),
    }
}

pub fn save(dir: &Path, prefs: &Prefs) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let raw = serde_json::to_string_pretty(prefs)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;
    std::fs::write(dir.join(FILE_NAME), format!("{raw}\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_usable_without_a_file() {
        let dir = std::env::temp_dir().join("yingce-desktop-prefs-missing");
        let prefs = load(&dir);
        assert_eq!(prefs.lang, shell_i18n::DEFAULT_LANG);
        assert_eq!(prefs.window.width, DEFAULT_WIDTH);
        assert!(!prefs.keep_awake);
    }

    #[test]
    fn round_trips_and_clamps() {
        let dir = std::env::temp_dir().join(format!("yingce-desktop-prefs-{}", std::process::id()));
        let mut prefs = Prefs::default();
        prefs.lang = "en".to_string();
        prefs.keep_awake = true;
        prefs.window.width = 100;
        save(&dir, &prefs).expect("写入偏好失败");

        let loaded = load(&dir);
        // 未支持的语言回落到默认表，而不是原样保留。
        assert_eq!(loaded.lang, shell_i18n::DEFAULT_LANG);
        assert!(loaded.keep_awake);
        assert_eq!(loaded.window.width, MIN_WIDTH);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_the_remembered_port() {
        let dir = std::env::temp_dir().join(format!("yingce-desktop-prefs-port-{}", std::process::id()));
        let mut prefs = Prefs::default();
        prefs.port = Some(64218);
        save(&dir, &prefs).expect("写入偏好失败");

        assert_eq!(load(&dir).port, Some(64218));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tolerates_broken_file() {
        let dir = std::env::temp_dir().join(format!("yingce-desktop-prefs-broken-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("创建临时目录失败");
        std::fs::write(dir.join(FILE_NAME), "{ 不是 json").expect("写入失败");
        assert_eq!(load(&dir).window.height, DEFAULT_HEIGHT);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fits_the_default_size_into_a_smaller_screen() {
        // 1204×753 级别的笔记本逻辑分辨率（2408×1506 Retina）：默认尺寸必须收进来。
        let work = Some((1204, 688));
        let mut window = WindowPrefs::default();
        window.fit_to(work);

        assert_eq!(window.width, 1107);
        assert_eq!(window.height, 632);
        assert!(window.width <= 1204 && window.height <= 688);
    }

    #[test]
    fn restores_a_saved_size_only_within_the_current_work_area() {
        // 外接显示器上保存的大尺寸，换回小屏后不得原样还原。
        let mut window = WindowPrefs {
            width: 2560,
            height: 1440,
        };
        window.fit_to(Some((1440, 900)));
        assert_eq!((window.width, window.height), (1324, 828));

        // 工作区变小时保持原窗口尺寸不变（不放大也不缩小）。
        let mut saved = WindowPrefs {
            width: 1100,
            height: 700,
        };
        saved.fit_to(Some((1440, 900)));
        assert_eq!((saved.width, saved.height), (1100, 700));
    }

    #[test]
    fn tiny_work_area_lowers_the_minimum_size_too() {
        // 屏幕比产品下限还小时，下限必须跟着降，否则窗口永远超屏。
        let work = Some((800, 500));
        let (min_w, min_h) = min_size(work);
        assert_eq!((min_w, min_h), (736, 460));

        let mut window = WindowPrefs::default();
        window.fit_to(work);
        assert_eq!((window.width, window.height), (736, 460));
    }

    #[test]
    fn missing_work_area_keeps_the_preferred_size() {
        let mut window = WindowPrefs::default();
        window.fit_to(None);
        assert_eq!((window.width, window.height), (DEFAULT_WIDTH, DEFAULT_HEIGHT));
        assert_eq!(min_size(None), (MIN_WIDTH, MIN_HEIGHT));
        // 平台报告 0 时同样不裁剪。
        window.fit_to(Some((0, 0)));
        assert_eq!((window.width, window.height), (DEFAULT_WIDTH, DEFAULT_HEIGHT));
    }
}
