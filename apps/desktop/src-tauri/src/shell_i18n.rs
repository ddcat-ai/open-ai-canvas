//! 壳的文案表。产品界面目前只有中文，`en` 在产品引入英文时补一张同字段的表即可，
//! 调用点（托盘、启动快照）不变。

pub const DEFAULT_LANG: &str = "zh";

#[derive(Clone, Copy)]
pub struct Text {
    pub app_name: &'static str,
    pub window_title: &'static str,
    pub tray_open: &'static str,
    pub tray_restart: &'static str,
    pub tray_data_dir: &'static str,
    pub tray_logs: &'static str,
    pub tray_quit: &'static str,
    pub phase_selecting_port: &'static str,
    pub phase_starting_service: &'static str,
    pub phase_waiting_ready: &'static str,
    pub phase_ready: &'static str,
    pub phase_dev: &'static str,
    pub phase_external: &'static str,
}

const ZH: Text = Text {
    app_name: "影策",
    window_title: "影策",
    tray_open: "打开窗口",
    tray_restart: "重启本地服务",
    tray_data_dir: "打开数据目录",
    tray_logs: "查看日志",
    tray_quit: "退出",
    phase_selecting_port: "正在选择本地端口…",
    phase_starting_service: "正在启动本地服务…",
    phase_waiting_ready: "正在等待本地服务就绪…",
    phase_ready: "正在进入影策…",
    phase_dev: "开发模式：窗口指向本地开发服务器",
    phase_external: "正在连接已运行的本地服务…",
};

const TABLE: &[(&str, Text)] = &[(DEFAULT_LANG, ZH)];

pub fn supports(lang: &str) -> bool {
    TABLE.iter().any(|(code, _)| *code == lang)
}

/// 未知语言回落到默认语言，而不是让壳带着空文案启动。
pub fn normalize(lang: &str) -> String {
    if supports(lang) {
        lang.to_string()
    } else {
        DEFAULT_LANG.to_string()
    }
}

pub fn text(lang: &str) -> &'static Text {
    TABLE
        .iter()
        .find(|(code, _)| *code == lang)
        .map(|(_, text)| text)
        .unwrap_or(&ZH)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_language_is_available() {
        assert!(supports(DEFAULT_LANG));
        assert_eq!(normalize("zh"), "zh");
        assert_eq!(normalize("en"), DEFAULT_LANG);
        assert_eq!(normalize(""), DEFAULT_LANG);
    }

    /// 新增语言时同一张表要么补齐全部字段，要么被这条测试挡下来。
    #[test]
    fn every_entry_fills_all_fields() {
        for (code, text) in TABLE {
            let fields = [
                text.app_name,
                text.window_title,
                text.tray_open,
                text.tray_restart,
                text.tray_data_dir,
                text.tray_logs,
                text.tray_quit,
                text.phase_selecting_port,
                text.phase_starting_service,
                text.phase_waiting_ready,
                text.phase_ready,
                text.phase_dev,
                text.phase_external,
            ];
            assert!(
                fields.iter().all(|value| !value.trim().is_empty()),
                "文案表 {code} 存在空字段"
            );
        }
    }
}
