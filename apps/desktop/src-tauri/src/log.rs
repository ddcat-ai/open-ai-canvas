//! 壳日志：`<app_data_dir>/logs/canvas-server.log`，启动时把上一轮滚动为 `.old`。

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

pub const FILE_NAME: &str = "canvas-server.log";

pub struct LogSink {
    path: Option<PathBuf>,
    writer: Mutex<Box<dyn Write + Send>>,
}

impl LogSink {
    /// 打开日志文件；上一轮的日志保留为 `<文件名>.old`，便于对照「上次为什么起不来」。
    pub fn to_file(dir: &Path) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(FILE_NAME);
        if path.exists() {
            let _ = std::fs::rename(&path, dir.join(format!("{FILE_NAME}.old")));
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self {
            path: Some(path),
            writer: Mutex::new(Box::new(file)),
        })
    }

    /// 应用数据目录不可写时的兜底：日志只进 stderr，壳其余能力照常工作。
    pub fn to_stderr() -> Self {
        Self {
            path: None,
            writer: Mutex::new(Box::new(std::io::stderr())),
        }
    }

    pub fn path(&self) -> Option<PathBuf> {
        self.path.clone()
    }

    pub fn line(&self, stream: &str, text: &str) {
        let mut writer = lock(&self.writer);
        let _ = writeln!(writer, "[{}] [{stream}] {text}", utc_timestamp());
        let _ = writer.flush();
    }

    pub fn note(&self, text: &str) {
        self.line("shell", text);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn utc_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    let (year, month, day, hour, minute, second) = civil_from_unix(seconds);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// 手写历法换算（days->civil），只输出 UTC：日志不需要时区库，
/// 但用户排障需要的可读时间戳不值得为它加一个依赖。
fn civil_from_unix(seconds: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = seconds.div_euclid(86_400);
    let remainder = seconds.rem_euclid(86_400);
    let shifted = days + 719_468;
    let era = if shifted >= 0 { shifted } else { shifted - 146_096 } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 { month_prime + 3 } else { month_prime - 9 } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (
        year,
        month,
        day,
        (remainder / 3_600) as u32,
        ((remainder % 3_600) / 60) as u32,
        (remainder % 60) as u32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_known_unix_timestamps() {
        assert_eq!(civil_from_unix(0), (1970, 1, 1, 0, 0, 0));
        assert_eq!(civil_from_unix(1_700_000_000), (2023, 11, 14, 22, 13, 20));
        assert_eq!(civil_from_unix(1_759_536_000), (2025, 10, 4, 0, 0, 0));
        // 闰年边界：2024-02-29T12:00:00Z
        assert_eq!(civil_from_unix(1_709_208_000), (2024, 2, 29, 12, 0, 0));
    }

    #[test]
    fn writes_lines_to_stderr_fallback() {
        let sink = LogSink::to_stderr();
        assert!(sink.path().is_none());
        sink.note("测试日志行");
    }
}
