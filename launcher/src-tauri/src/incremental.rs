//! Incremental source preparation. The previous pristine source tree is rebuilt from its cached
//! archive, then only files whose git object id differs from GitHub's tree listing are downloaded.
//! Every downloaded file is verified against its object id, and the finished tree is re-hashed in
//! full, so the result is exactly the listed commit or the attempt fails (callers fall back to the
//! complete archive).
use crate::public_release::TreeEntry;
use anyhow::{ensure, Context, Result};
use sha1::{Digest, Sha1};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
};

/// Above these a full archive is cheaper than many small requests.
pub const MAX_FILES: usize = 1500;
pub const MAX_BYTES: u64 = 96 * 1024 * 1024;
/// A first install has no base to diff against, so it is allowed to fetch the whole filtered tree.
pub const SCRATCH_MAX_FILES: usize = 8000;
pub const SCRATCH_MAX_BYTES: u64 = 192 * 1024 * 1024;
pub const UPDATE_WORKERS: usize = 6;
pub const SCRATCH_WORKERS: usize = 12;

/// Payment plugins whose `backend/provider*` executables the launcher compiles for this platform.
const REBUILT_PAYMENT_PLUGINS: [&str; 5] = [
    "official-payment-wechat-native",
    "official-payment-alipay-page",
    "official-payment-xunhupay",
    "official-payment-zhifufm",
    "official-payment-epay",
];

/// Whether the source build reads `path`. The skipped files are ~2/3 of the repository by size:
/// a committed macOS server binary, prebuilt `.yingce-plugin` packages, cross-platform payment
/// binaries (the builder recompiles the current platform's), and docs / screenshots / launcher
/// sources. `assets/user-*` stay because the web build globs them.
pub fn is_needed(path: &str) -> bool {
    let mut parts = path.split('/');
    let first = parts.next().unwrap_or("");
    match first {
        ".github" | "docs" | "launcher" => return false,
        "assets" => return path.starts_with("assets/user-"),
        "backend" if path == "backend/server" => return false,
        "plugin-packages" => {
            let rest: Vec<&str> = parts.collect();
            if rest.len() == 1 && rest[0].ends_with(".yingce-plugin") {
                return false;
            }
            if rest.len() == 3
                && REBUILT_PAYMENT_PLUGINS.contains(&rest[0])
                && rest[1] == "backend"
                && rest[2].starts_with("provider")
            {
                return false;
            }
        }
        _ => {}
    }
    true
}

pub fn filter_needed(tree: Vec<TreeEntry>) -> Vec<TreeEntry> {
    tree.into_iter().filter(|e| is_needed(&e.path)).collect()
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    pub download: Vec<TreeEntry>,
    pub delete: Vec<String>,
    pub bytes: u64,
}

impl Plan {
    pub fn within_limits(&self) -> bool {
        self.download.len() <= MAX_FILES && self.bytes <= MAX_BYTES
    }

    pub fn within_scratch_limits(&self) -> bool {
        self.download.len() <= SCRATCH_MAX_FILES && self.bytes <= SCRATCH_MAX_BYTES
    }
}

pub fn blob_sha1(data: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(format!("blob {}\0", data.len()));
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn blob_sha1_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha1::new();
    hasher.update(format!("blob {}\0", file.metadata()?.len()));
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn safe_path(value: &str) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= 1024
            && !value.contains('\\')
            && !value.contains(':')
            && !value.chars().any(|c| c.is_control())
            && Path::new(value)
                .components()
                .all(|c| matches!(c, Component::Normal(_))),
        "目录清单含有不安全路径。"
    );
    Ok(())
}

/// Maps every regular file below `root` (relative, `/`-separated) to its git blob id.
pub fn index_tree(root: &Path) -> Result<BTreeMap<String, String>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            ensure!(!kind.is_symlink(), "源码目录含有链接，拒绝增量更新。");
            let path = entry.path();
            if kind.is_dir() {
                walk(root, &path, out)?;
            } else {
                let relative = path
                    .strip_prefix(root)?
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/");
                out.insert(relative, blob_sha1_file(&path)?);
            }
        }
        Ok(())
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out)?;
    Ok(out)
}

pub fn plan(old: &BTreeMap<String, String>, new: &[TreeEntry]) -> Plan {
    let listed: HashSet<&str> = new.iter().map(|e| e.path.as_str()).collect();
    let download: Vec<TreeEntry> = new
        .iter()
        .filter(|e| old.get(&e.path) != Some(&e.sha))
        .cloned()
        .collect();
    let bytes = download.iter().map(|e| e.size).sum();
    let delete = old
        .keys()
        .filter(|p| !listed.contains(p.as_str()))
        .cloned()
        .collect();
    Plan {
        download,
        delete,
        bytes,
    }
}

fn prune_empty_parents(root: &Path, mut dir: &Path) {
    while dir != root {
        if fs::remove_dir(dir).is_err() {
            break;
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => break,
        }
    }
}

/// Applies `plan` to `root`. `fetch` returns the raw content of one listed file.
pub fn apply(
    root: &Path,
    plan: &Plan,
    workers: usize,
    fetch: &(dyn Fn(&TreeEntry) -> Result<Vec<u8>> + Sync),
    progress: &(dyn Fn(usize, usize) + Sync),
) -> Result<()> {
    for path in &plan.delete {
        safe_path(path)?;
        let target = root.join(path);
        fs::remove_file(&target).with_context(|| format!("无法删除已移除的文件 {path}"))?;
        if let Some(parent) = target.parent() {
            prune_empty_parents(root, parent);
        }
    }
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let failure: Mutex<Option<anyhow::Error>> = Mutex::new(None);
    let total = plan.download.len();
    std::thread::scope(|scope| {
        for _ in 0..workers.max(1).min(total.max(1)) {
            scope.spawn(|| loop {
                if failure.lock().map(|f| f.is_some()).unwrap_or(true) {
                    return;
                }
                let index = next.fetch_add(1, Ordering::SeqCst);
                let Some(entry) = plan.download.get(index) else {
                    return;
                };
                let result = (|| -> Result<()> {
                    safe_path(&entry.path)?;
                    let data = fetch(entry)?;
                    ensure!(
                        data.len() as u64 == entry.size && blob_sha1(&data) == entry.sha,
                        "下载的文件与目录清单不一致：{}",
                        entry.path
                    );
                    let target = root.join(&entry.path);
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    let temporary = target.with_extension(format!("part{index}"));
                    {
                        let mut file = File::create(&temporary)?;
                        file.write_all(&data)?;
                        file.sync_all()?;
                    }
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let mode = if entry.executable { 0o755 } else { 0o644 };
                        fs::set_permissions(&temporary, fs::Permissions::from_mode(mode))?;
                    }
                    fs::rename(&temporary, &target)?;
                    Ok(())
                })();
                match result {
                    Ok(()) => progress(done.fetch_add(1, Ordering::SeqCst) + 1, total),
                    Err(error) => {
                        if let Ok(mut slot) = failure.lock() {
                            slot.get_or_insert(error);
                        }
                        return;
                    }
                }
            });
        }
    });
    if let Some(error) = failure.into_inner().ok().flatten() {
        return Err(error);
    }
    Ok(())
}

/// Confirms `root` is byte-identical (by object id) to the listed tree.
pub fn verify(root: &Path, new: &[TreeEntry]) -> Result<()> {
    let actual = index_tree(root)?;
    ensure!(actual.len() == new.len(), "增量结果的文件数与目录清单不一致。");
    for entry in new {
        ensure!(
            actual.get(&entry.path) == Some(&entry.sha),
            "增量结果与目录清单不一致：{}",
            entry.path
        );
    }
    Ok(())
}

/// Writes the pristine tree as a ZIP so the next update can build on it.
pub fn write_archive(root: &Path, archive: &Path) -> Result<()> {
    let prefix = root
        .file_name()
        .and_then(|n| n.to_str())
        .context("源码目录名无效")?
        .to_owned();
    let mut writer = zip::ZipWriter::new(File::create(archive)?);
    fn walk(
        writer: &mut zip::ZipWriter<File>,
        dir: &Path,
        name: &str,
    ) -> Result<()> {
        let mut entries = fs::read_dir(dir)?.collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let child = format!("{name}/{}", entry.file_name().to_string_lossy());
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                walk(writer, &path, &child)?;
                continue;
            }
            #[cfg(unix)]
            let mode = {
                use std::os::unix::fs::PermissionsExt;
                fs::metadata(&path)?.permissions().mode() & 0o777
            };
            #[cfg(not(unix))]
            let mode = 0o644;
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .compression_level(Some(1))
                .large_file(fs::metadata(&path)?.len() > u32::MAX as u64)
                .unix_permissions(mode);
            writer.start_file(child, options)?;
            std::io::copy(&mut File::open(&path)?, writer)?;
        }
        Ok(())
    }
    walk(&mut writer, root, &prefix)?;
    writer.finish()?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, data: &[u8]) -> TreeEntry {
        TreeEntry {
            path: path.into(),
            sha: blob_sha1(data),
            size: data.len() as u64,
            executable: false,
        }
    }

    #[test]
    fn blob_id_matches_git() {
        // `printf 'hello\n' | git hash-object --stdin`
        assert_eq!(blob_sha1(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
        assert_eq!(blob_sha1(b""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("yingce-incremental-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn plan_apply_and_verify_round_trip() {
        let root = scratch("round-trip");
        fs::create_dir_all(root.join("keep")).unwrap();
        fs::create_dir_all(root.join("gone")).unwrap();
        fs::write(root.join("keep/same.txt"), "same").unwrap();
        fs::write(root.join("keep/changed.txt"), "old").unwrap();
        fs::write(root.join("gone/removed.txt"), "bye").unwrap();
        let new = vec![
            entry("keep/same.txt", b"same"),
            entry("keep/changed.txt", b"new content"),
            entry("added/deep/file.txt", b"fresh"),
        ];
        let plan = plan(&index_tree(&root).unwrap(), &new);
        assert_eq!(plan.delete, vec!["gone/removed.txt".to_string()]);
        assert_eq!(plan.download.len(), 2);
        assert!(plan.within_limits());
        let fetch = |e: &TreeEntry| -> Result<Vec<u8>> {
            Ok(match e.path.as_str() {
                "keep/changed.txt" => b"new content".to_vec(),
                "added/deep/file.txt" => b"fresh".to_vec(),
                other => anyhow::bail!("unexpected fetch {other}"),
            })
        };
        apply(&root, &plan, UPDATE_WORKERS, &fetch, &|_, _| {}).unwrap();
        verify(&root, &new).unwrap();
        assert!(!root.join("gone").exists(), "empty directories are pruned");
        let archive = root.with_extension("zip");
        write_archive(&root, &archive).unwrap();
        let mut zip = zip::ZipArchive::new(File::open(&archive).unwrap()).unwrap();
        assert!(zip.by_name(&format!("{}/keep/changed.txt", root.file_name().unwrap().to_str().unwrap())).is_ok());
        fs::remove_dir_all(&root).unwrap();
        fs::remove_file(&archive).unwrap();
    }

    #[test]
    fn corrupted_or_unsafe_downloads_are_rejected() {
        let root = scratch("corrupt");
        let wrong = Plan {
            download: vec![entry("a.txt", b"expected")],
            delete: vec![],
            bytes: 8,
        };
        let tampered = |_: &TreeEntry| -> Result<Vec<u8>> { Ok(b"tampered".to_vec()) };
        assert!(apply(&root, &wrong, UPDATE_WORKERS, &tampered, &|_, _| {}).is_err());
        assert!(!root.join("a.txt").exists());
        for path in ["../escape", "/abs", "a\\b", "c:/x", "a/../b"] {
            let unsafe_plan = Plan {
                download: vec![entry(path, b"x")],
                delete: vec![],
                bytes: 1,
            };
            let fetch = |_: &TreeEntry| -> Result<Vec<u8>> { Ok(b"x".to_vec()) };
            assert!(apply(&root, &unsafe_plan, UPDATE_WORKERS, &fetch, &|_, _| {}).is_err(), "{path}");
        }
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn build_irrelevant_files_are_not_downloaded() {
        for skipped in [
            "backend/server",
            "docs/index.md",
            "launcher/src-tauri/src/core.rs",
            ".github/workflows/launcher.yml",
            "assets/panda.jpg",
            "plugin-packages/a6api.yingce-plugin",
            "plugin-packages/official-payment-epay/backend/provider",
            "plugin-packages/official-payment-epay/backend/provider-windows-amd64.exe",
        ] {
            assert!(!is_needed(skipped), "{skipped}");
        }
        for needed in [
            "backend/go.mod",
            "backend/cmd/server/main.go",
            "web/bun.lock",
            "web/public/logo.svg",
            "assets/user-sikongyue.png",
            "CHANGELOG.md",
            "VERSION",
            "plugin-packages/official-payment-epay/manifest.json",
            "plugin-packages/official-payment-epay/docs/interface.md",
            "plugin-packages/embed-documentation.mjs",
            "plugin-packages/a6api/manifest.json",
            // Not rebuilt by the launcher, so its prebuilt executable must stay.
            "plugin-packages/other-plugin/backend/provider",
        ] {
            assert!(is_needed(needed), "{needed}");
        }
    }

    #[test]
    fn oversized_plans_fall_back_to_full_archive() {
        let big = Plan {
            download: vec![],
            delete: vec![],
            bytes: MAX_BYTES + 1,
        };
        assert!(!big.within_limits());
    }
}
