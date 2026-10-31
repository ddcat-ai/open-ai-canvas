//! Adapt only disposable extracted sources and the private, post-npm-ci agent tree.
//! Call prepare_agent_source before the backend build; materialize_agent_links
//! after npm ci and before the existing strict core inventory. No inventory exemptions.
//! Both operations require exclusive ownership of their staging trees (no concurrent writers).
use anyhow::{bail, ensure, Context, Result};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

const MARKER: &str = "// yingce-launcher: agent-os-environment-v1";
const ORIGINAL: &str = "\t// 环境变量白名单：只传 Node 运行所需的最少变量。HOME 与会话、工作目录
\t// 由运行时自己建的临时隔离目录提供，不使用服务端数据目录。
\tcmd.Env = []string{
\t\t\"PATH=\" + os.Getenv(\"PATH\"),
\t\t\"NODE_ENV=production\",
\t\t\"PI_OFFLINE=1\",
\t}";
const PATCHED: &str = "\t// yingce-launcher: agent-os-environment-v1
\t// Inherit only OS essentials; never inherit backend credentials or proxy settings.
\tcmd.Env = []string{
\t\t\"PATH=\" + os.Getenv(\"PATH\"),
\t\t\"NODE_ENV=production\",
\t\t\"PI_OFFLINE=1\",
\t}
\tfor _, key := range []string{\"SystemRoot\", \"WINDIR\", \"TEMP\", \"TMP\", \"TMPDIR\", \"HOME\", \"USERPROFILE\", \"LOCALAPPDATA\", \"APPDATA\"} {
\t\tif value, ok := os.LookupEnv(key); ok {
\t\t\tcmd.Env = append(cmd.Env, key+\"=\"+value)
\t\t}
\t}";

/// Never call on a developer checkout. Unknown upstream environment code is an error.
pub fn prepare_agent_source(source: &Path) -> Result<()> {
    ensure!(
        !fs::symlink_metadata(source)?.file_type().is_symlink(),
        "source root is a symlink"
    );
    let root = fs::canonicalize(source)?;
    match fs::symlink_metadata(root.join(".git")) {
        Ok(_) => bail!("refusing to patch a developer checkout (.git present)"),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let mut path = root;
    for component in ["backend", "internal", "agent", "runtime", "runtime.go"] {
        path.push(component);
        let meta = fs::symlink_metadata(&path)?;
        ensure!(
            !meta.file_type().is_symlink(),
            "source runtime path contains a symlink"
        );
    }
    ensure!(
        fs::metadata(&path)?.is_file(),
        "runtime.go is not a regular file"
    );
    let original = fs::read_to_string(&path).context("read extracted agent runtime")?;
    // Accept line endings, but not unknown edits to the whitelist or its marker.
    let normalized = original.replace("\r\n", "\n");
    if normalized.contains(MARKER) {
        ensure!(
            normalized.matches(MARKER).count() == 1
                && normalized.matches(PATCHED).count() == 1
                && !normalized.contains(ORIGINAL),
            "unsupported marked agent environment block"
        );
        return Ok(());
    }
    ensure!(
        normalized.matches(ORIGINAL).count() == 1,
        "unsupported upstream agent environment block"
    );
    let patched = normalized.replacen(ORIGINAL, PATCHED, 1);
    let patched = if original.contains("\r\n") {
        patched.replace('\n', "\r\n")
    } else {
        patched
    };
    fs::write(path, patched).context("patch extracted agent environment")
}

const MAX_DEPTH: usize = 64;
const MAX_ENTRIES: u64 = 100_000;
const MAX_BYTES: u64 = 12 * 1024 * 1024 * 1024;
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
struct Budget {
    entries: u64,
    bytes: u64,
}
impl Budget {
    fn entry(&mut self, depth: usize) -> Result<()> {
        ensure!(depth <= MAX_DEPTH, "agent tree exceeds depth limit");
        self.entries += 1;
        ensure!(
            self.entries <= MAX_ENTRIES,
            "agent tree exceeds entry limit"
        );
        Ok(())
    }
    fn bytes(&mut self, size: u64) -> Result<()> {
        self.bytes = self
            .bytes
            .checked_add(size)
            .context("agent byte count overflow")?;
        ensure!(self.bytes <= MAX_BYTES, "agent tree exceeds 12 GiB limit");
        Ok(())
    }
}

/// Resolve npm-internal links into real files/directories, preserving permissions.
/// This does not permit any symlink in the final inventory. Failures never delete
/// dependency targets; an already completed replacement may remain on later failure.
pub fn materialize_agent_links(agent: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(agent)?;
    ensure!(
        meta.is_dir() && !meta.file_type().is_symlink(),
        "agent root must be a real directory"
    );
    let root = fs::canonicalize(agent)?;
    // Validate the entire logical expansion before replacing anything.
    inspect(&root, &root, 0, &mut Vec::new(), &mut Budget::default())?;
    materialize(&root, &root, 0, &mut Budget::default())?;
    // Confirm the final physical tree still satisfies exactly the same bounds.
    inspect(&root, &root, 0, &mut Vec::new(), &mut Budget::default())?;
    Ok(())
}

fn resolve(root: &Path, path: &Path) -> Result<(PathBuf, fs::Metadata)> {
    let resolved = fs::canonicalize(path)
        .with_context(|| format!("dangling or cyclic agent path: {}", path.display()))?;
    ensure!(
        resolved.starts_with(root),
        "agent link escapes root: {}",
        path.display()
    );
    let meta = fs::symlink_metadata(&resolved)?;
    ensure!(
        meta.is_dir() || meta.is_file(),
        "unsupported agent file type: {}",
        path.display()
    );
    Ok((resolved, meta))
}

fn inspect(
    root: &Path,
    path: &Path,
    depth: usize,
    stack: &mut Vec<PathBuf>,
    budget: &mut Budget,
) -> Result<()> {
    budget.entry(depth)?;
    let (resolved, meta) = resolve(root, path)?;
    if meta.is_file() {
        budget.bytes(meta.len())?;
    } else {
        ensure!(
            !stack.contains(&resolved),
            "directory link cycle: {}",
            path.display()
        );
        stack.push(resolved.clone());
        for entry in fs::read_dir(&resolved)? {
            inspect(root, &entry?.path(), depth + 1, stack, budget)?;
        }
        stack.pop();
    }
    Ok(())
}

// A reserved sibling directory owns all temporary paths, avoiding collisions with
// dependency names. Only this directory and the exact verified link are removed.
struct Scratch(PathBuf);
impl Scratch {
    fn new(parent: &Path) -> Result<Self> {
        for _ in 0..128 {
            let id = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
            let path = parent.join(format!(".yingce-materialize-{}-{id}", std::process::id()));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.into()),
            }
        }
        bail!("cannot reserve agent temporary sibling")
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        // Copy sets final permissions (possibly readonly); cleanup is best effort.
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn copy_resolved(
    root: &Path,
    source: &Path,
    dest: &Path,
    depth: usize,
    stack: &mut Vec<PathBuf>,
    budget: &mut Budget,
) -> Result<()> {
    budget.entry(depth)?;
    let (resolved, meta) = resolve(root, source)?;
    if meta.is_dir() {
        ensure!(
            !stack.contains(&resolved),
            "directory link cycle while copying"
        );
        stack.push(resolved.clone());
        fs::create_dir(dest)?;
        for entry in fs::read_dir(&resolved)? {
            let entry = entry?;
            copy_resolved(
                root,
                &entry.path(),
                &dest.join(entry.file_name()),
                depth + 1,
                stack,
                budget,
            )?;
        }
        stack.pop();
    } else {
        let mut input = File::open(&resolved)?.take(MAX_BYTES - budget.bytes + 1);
        let mut output = OpenOptions::new().write(true).create_new(true).open(dest)?;
        let copied = io::copy(&mut input, &mut output)?;
        budget.bytes(copied)?;
        ensure!(copied == meta.len(), "agent file changed during copy");
        output.sync_all()?;
    }
    fs::set_permissions(dest, meta.permissions())?;
    Ok(())
}

fn remove_link(path: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileTypeExt;
        if fs::symlink_metadata(path)?.file_type().is_symlink_dir() {
            return fs::remove_dir(path);
        }
    }
    fs::remove_file(path)
}

fn materialize(root: &Path, path: &Path, depth: usize, budget: &mut Budget) -> Result<()> {
    ensure!(depth <= MAX_DEPTH, "agent tree exceeds depth limit");
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        let original = fs::read_link(path)?;
        let (target, _) = resolve(root, path)?;
        let scratch = Scratch::new(path.parent().context("agent link has no parent")?)?;
        let copy = scratch.0.join("materialized");
        copy_resolved(root, path, &copy, depth, &mut Vec::new(), budget)?;
        ensure!(
            fs::symlink_metadata(path)?.file_type().is_symlink()
                && fs::read_link(path)? == original
                && fs::canonicalize(path)? == target,
            "agent link changed during copy"
        );
        let backup = scratch.0.join("original-link");
        // Rename the link itself, never its target. Keep it for rollback until
        // the complete sibling copy is atomically renamed into the vacant name.
        fs::rename(path, &backup)?;
        if let Err(error) = fs::rename(&copy, path) {
            if let Err(restore_error) = fs::rename(&backup, path) {
                // Preserve both the original link and completed copy for recovery.
                let recovery = scratch.0.clone();
                std::mem::forget(scratch);
                bail!("publish agent link failed: {error}; restore failed: {restore_error}; recovery: {}", recovery.display());
            }
            return Err(error.into());
        }
        remove_link(&backup)?;
    } else if meta.is_dir() {
        for entry in fs::read_dir(path)? {
            materialize(root, &entry?.path(), depth + 1, budget)?;
        }
    } else {
        ensure!(meta.is_file(), "unsupported agent file type");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Tree(PathBuf);
    impl Tree {
        fn new() -> Self {
            let scratch = Scratch::new(&std::env::temp_dir()).unwrap();
            let path = scratch.0.clone();
            std::mem::forget(scratch);
            Self(path)
        }
        fn fixture(&self, contents: &str) -> PathBuf {
            let path = self.0.join("backend/internal/agent/runtime/runtime.go");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, contents).unwrap();
            path
        }
    }
    impl Drop for Tree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn real_upstream_environment_fixture_is_strict_and_idempotent() {
        // Exact whitelist/comment fixture from pinned upstream 19eec9bc4e71.
        let tree = Tree::new();
        let path = tree.fixture(&format!(
            "package runtime\nfunc fixture() {{\n{ORIGINAL}\n}}\n"
        ));
        prepare_agent_source(&tree.0).unwrap();
        let once = fs::read_to_string(&path).unwrap();
        assert!(once.contains(PATCHED));
        assert!(!once.contains("os.Environ"));
        prepare_agent_source(&tree.0).unwrap();
        assert_eq!(once, fs::read_to_string(&path).unwrap());
        fs::write(&path, once.replace("\"TEMP\"", "\"HTTP_PROXY\"")).unwrap();
        assert!(prepare_agent_source(&tree.0).is_err());
    }

    #[test]
    fn rejects_checkout_and_unknown_upstream_without_writing() {
        let tree = Tree::new();
        let path = tree.fixture(ORIGINAL);
        fs::write(tree.0.join(".git"), "gitdir: elsewhere").unwrap();
        assert!(prepare_agent_source(&tree.0).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), ORIGINAL);
        fs::remove_file(tree.0.join(".git")).unwrap();
        fs::write(&path, ORIGINAL.replace("PI_OFFLINE=1", "PI_OFFLINE=0")).unwrap();
        assert!(prepare_agent_source(&tree.0).is_err());
    }

    #[test]
    fn crlf_fixture_preserves_line_endings() {
        let tree = Tree::new();
        let path = tree.fixture(&ORIGINAL.replace('\n', "\r\n"));
        prepare_agent_source(&tree.0).unwrap();
        assert_eq!(
            fs::read_to_string(path).unwrap(),
            PATCHED.replace('\n', "\r\n")
        );
    }

    #[test]
    fn bounded_walk_rejects_depth_and_entry_and_byte_limits() {
        let mut budget = Budget {
            entries: MAX_ENTRIES,
            bytes: 0,
        };
        assert!(budget.entry(0).is_err());
        assert!(Budget::default().entry(MAX_DEPTH + 1).is_err());
        assert!(Budget::default().bytes(MAX_BYTES + 1).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn internal_bin_and_directory_links_preserve_executable_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let tree = Tree::new();
        fs::create_dir_all(tree.0.join("node_modules/.bin")).unwrap();
        fs::create_dir_all(tree.0.join("node_modules/pkg")).unwrap();
        let cli = tree.0.join("node_modules/pkg/cli");
        fs::write(&cli, "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).unwrap();
        symlink("../pkg/cli", tree.0.join("node_modules/.bin/tool")).unwrap();
        symlink("pkg", tree.0.join("node_modules/alias")).unwrap();
        materialize_agent_links(&tree.0).unwrap();
        for rel in ["node_modules/.bin/tool", "node_modules/alias/cli"] {
            let path = tree.0.join(rel);
            assert!(fs::symlink_metadata(&path).unwrap().is_file());
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o755
            );
        }
        materialize_agent_links(&tree.0).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_outside_dangling_and_cycles_before_replacement() {
        use std::os::unix::fs::symlink;
        let outside = Tree::new();
        fs::write(outside.0.join("secret"), "untouched").unwrap();
        for target in [
            outside.0.join("secret"),
            PathBuf::from("missing"),
            PathBuf::from("link"),
            PathBuf::from("."),
        ] {
            let tree = Tree::new();
            symlink(target, tree.0.join("link")).unwrap();
            assert!(materialize_agent_links(&tree.0).is_err());
            assert!(fs::symlink_metadata(tree.0.join("link"))
                .unwrap()
                .file_type()
                .is_symlink());
        }
        assert_eq!(
            fs::read_to_string(outside.0.join("secret")).unwrap(),
            "untouched"
        );
        let tree = Tree::new();
        symlink("b", tree.0.join("a")).unwrap();
        symlink("a", tree.0.join("b")).unwrap();
        assert!(materialize_agent_links(&tree.0).is_err());
    }
}
