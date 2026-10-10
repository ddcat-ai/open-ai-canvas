//! 视图层入口：Windows 发布构建不弹控制台窗口。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    yingce_desktop::run()
}
