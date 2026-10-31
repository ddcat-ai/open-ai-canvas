//! Build an extracted, pinned public checkout; never run in a developer checkout.
//! The caller owns archive verification/extraction, staging publication and the gateway.
use crate::download;
use anyhow::{bail, ensure, Context, Result};
use fs2::FileExt;
use reqwest::blocking::Client;
use sha2::{Digest, Sha256};
use std::{
    env, ffi::{OsStr, OsString}, fs::{self, File, OpenOptions},
    io::{Read, Write}, path::{Path, PathBuf}, process::{Command, Stdio},
    sync::{Arc, Mutex}, thread, time::{Duration, Instant},
};

const MAX_DOWNLOAD: u64 = 500 * 1024 * 1024;
const MAX_LOG: u64 = 8 * 1024 * 1024;


#[derive(Clone)]
struct Log(Arc<Mutex<File>>);
impl Log {
    fn line(&self, line: &str) {
        // Do not persist dependency URLs (which can contain credentials) or secret-like lines.
        let lower = line.to_ascii_lowercase();
        let safe = if ["authorization", "password", "token=", "token:", "api_key", "apikey", "secret="].iter().any(|s| lower.contains(s)) {
            "[sensitive output omitted]".to_owned()
        } else {
            line.split_whitespace().map(|s| if s.contains("://") { "[URL]" } else { s }).collect::<Vec<_>>().join(" ")
        };
        if let Ok(mut file) = self.0.lock() {
            if file.metadata().map(|m| m.len() < MAX_LOG).unwrap_or(false) {
                let _ = writeln!(file, "{}", safe.chars().take(4096).collect::<String>());
            }
        }
    }
}

struct Builder {
    source: PathBuf, release: PathBuf, cache: PathBuf, progress: PathBuf,
    log: Log, mirror: bool, path: OsString, client: Client,
}

/// `source` must be a disposable extracted checkout with no `.git` directory.
/// Outputs are written into the caller's staging `release`, not atomically published.
/// Progress: `log_path.with_extension("progress.json")`, <= 4 KiB, with
/// `{stage, percent, message}`. Errors preserve the staging tree for diagnosis.
/// Missing Windows C compiler is bootstrapped with verified portable LLVM-MinGW.
/// Linux/macOS require a system C compiler/SDK; no global installation occurs.
pub fn build_source(source: &Path, release: &Path, cache: &Path, version: &str,
                    commit: &str, use_mirror: bool, log_path: &Path) -> Result<()> {
    ensure!(commit.len() == 40 && commit.bytes().all(|b| b.is_ascii_hexdigit()), "源码提交必须是完整的 40 位 Git SHA。");
    ensure!(!version.is_empty() && version.len() < 128 && version.bytes().all(|b| b.is_ascii_alphanumeric() || b".-_+".contains(&b)), "版本号无效。");
    let source = native_tool_path(fs::canonicalize(source).context("源码目录不存在")?);
    ensure!(!source.join(".git").exists(), "拒绝在开发 checkout 中安装；请传入已解压的独立源码目录。");
    for name in ["backend/go.mod", "web/package.json", "web/bun.lock", "backend/agent-runtime/pi/package-lock.json", "plugin-packages"] {
        ensure!(source.join(name).exists(), "源码缺少必需文件：{name}");
    }
    fs::create_dir_all(cache)?;
    fs::create_dir_all(release)?;
    let cache = native_tool_path(fs::canonicalize(cache)?);
    let release = native_tool_path(fs::canonicalize(release)?);
    ensure!(!release.starts_with(&source) && !source.starts_with(&release), "源码与安装目录不能互相包含。");
    ensure!(!cache.starts_with(&source) && !cache.starts_with(&release), "工具缓存不能位于源码或安装目录内部。");
    ensure!(!release.join("runtime").exists() && !release.join("plugin-packages").exists(), "源码构建需要新的暂存目录，不能覆盖已有运行文件。");
    let lock = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(cache.join("source-build.lock"))?;
    lock.try_lock_exclusive().context("另一个源码安装正在使用工具缓存，请稍后重试")?;
    if let Some(parent) = log_path.parent() { fs::create_dir_all(parent)?; }
    let log = Log(Arc::new(Mutex::new(OpenOptions::new().create(true).append(true).open(log_path)?)));
    let mut b = Builder {
        source, release, cache, progress: log_path.with_extension("progress.json"), log,
        mirror: use_mirror, path: env::var_os("PATH").unwrap_or_default(),
        client: Client::builder().https_only(true).connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(600)).user_agent("yingce-launcher-source-builder")
            .redirect(reqwest::redirect::Policy::limited(5)).build()?,
    };
    let result = b.build(version, commit);
    if result.is_err() { let _ = b.stage("failed", 0, "源码构建失败；请查看构建日志。修正依赖后可重试。"); }
    result
}

// Rust canonicalization returns verbatim Windows paths. LLVM's C include search
// does not understand that prefix even when the referenced header exists.
fn native_tool_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)] {
        use std::os::windows::ffi::{OsStrExt, OsStringExt};
        let wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
        let prefix = [92u16, 92, 63, 92];
        if wide.starts_with(&prefix) {
            let tail = &wide[4..];
            if tail.starts_with(&[85u16, 78, 67, 92]) {
                let mut out = vec![92u16, 92]; out.extend_from_slice(&tail[4..]);
                return PathBuf::from(OsString::from_wide(&out));
            }
            return PathBuf::from(OsString::from_wide(tail));
        }
    }
    path
}

impl Builder {
    fn stage(&self, stage: &str, percent: u8, message: &str) -> Result<()> {
        self.log.line(&format!("[{stage}] {message}"));
        let data = serde_json::to_vec(&serde_json::json!({"stage":stage,"percent":percent,"message":message}))?;
        let tmp = self.progress.with_extension("json.tmp");
        fs::write(&tmp, data)?;
        // Windows cannot rename over an existing file. Readers may retry during this tiny gap.
        if self.progress.exists() { fs::remove_file(&self.progress)?; }
        fs::rename(tmp, &self.progress)?;
        Ok(())
    }

    fn command(&self, exe: &Path, cwd: &Path) -> Command {
        let mut c = Command::new(exe);
        c.current_dir(cwd).env_clear();
        // A whitelist, not a blacklist: no cloud/API keys, proxy credentials, NODE_OPTIONS,
        // npm auth, custom Go flags or developer application configuration reach children.
        for key in ["SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "LANG", "LC_ALL", "NUMBER_OF_PROCESSORS"] {
            if let Some(v) = env::var_os(key) { c.env(key, v); }
        }
        c.env("PATH", &self.path).env("CI", "1")
            .env("GOENV", "off").env("GOWORK", "off").env("GOTOOLCHAIN", "local")
            .env("GOPROXY", if self.mirror { "https://goproxy.cn" } else { "https://proxy.golang.org,direct" })
            .env("GOSUMDB", "sum.golang.org")
            .env("GOMODCACHE", self.cache.join("gomod")).env("GOCACHE", self.cache.join("gobuild"))
            .env("BUN_INSTALL_CACHE_DIR", self.cache.join("bun-deps"))
            .env("npm_config_cache", self.cache.join("npm-deps"))
            .env("npm_config_userconfig", self.cache.join("empty.npmrc"))
            .env("npm_config_globalconfig", self.cache.join("empty-global.npmrc"))
            .env("npm_config_registry", if self.mirror { "https://registry.npmmirror.com" } else { "https://registry.npmjs.org" })
            .env("GIT_CONFIG_NOSYSTEM", "1").env("GIT_CONFIG_GLOBAL", if cfg!(windows) { "NUL" } else { "/dev/null" })
            .env("GIT_TERMINAL_PROMPT", "0");
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x08000000); // CREATE_NO_WINDOW; never open a console window.
        }
        c
    }

    fn run(&self, label: &str, mut command: Command) -> Result<()> {
        self.log.line(&format!("[{label}] started"));
        let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
            .with_context(|| format!("无法启动构建阶段 {label}"))?;
        let stdout = child.stdout.take().context("缺少子进程 stdout")?;
        let stderr = child.stderr.take().context("缺少子进程 stderr")?;
        let a = pipe_log(stdout, self.log.clone());
        let b = pipe_log(stderr, self.log.clone());
        let start = Instant::now();
        let status = loop {
            if let Some(status) = child.try_wait()? { break status; }
            if start.elapsed() > Duration::from_secs(45 * 60) {
                let _ = child.kill(); let _ = child.wait();
                bail!("构建阶段 {label} 超过 45 分钟，已停止；请查看构建日志。");
            }
            thread::sleep(Duration::from_millis(250));
        };
        let _ = a.join(); let _ = b.join();
        ensure!(status.success(), "构建阶段 {label} 失败（退出码 {:?}）；请查看构建日志。", status.code());
        self.log.line(&format!("[{label}] completed"));
        Ok(())
    }

    fn probe(&self, exe: &Path, args: &[&str]) -> Option<String> {
        // Version queries are trusted local toolchain commands, not repository scripts.
        let out = self.command(exe, &self.cache).args(args).output().ok()?;
        if !out.status.success() || out.stdout.len() > 16384 { return None; }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_owned())
    }

    fn prepend(&mut self, exe: &Path) -> Result<()> {
        let mut paths = vec![exe.parent().context("工具路径缺少父目录")?.to_path_buf()];
        paths.extend(env::split_paths(&self.path));
        self.path = env::join_paths(paths)?;
        Ok(())
    }

    fn installed(&self, name: &str, minimum: (u32,u32,u32), args: &[&str]) -> Option<PathBuf> {
        env::split_paths(&self.path).map(|p| p.join(executable(name))).find(|p| {
            p.is_file() && self.probe(p, args).and_then(|s| parse_version(&s)).map(|v| v >= minimum).unwrap_or(false)
        })
    }

    fn build(&mut self, version: &str, commit: &str) -> Result<()> {
        self.stage("toolchains", 5, "检查 Go、Bun、Node 与 SQLite C 编译器；缺失工具仅下载到本地缓存。")?;
        fs::write(self.cache.join("empty.npmrc"), b"")?;
        fs::write(self.cache.join("empty-global.npmrc"), b"")?;
        fs::write(self.cache.join("bunfig.toml"), if self.mirror {
            "[install]\nregistry = \"https://registry.npmmirror.com\"\n"
        } else { "[install]\nregistry = \"https://registry.npmjs.org\"\n" })?;
        let go_mod = fs::read_to_string(self.source.join("backend/go.mod"))?;
        let go_version = go_mod.lines().find_map(|l| l.strip_prefix("go ")).context("go.mod 缺少 go 版本")?.trim();
        let go_min = parse_version(go_version).context("go.mod 的 Go 版本无效")?;
        let web: serde_json::Value = serde_json::from_slice(&fs::read(self.source.join("web/package.json"))?)?;
        let bun_version = web["packageManager"].as_str().and_then(|s| s.strip_prefix("bun@")).context("前端 packageManager 必须指定 bun 版本")?;
        let bun_min = parse_version(bun_version).context("Bun 版本无效")?;
        ensure!(bun_version.bytes().all(|b| b.is_ascii_digit() || b == b'.'), "Bun 版本必须为固定版本号。");
        let go = match self.installed("go", go_min, &["version"]) { Some(p) => p, None => self.portable_go(go_version)? };
        self.prepend(&go)?;
        let bun = match self.installed("bun", bun_min, &["--version"]) { Some(p) => p, None => self.portable_bun(bun_version)? };
        self.prepend(&bun)?;
        let mut node = self.installed("node", (22,19,0), &["--version"]);
        // Resolve symlink/shim location to locate the npm CLI bundled with Node.
        if let Some(p) = &node {
            node = self.probe(p, &["-p", "process.execPath"]).map(PathBuf::from);
        }
        let node = match node.filter(|p| npm_cli(p).is_some() && node_license(p).is_some()) { Some(p) => p, None => self.portable_node()? };
        let npm = npm_cli(&node).context("Node 工具包缺少 npm CLI")?;
        self.prepend(&node)?;
        let cc = ["gcc", "clang", "cc"].iter().find_map(|name| {
            env::split_paths(&self.path).map(|p| p.join(executable(name))).find(|p| p.is_file() && self.probe(p, &["--version"]).is_some())
        });
        let cc = match cc {
            Some(p) => p,
            None if cfg!(windows) => self.portable_cc()?,
            None => bail!("SQLite 需要原生 C 编译器：Debian/Ubuntu 安装 build-essential，Fedora 安装 gcc 与 glibc-devel，macOS 执行 xcode-select --install。不会以 CGO=0 生成不可用后端。"),
        };
        self.prepend(&cc)?;
        self.log.line("[toolchains] Go/Bun/Node/C compiler available; CGO_ENABLED=1");
        let runtime = self.release.join("runtime");
        fs::create_dir_all(runtime.join("bin"))?;
        fs::create_dir_all(runtime.join("node"))?;
        // Verify the compiler really links a native program before expensive dependency downloads.
        fs::write(self.cache.join("cgo-probe.c"), "int main(void) { return 0; }\n")?;
        let mut cmd = self.command(&cc, &self.cache);
        cmd.arg(self.cache.join("cgo-probe.c")).arg("-o").arg(self.cache.join(executable("cgo-probe")));
        if cfg!(windows) { cmd.arg("-static"); }
        self.run("C compiler link check", cmd)?;
        self.run("C compiler native execution check", self.command(&self.cache.join(executable("cgo-probe")), &self.cache))?;
        let backend = self.source.join("backend");
        patch_launcher_shutdown(&self.source)?;
        crate::source_adapt::prepare_agent_source(&self.source)?;
        self.stage("backend", 20, "下载校验 Go 模块并编译启用 SQLite 的本机后端。")?;
        let mut cmd = self.command(&go, &backend);
        cmd.args(["mod", "download"]);
        self.run("Go dependencies", cmd)?;
        let ldflags = format!("-s -w -X yingce/backend/internal/buildinfo.Version={version} -X yingce/backend/internal/buildinfo.Commit={commit}");
        let mut cmd = self.command(&go, &backend);
        // Go parses CC as a quoted argv string itself; it does not invoke a shell.
        let cc_value = format!("\"{}\"", cc.to_str().context("C 编译器路径不是有效 Unicode")?);
        cmd.env("CGO_ENABLED", "1").env("CC", cc_value).args(["build", "-trimpath", "-buildvcs=false", "-mod=readonly", "-ldflags", &ldflags, "-o"])
            .arg(runtime.join("bin").join(executable("yingce-backend"))).arg("./cmd/server");
        if cfg!(windows) { cmd.env("CGO_LDFLAGS", "-static"); }
        self.run("Go backend", cmd)?;
        self.stage("web-dependencies", 45, "按锁文件安装前端依赖。")?;
        let web_dir = self.source.join("web");
        let mut cmd = self.command(&bun, &web_dir);
        cmd.args(["install", "--frozen-lockfile"]).arg(if self.mirror { "--registry=https://registry.npmmirror.com" } else { "--registry=https://registry.npmjs.org" });
        self.run("Bun dependencies", cmd)?;
        ensure!(web_dir.join("node_modules/vite/bin/vite.js").is_file(), "Bun 未安装 Vite，拒绝继续构建");
        self.stage("web-build", 60, "构建真实 Vite 前端，与仓库 Dockerfile 的生产构建一致。")?;
        let mut cmd = self.command(&bun, &web_dir);
        cmd.args(["--bun", "./node_modules/vite/bin/vite.js", "build"])
            .env("CANVAS_BUILD_VERSION", version).env("CANVAS_BUILD_COMMIT", commit);
        self.run("Vite production build", cmd)?;
        ensure!(web_dir.join("dist/index.html").is_file(), "前端构建没有生成 dist/index.html");
        copy_tree(&web_dir.join("dist"), &runtime.join("web"))?;
        self.stage("agent", 75, "安装 Agent 生产依赖并打包 Node 运行时。")?;
        let agent = runtime.join("agent");
        fs::create_dir_all(&agent)?;
        for file in ["agent-runtime.mjs", "package.json", "package-lock.json"] {
            fs::copy(self.source.join("backend/agent-runtime/pi").join(file), agent.join(file))?;
        }
        fs::copy(&node, runtime.join("node").join(executable("node")))?;
        fs::copy(node_license(&node).context("Node 安装缺少分发许可证")?, runtime.join("node/LICENSE"))?;
        let mut cmd = self.command(&node, &agent);
        cmd.arg(npm).args(["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);
        self.run("Agent npm ci", cmd)?;
        crate::source_adapt::materialize_agent_links(&agent)?;
        ensure!(agent.join("node_modules/@earendil-works/pi-coding-agent/package.json").is_file(), "Agent 依赖未正确安装");
        self.stage("plugins", 90, "打包插件并为当前平台编译支付插件。")?;
        self.plugins(&go, &node)?;
        self.stage("media", 94, "准备 FFmpeg 与媒体探测工具。")?;
        if !crate::source_media::prepare_media(&self.release, &self.cache)? { self.log.line("[media] FFmpeg unavailable: timeline rendering and media probing need a system FFmpeg installation"); }
        self.stage("source-built", 95, "源码运行文件已构建，等待启动器组装网关与校验。")?;
        Ok(())
    }

    fn get(&self, url: &str, max: u64) -> Result<Vec<u8>> {
        let mut errors = Vec::new();
        for selected in dependency_candidates(url, self.mirror)? {
            let attempt = (|| -> Result<Vec<u8>> {
                let response = self.client.get(&selected).send().context("连接工具下载站失败")?;
                ensure!(response.status().is_success(), "下载返回 HTTP {}", response.status().as_u16());
                ensure!(response.content_length().unwrap_or(0) <= max, "工具下载超过大小上限");
                let mut bytes = Vec::new();
                response.take(max + 1).read_to_end(&mut bytes).context("读取工具下载失败")?;
                ensure!(bytes.len() as u64 <= max, "工具下载超过大小上限");
                Ok(bytes)
            })();
            match attempt {
                Ok(bytes) => return Ok(bytes),
                Err(error) => {
                    self.log.line(&format!("[toolchains] source failed, trying the next one: {error:#}"));
                    errors.push(format!("{error:#}"));
                }
            }
        }
        bail!("工具下载失败（已尝试全部来源）：{}；可检查网络或在设置中切换镜像模式", errors.join("；"))
    }

    fn archive(&self, url: &str, sha: &str, name: &str) -> Result<PathBuf> {
        ensure!(sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit()), "官方工具缺少有效 SHA-256 校验值，已拒绝下载");
        let target = self.cache.join(name);
        if target.exists() && hash_file(&target)? == sha.to_ascii_lowercase() { return Ok(target); }
        self.log.line(&format!("[toolchains] downloading {name} (limit 500 MiB, SHA-256 required)"));
        let expected = sha.to_ascii_lowercase();
        let mut errors = Vec::new();
        let last = std::cell::Cell::new(Instant::now());
        for selected in dependency_candidates(url, self.mirror)? {
            // Resume only from the same source: mirrors may not serve byte-identical files.
            let part = self.cache.join(format!("{name}.{}.part", &hex::encode(Sha256::digest(selected.as_bytes()))[..12]));
            let report = |done: u64, total: Option<u64>| {
                if last.get().elapsed() >= Duration::from_secs(5) {
                    self.log.line(&format!("[toolchains] {name}: {} / {} MiB", done / 1024 / 1024, total.map(|t| (t / 1024 / 1024).to_string()).unwrap_or_else(|| "?".into())));
                    last.set(Instant::now());
                }
            };
            let attempt = download::fetch_to_file(&self.client, &selected, &part, &download::Options::new(MAX_DOWNLOAD), &report)
                .and_then(|_| {
                    if hash_file(&part)? == expected { Ok(()) } else {
                        let _ = fs::remove_file(&part);
                        bail!("官方工具 SHA-256 校验失败")
                    }
                });
            match attempt {
                Ok(()) => {
                    if target.exists() { fs::remove_file(&target)?; }
                    fs::rename(&part, &target)?;
                    return Ok(target);
                }
                Err(error) => {
                    self.log.line(&format!("[toolchains] source failed, trying the next one: {error:#}"));
                    errors.push(format!("{error:#}"));
                }
            }
        }
        bail!("工具下载失败（已尝试全部来源）：{}；可检查网络或在设置中切换镜像模式", errors.join("；"))
    }

    fn unpack(&self, archive: &Path, target: &Path) -> Result<()> {
        if target.exists() { fs::remove_dir_all(target)?; }
        fs::create_dir_all(target)?;
        if archive.extension() == Some(OsStr::new("zip")) {
            let mut zip = zip::ZipArchive::new(File::open(archive)?)?;
            ensure!(zip.len() <= 100_000, "工具压缩包文件过多");
            let mut total = 0u64;
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i)?;
                total = total.checked_add(entry.size()).context("工具压缩包过大")?;
                ensure!(total <= 2 * 1024 * 1024 * 1024, "工具解压超过 2 GiB 上限");
                let relative = entry.enclosed_name().context("工具压缩包存在不安全路径")?.to_path_buf();
                ensure!(entry.unix_mode().map(|m| m & 0o170000 != 0o120000).unwrap_or(true), "工具压缩包不允许符号链接");
                let out = target.join(relative);
                if entry.is_dir() { fs::create_dir_all(out)?; continue; }
                if let Some(parent) = out.parent() { fs::create_dir_all(parent)?; }
                let mut file = File::create(&out)?;
                let written = std::io::copy(&mut entry, &mut file)?;
                ensure!(written <= 2 * 1024 * 1024 * 1024, "工具文件解压过大");
                #[cfg(unix)] {
                    use std::os::unix::fs::PermissionsExt;
                    if let Some(mode) = entry.unix_mode() { fs::set_permissions(&out, fs::Permissions::from_mode(mode & 0o777))?; }
                }
            }
        } else {
            // Only SHA-256-verified official Go/Node archives reach the system tar tool.
            let tar = env::split_paths(&self.path).map(|p| p.join(executable("tar"))).find(|p| p.is_file()).context("解压 Go/Node 需要系统 tar 工具")?;
            let mut cmd = self.command(&tar, &self.cache);
            cmd.arg("-xzf").arg(archive).arg("-C").arg(target);
            self.run("Extract verified toolchain", cmd)?;
        }
        Ok(())
    }

    fn portable_go(&self, version: &str) -> Result<PathBuf> {
        ensure!(version.bytes().all(|b| b.is_ascii_digit() || b == b'.'), "Go 版本必须为固定版本号");
        let (os, arch) = platform()?;
        let ext = if cfg!(windows) { "zip" } else { "tar.gz" };
        let name = format!("go{version}.{os}-{arch}.{ext}");
        let root = self.cache.join(format!("go-{version}-{os}-{arch}"));
        let exe = root.join("go/bin").join(executable("go"));
        if self.probe(&exe, &["version"]).and_then(|s| parse_version(&s)) == parse_version(version) { return Ok(exe); }
        let index: serde_json::Value = serde_json::from_slice(&self.get("https://go.dev/dl/?mode=json&include=all", 16 * 1024 * 1024)?)?;
        let sha = index.as_array().into_iter().flatten().flat_map(|v| v["files"].as_array().into_iter().flatten())
            .find(|f| f["filename"].as_str() == Some(&name)).and_then(|f| f["sha256"].as_str()).context("Go 官方目录未找到要求版本的 SHA-256")?;
        let archive = self.archive(&format!("https://go.dev/dl/{name}"), sha, &name)?;
        self.unpack(&archive, &root)?;
        ensure!(self.probe(&exe, &["version"]).and_then(|s| parse_version(&s)) == parse_version(version), "便携 Go 无法运行");
        Ok(exe)
    }

    fn portable_node(&self) -> Result<PathBuf> {
        let index: serde_json::Value = serde_json::from_slice(&self.get("https://nodejs.org/dist/index.json", 8 * 1024 * 1024)?)?;
        let version = index.as_array().context("Node 官方版本目录无效")?.iter()
            .filter(|entry| entry["lts"].is_string())
            .filter_map(|entry| { let value = entry["version"].as_str()?.trim_start_matches('v'); let parsed = parse_version(value)?; if parsed >= (22,19,0) { Some((parsed, value)) } else { None } })
            .max_by_key(|(parsed, _)| *parsed).map(|(_, value)| value).context("Node 官方目录缺少兼容的 LTS")?;
        let (os, arch) = platform()?;
        let node_os = if os == "windows" { "win" } else { os };
        let node_arch = if arch == "amd64" { "x64" } else { arch };
        let ext = if cfg!(windows) { "zip" } else { "tar.gz" };
        let dir = format!("node-v{version}-{node_os}-{node_arch}");
        let name = format!("{dir}.{ext}");
        let root = self.cache.join(format!("node-{version}-{node_os}-{node_arch}"));
        let exe = if cfg!(windows) { root.join(&dir).join("node.exe") } else { root.join(&dir).join("bin/node") };
        if self.probe(&exe, &["--version"]).and_then(|s| parse_version(&s)) == parse_version(version) && npm_cli(&exe).is_some() && node_license(&exe).is_some() { return Ok(exe); }
        let sums = String::from_utf8(self.get(&format!("https://nodejs.org/dist/v{version}/SHASUMS256.txt"), 1024 * 1024)?)?;
        let sha = checksum(&sums, &name).context("Node 官方目录未找到 SHA-256")?;
        let archive = self.archive(&format!("https://nodejs.org/dist/v{version}/{name}"), &sha, &name)?;
        self.unpack(&archive, &root)?;
        ensure!(self.probe(&exe, &["--version"]).and_then(|s| parse_version(&s)) == parse_version(version), "便携 Node 无法运行");
        Ok(exe)
    }

    fn portable_bun(&self, version: &str) -> Result<PathBuf> {
        let (os, arch) = platform()?;
        let arch = if arch == "amd64" { "x64" } else { "aarch64" };
        let suffix = if arch == "x64" { "-baseline" } else { "" };
        let dir = format!("bun-{os}-{arch}{suffix}");
        let name = format!("{dir}.zip");
        let root = self.cache.join(format!("bun-{version}-{os}-{arch}"));
        let exe = root.join(&dir).join(executable("bun"));
        if self.probe(&exe, &["--version"]).and_then(|s| parse_version(&s)) == parse_version(version) { return Ok(exe); }
        // Bundled upstream digests avoid an extra API dependency for the supported
        // bootstrap version; mirrored binaries must match the official hash.
        let pinned: serde_json::Value = serde_json::from_str(include_str!("../bun-releases.json"))?;
        let matched = if pinned["version"].as_str() == Some(version) { pinned["assets"].as_array().and_then(|assets| assets.iter().find(|asset| asset["name"].as_str() == Some(name.as_str()))) } else { None };
        let (url, sha) = match matched {
            Some(asset) => (asset["url"].as_str().context("Bun 固定下载地址缺失")?.to_owned(), asset["sha"].as_str().context("Bun 固定摘要缺失")?.to_owned()),
            None => self.github_asset("oven-sh/bun", &format!("bun-v{version}"), &name)?,
        };
        let archive = self.archive(&url, &sha, &format!("bun-{version}-{name}"))?;
        self.unpack(&archive, &root)?;
        ensure!(self.probe(&exe, &["--version"]).and_then(|s| parse_version(&s)) == parse_version(version), "便携 Bun 无法运行");
        Ok(exe)
    }

    fn github_asset(&self, repo: &str, tag: &str, name: &str) -> Result<(String, String)> {
        // All components are fixed constants or previously validated version/platform strings.
        let release: serde_json::Value = serde_json::from_slice(&self.get(
            &format!("https://api.github.com/repos/{repo}/releases/tags/{tag}"), 4 * 1024 * 1024)?)?;
        ensure!(release["tag_name"].as_str() == Some(tag) && release["draft"] == false, "工具发布信息无效");
        let asset = release["assets"].as_array().context("工具发布缺少附件")?.iter()
            .find(|a| a["name"].as_str() == Some(name)).context("官方发布缺少当前平台的工具附件")?;
        ensure!(asset["size"].as_u64().unwrap_or(u64::MAX) <= MAX_DOWNLOAD, "工具附件超过 500 MiB 上限");
        let url = format!("https://github.com/{repo}/releases/download/{tag}/{name}");
        ensure!(asset["browser_download_url"].as_str() == Some(url.as_str()), "工具附件下载地址不属于固定官方发布");
        let sha = asset["digest"].as_str().and_then(|s| s.strip_prefix("sha256:"))
            .context("官方发布缺少 SHA-256；拒绝使用未经校验的工具")?;
        Ok((url, sha.to_owned()))
    }

    fn portable_cc(&self) -> Result<PathBuf> {
        const TAG: &str = "20261020";
        let host = if env::consts::ARCH == "aarch64" { "aarch64" } else { "x86_64" };
        let dir = format!("llvm-mingw-{TAG}-ucrt-{host}");
        let name = format!("{dir}.zip");
        let root = self.cache.join(&dir);
        let target = if host == "aarch64" { "aarch64" } else { "x86_64" };
        let exe = root.join(&dir).join("bin").join(format!("{target}-w64-mingw32-gcc.exe"));
        if self.probe(&exe, &["--version"]).is_some() { return Ok(exe); }
        let (url, sha) = if host == "x86_64" {
            ("https://github.com/mstorsjo/llvm-mingw/releases/download/20261020/llvm-mingw-20261020-ucrt-x86_64.zip".to_owned(), "fd5462b7f5d93b2ff981fcd3f9c7e427e47f3203c64ea91c27bcc444eebd74cd".to_owned())
        } else { self.github_asset("mstorsjo/llvm-mingw", TAG, &name)? };
        let archive = self.archive(&url, &sha, &name)?;
        self.unpack(&archive, &root)?;
        ensure!(self.probe(&exe, &["--version"]).is_some(), "便携 LLVM-MinGW 无法运行");
        Ok(exe)
    }

    fn plugins(&self, go: &Path, node: &Path) -> Result<()> {
        let source = self.source.join("plugin-packages");
        let target = self.release.join("plugin-packages");
        fs::create_dir_all(&target)?;
        // Reproduce build-packages.sh using explicit argv, no host shell required.
        let mut cmd = self.command(node, &self.source);
        cmd.arg(source.join("embed-documentation.mjs"));
        self.run("Plugin documentation", cmd)?;
        let (os, arch) = platform()?;
        for (id, command) in [("wechat-native", "wechat"), ("alipay-page", "alipay"), ("xunhupay", "xunhupay"), ("zhifufm", "zhifufm"), ("epay", "epay")] {
            let dir = source.join(format!("official-payment-{id}")).join("backend");
            fs::create_dir_all(&dir)?;
            let name = executable(&format!("provider-{os}-{arch}"));
            let mut cmd = self.command(go, &self.source.join("backend"));
            cmd.env("CGO_ENABLED", "0").args(["build", "-trimpath", "-buildvcs=false", "-mod=readonly", "-ldflags=-s -w", "-o"])
                .arg(dir.join(name)).arg(format!("./cmd/payment-{command}"));
            self.run("Payment plugin", cmd)?;
            fs::copy(dir.join(executable(&format!("provider-{os}-{arch}"))), dir.join("provider"))?;
        }
        let mut count = 0;
        for path in unique_plugins(&source)? {
            let name = path.file_name().context("插件目录名称无效")?.to_string_lossy();
            package_plugin(&path, &target.join(format!("{name}.yingce-plugin")))?;
            count += 1;
        }
        ensure!(count > 0, "源码未提供可打包插件");
        Ok(())
    }
}

/// This adaptation is applied only to the disposable, pinned extracted checkout.
/// No product backend file in the developer repository is changed.
fn patch_launcher_shutdown(source: &Path) -> Result<()> {
    let main_path = source.join("backend/cmd/server/main.go");
    let helper = source.join("backend/cmd/server/launcher_shutdown.go");
    let main = fs::read_to_string(&main_path).context("源码缺少后端启动入口")?;
    let patched = "registerLauncherShutdown(r, localCancel)";
    if main.contains(patched) {
        ensure!(helper.is_file(), "源码关闭适配不完整，请重新下载源码");
        return Ok(());
    }
    let run = "func run(ctx context.Context) error {";
    let router = "r := gin.New()";
    ensure!(main.matches(run).count() == 1 && main.matches(router).count() == 1,
        "当前源码入口不支持启动器安全关闭适配，请使用受支持的正式源码提交");
    ensure!(!helper.exists(), "源码已包含同名关闭适配文件，请重新下载受支持源码");
    let main = main.replacen(run, &format!("{run}\n\tctx, localCancel := context.WithCancel(ctx)\n\tdefer localCancel()"), 1)
        .replacen(router, &format!("{router}\n\t{patched}"), 1);
    fs::write(&helper, r#"package main

import (
    "context"
    "crypto/subtle"
    "net"
    "os"
    "github.com/gin-gonic/gin"
)

// The launcher generates the private token. Never accept forwarded client IPs.
func registerLauncherShutdown(r *gin.Engine, cancel context.CancelFunc) {
    token := os.Getenv("YINGCE_BACKEND_SHUTDOWN_TOKEN")
    if len(token) < 32 { return }
    r.POST("/_yingce_launcher/shutdown", func(c *gin.Context) {
        host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
        ip := net.ParseIP(host)
        if err != nil || ip == nil || !ip.IsLoopback() ||
            subtle.ConstantTimeCompare([]byte(c.GetHeader("X-Yingce-Shutdown-Token")), []byte(token)) != 1 {
            c.Status(403)
            return
        }
        c.Status(202)
        go cancel()
    })
}
"#)?;
    fs::write(main_path, main)?;
    Ok(())
}

fn executable(name: &str) -> String { if cfg!(windows) { format!("{name}.exe") } else { name.to_owned() } }
fn platform() -> Result<(&'static str, &'static str)> {
    let os = match env::consts::OS { "windows" => "windows", "linux" => "linux", "macos" => "darwin", _ => bail!("源码安装暂不支持此操作系统") };
    let arch = match env::consts::ARCH { "x86_64" => "amd64", "aarch64" => "arm64", _ => bail!("源码安装仅支持 x64 与 ARM64") };
    Ok((os, arch))
}
/// Every source to try for a download, best first. GitHub assets can go through any approved
    /// public proxy; Go and Node have dedicated mirrors.
fn dependency_candidates(url: &str, mirror: bool) -> Result<Vec<String>> {
    let first = dependency_url(url, mirror)?;
    let mut all = vec![first];
    if mirror && matches!(url::Url::parse(url)?.host_str(), Some("github.com" | "api.github.com")) {
        for host in crate::core::PUBLIC_MIRRORS {
            let candidate = format!("https://{host}/{url}");
            if !all.contains(&candidate) { all.push(candidate); }
        }
    }
    Ok(all)
}
fn dependency_url(url: &str, mirror: bool) -> Result<String> {
    let parsed = url::Url::parse(url)?;
    ensure!(parsed.scheme() == "https", "工具下载必须使用 HTTPS");
    if !mirror { return Ok(url.into()); }
    Ok(match parsed.host_str() {
        Some("github.com" | "api.github.com") => format!("https://gh-proxy.com/{url}"),
        Some("nodejs.org") if parsed.path().starts_with("/dist/") => format!("https://npmmirror.com/mirrors/node/{}{}", parsed.path().trim_start_matches("/dist/"), parsed.query().map(|v| format!("?{v}")).unwrap_or_default()),
        Some("go.dev") if parsed.path().starts_with("/dl/go") => format!("https://mirrors.aliyun.com/golang/{}", parsed.path().trim_start_matches("/dl/")),
        Some("go.dev") => url.replacen("https://go.dev/", "https://golang.google.cn/", 1),
        _ => url.into(),
    })
}
fn node_license(node: &Path) -> Option<PathBuf> {
    let root = node.parent()?;
    [root.join("LICENSE"), root.join("../LICENSE")].into_iter().find(|path| path.is_file())
}
fn npm_cli(node: &Path) -> Option<PathBuf> {
    let dir = node.parent()?;
    [dir.join("node_modules/npm/bin/npm-cli.js"), dir.join("../lib/node_modules/npm/bin/npm-cli.js")].into_iter().find(|p| p.is_file())
}
fn parse_version(s: &str) -> Option<(u32,u32,u32)> {
    for part in s.split_whitespace() {
        let part = part.strip_prefix("go").or_else(|| part.strip_prefix('v')).unwrap_or(part);
        let mut p = part.split('.');
        if let (Some(a), Some(b)) = (p.next(), p.next()) {
            if let (Ok(a), Ok(b), Ok(c)) = (a.parse(), b.parse(), p.next().unwrap_or("0").parse()) { return Some((a,b,c)); }
        }
    }
    None
}
fn checksum(sums: &str, filename: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() == 2 && fields[1].trim_start_matches('*') == filename { Some(fields[0].to_ascii_lowercase()) } else { None }
    })
}
fn hash_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    ensure!(file.metadata()?.len() <= MAX_DOWNLOAD, "缓存工具文件过大");
    let mut hash = Sha256::new(); let mut buf = [0u8; 65536];
    loop { let n = file.read(&mut buf)?; if n == 0 { break; } hash.update(&buf[..n]); }
    Ok(hex::encode(hash.finalize()))
}
fn pipe_log(mut stream: impl Read + Send + 'static, log: Log) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut chunk = [0u8; 4096]; let mut line = Vec::new();
        while let Ok(n) = stream.read(&mut chunk) {
            if n == 0 { break; }
            for byte in &chunk[..n] {
                if *byte == b'\n' { log.line(&String::from_utf8_lossy(&line)); line.clear(); }
                else if line.len() < 4096 && (*byte >= 32 || *byte == b'\t') { line.push(*byte); }
            }
        }
        if !line.is_empty() { log.line(&String::from_utf8_lossy(&line)); }
    })
}
fn copy_tree(source: &Path, target: &Path) -> Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?; let ty = entry.file_type()?;
        ensure!(!ty.is_symlink(), "运行文件不允许符号链接");
        let out = target.join(entry.file_name());
        if ty.is_dir() { copy_tree(&entry.path(), &out)?; } else if ty.is_file() { fs::copy(entry.path(), out)?; }
    }
    Ok(())
}
fn plugin_runtime_contract(mut manifest: serde_json::Value) -> serde_json::Value {
    if let Some(object) = manifest.as_object_mut() { object.remove("documentation"); }
    if let Some(providers) = manifest.pointer_mut("/contributes/providers").and_then(|v| v.as_array_mut()) {
        for provider in providers {
            if let Some(parameters) = provider.get_mut("parameters").and_then(|v| v.as_array_mut()) {
                for parameter in parameters { if let Some(object) = parameter.as_object_mut() { object.remove("description"); } }
            }
        }
    }
    manifest
}
fn unique_plugins(source: &Path) -> Result<Vec<PathBuf>> {
    let mut by_id = std::collections::BTreeMap::<String, (PathBuf, serde_json::Value)>::new();
    for entry in fs::read_dir(source)? {
        let path = entry?.path();
        if !path.is_dir() || !path.join("manifest.json").is_file() { continue; }
        let manifest: serde_json::Value = serde_json::from_slice(&fs::read(path.join("manifest.json"))?)?;
        let id = manifest["id"].as_str().context("插件清单缺少 ID")?.to_owned();
        ensure!(!id.is_empty() && id.len() <= 200, "插件 ID 无效");
        if let Some((previous, original)) = by_id.get(&id) {
            let canonical = OsStr::new(&id);
            let alias = format!("src-{id}");
            ensure!(plugin_runtime_contract(original.clone()) == plugin_runtime_contract(manifest.clone()) &&
                ((previous.file_name() == Some(canonical) && path.file_name() == Some(OsStr::new(&alias))) ||
                 (path.file_name() == Some(canonical) && previous.file_name() == Some(OsStr::new(&alias)))),
                "源码含有内容冲突或不明确的重复插件 ID：{id}");
            // src-ID aliases may differ in human documentation, but not executable protocol fields.
            if path.file_name() == Some(canonical) { by_id.insert(id, (path, manifest)); }
        } else { by_id.insert(id, (path, manifest)); }
    }
    Ok(by_id.into_values().map(|(path, _)| path).collect())
}
fn package_plugin(source: &Path, output: &Path) -> Result<()> {
    fn add(zip: &mut zip::ZipWriter<File>, root: &Path, path: &Path) -> Result<()> {
        let metadata = fs::symlink_metadata(path)?;
        ensure!(!metadata.file_type().is_symlink(), "插件包不允许符号链接");
        if metadata.is_dir() {
            for entry in fs::read_dir(path)? { add(zip, root, &entry?.path())?; }
        } else if metadata.is_file() {
            let name = path.strip_prefix(root)?.to_string_lossy().replace('\\', "/");
            let mode = if name.starts_with("backend/") { 0o755 } else { 0o644 };
            zip.start_file(name, zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).unix_permissions(mode))?;
            std::io::copy(&mut File::open(path)?, zip)?;
        }
        Ok(())
    }
    let mut zip = zip::ZipWriter::new(File::create(output)?);
    for name in ["manifest.json", "README.md", "LICENSE", "docs", "assets", "web", "backend"] {
        let path = source.join(name); if path.exists() { add(&mut zip, source, &path)?; }
    }
    zip.finish()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_source_aliases_are_deduplicated_only_when_equal() {
        let root = env::temp_dir().join(format!("yingce-plugin-alias-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        for name in ["test", "src-test"] { fs::create_dir_all(root.join(name)).unwrap(); fs::write(root.join(name).join("manifest.json"), br#"{"id":"test","version":"1"}"#).unwrap(); }
        let selected = unique_plugins(&root).unwrap();
        assert_eq!(selected, vec![root.join("test")]);
        fs::write(root.join("src-test/manifest.json"), br#"{"id":"test","version":"2"}"#).unwrap();
        assert!(unique_plugins(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "explicit previously downloaded upstream fixture"]
    fn source_plugin_contract_probe() {
        let root = PathBuf::from(env::var_os("YINGCE_PLUGIN_FIXTURE").expect("isolated fixture required"));
        let selected = unique_plugins(&root).unwrap();
        println!("CANONICAL_PLUGIN_COUNT={}", selected.len());
        assert!(selected.iter().all(|path| !path.file_name().unwrap().to_string_lossy().starts_with("src-")));
    }
    #[cfg(windows)]
    #[test]
    fn cgo_paths_do_not_include_rust_verbatim_prefix() {
        assert_eq!(native_tool_path(PathBuf::from(r"\\?\C:\Users\测试\cache")), PathBuf::from(r"C:\Users\测试\cache"));
        assert_eq!(native_tool_path(PathBuf::from(r"\\?\UNC\server\share\cache")), PathBuf::from(r"\\server\share\cache"));
    }
    #[test]
    #[ignore = "explicit mirrored toolchain download and native executable probe"]
    fn bootstrap_mirror_live_probe() {
        let root = PathBuf::from(env::var_os("YINGCE_BOOTSTRAP_SMOKE_ROOT").expect("isolated root required"));
        assert!(root.is_absolute()); fs::create_dir_all(&root).unwrap();
        let file = OpenOptions::new().create(true).append(true).open(root.join("bootstrap.log")).unwrap();
        let builder = Builder { source: root.join("source"), release: root.join("release"), cache: root.clone(),
            progress:root.join("progress.json"),log:Log(Arc::new(Mutex::new(file))),mirror:true,
            path:env::var_os("PATH").unwrap_or_default(),client:Client::builder().https_only(true).timeout(Duration::from_secs(180)).build().unwrap() };
        let index: serde_json::Value = serde_json::from_slice(&builder.get("https://nodejs.org/dist/index.json",8*1024*1024).unwrap()).unwrap();
        assert!(index.is_array());
        let index: serde_json::Value = serde_json::from_slice(&builder.get("https://go.dev/dl/?mode=json&include=all",16*1024*1024).unwrap()).unwrap();
        assert!(index.is_array());
        let bun = builder.portable_bun("1.3.9").unwrap();
        assert_eq!(builder.probe(&bun, &["--version"]).and_then(|v|parse_version(&v)),Some((1,3,9)));
        println!("MIRROR_BOOTSTRAP_PASS: Node/Go catalogs and checksum-verified runnable Bun");
    }
    #[test]
    fn dependency_mirrors_are_opt_in() {
        let github = "https://api.github.com/repos/oven-sh/bun/releases/tags/bun-v1.3.9";
        let all = dependency_candidates(github, true).unwrap();
        assert_eq!(all.len(), crate::core::PUBLIC_MIRRORS.len());
        assert!(all[0].starts_with("https://gh-proxy.com/") && all.iter().any(|u| u.starts_with("https://gh.idayer.com/")) && all.iter().any(|u| u.starts_with("https://ghproxy.net/")));
        assert_eq!(dependency_candidates(github, false).unwrap(), vec![github.to_string()]);
        assert_eq!(dependency_candidates("https://go.dev/dl/go1.26.7.windows-amd64.zip", true).unwrap().len(), 1);
        assert_eq!(dependency_url(github, false).unwrap(), github);
        assert_eq!(dependency_url(github, true).unwrap(), format!("https://gh-proxy.com/{github}"));
        assert_eq!(dependency_url("https://nodejs.org/dist/index.json", true).unwrap(), "https://npmmirror.com/mirrors/node/index.json");
        assert_eq!(dependency_url("https://go.dev/dl/go1.26.7.windows-amd64.zip", true).unwrap(), "https://mirrors.aliyun.com/golang/go1.26.7.windows-amd64.zip");
    }
    #[test] fn versions() {
        assert_eq!(parse_version("go version go1.25.0 windows/amd64"), Some((1,25,0)));
        assert_eq!(parse_version("v22.19.0"), Some((22,19,0)));
        assert_eq!(parse_version("1.3.9"), Some((1,3,9)));
        assert_eq!(parse_version("not a version"), None);
    }
    #[test] fn checksums() {
        assert_eq!(checksum("abc  archive.zip\ndef *other.zip", "archive.zip"), Some("abc".into()));
        assert_eq!(checksum("abc  archive.zip.sig", "archive.zip"), None);
    }
}
