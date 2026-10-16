use std::path::Path;

fn main() {
    assert_repo_version();
    tauri_build::build()
}

/// 发布物版本只有一个来源：仓库根 `VERSION`。这里对不上就直接失败，
/// 避免打出与发布说明、镜像标签不一致的安装包。
fn assert_repo_version() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    // src-tauri/ 在 apps/desktop/ 下，仓库根在三层之上（与 config.rs 的 web/dist 回退路径同深）。
    let version_path = Path::new(&manifest_dir).join("../../../VERSION");
    println!("cargo:rerun-if-changed={}", version_path.display());

    let raw = std::fs::read_to_string(&version_path)
        .unwrap_or_else(|err| panic!("读取 {} 失败：{err}", version_path.display()));
    let repo_version = raw.trim().trim_start_matches('v');
    let crate_version = std::env::var("CARGO_PKG_VERSION").expect("CARGO_PKG_VERSION");

    if repo_version != crate_version {
        panic!(
            "src-tauri/Cargo.toml 的版本 {crate_version} 与仓库 VERSION（{repo_version}）不一致，请先同步版本号"
        );
    }
}
