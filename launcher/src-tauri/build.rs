use std::{env, fs, path::PathBuf, process::Command};
fn main() {
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let runtime = manifest.join("../runtime");
    for entry in fs::read_dir(&runtime).expect("runtime source directory") {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|ext| ext == "go") || path.file_name().is_some_and(|n| n == "go.mod") {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
    let target = env::var("TARGET").unwrap();
    let os = if target.contains("windows") { "windows" } else if target.contains("darwin") { "darwin" } else if target.contains("linux") { "linux" } else { panic!("Unsupported desktop target: {target}") };
    let arch = if target.starts_with("x86_64") { "amd64" } else if target.starts_with("aarch64") { "arm64" } else { panic!("Unsupported desktop architecture: {target}") };
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("yingce-runtime.bin");
    let status = Command::new("go").current_dir(&runtime).env("GOOS", os).env("GOARCH", arch).env("CGO_ENABLED", "0")
        .args(["build", "-trimpath", "-ldflags=-s -w", "-o"]).arg(&output).arg(".").status().expect("Go is required to build the embedded runtime gateway");
    assert!(status.success(), "Embedded runtime build failed");
    tauri_build::build();
}
