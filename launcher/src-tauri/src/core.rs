//! Independent source builds of the fixed public upstream repository.
use crate::{download, incremental, public_release::{self, PublicRelease, DEFAULT_API_ROOT, REPOSITORY_URL}, source_install};
use anyhow::{anyhow, bail, ensure, Context, Result};
use fs2::FileExt;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::TcpListener,
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use url::Url;

#[cfg(test)]
const MAX_MANIFEST: u64 = 2 * 1024 * 1024;
const MAX_STATE: u64 = 64 * 1024 * 1024;
const MAX_ARCHIVE: u64 = 4 * 1024 * 1024 * 1024;
/// Approved public GitHub proxies. Verified individually (small files, API tree and source archive)
/// from a Windows network; the first entry is the default. Order only matters before speed ranking.
pub const PUBLIC_MIRRORS: [&str; 6] = ["gh-proxy.com", "gh-proxy.org", "gh.idayer.com", "cors.isteed.cc", "ghfast.top", "ghproxy.net"];
const MAX_EXPANDED: u64 = 12 * 1024 * 1024 * 1024;
const MAX_FILES: usize = 100_000;
const MAX_LOG: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SourceMode {
    #[default]
    Auto,
    Official,
    Mirror,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Schedule {
    Daily,
    Interval,
}
/// Background "pull and prepare" schedule. It only builds the new version; switching stays manual.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoUpdate {
    pub enabled: bool,
    pub schedule: Schedule,
    /// Local `HH:MM`, used by the daily schedule.
    pub time: String,
    /// Hours between checks, used by the interval schedule.
    pub interval_hours: u32,
}
impl Default for AutoUpdate {
    fn default() -> Self {
        Self { enabled: false, schedule: Schedule::Daily, time: "03:00".into(), interval_hours: 24 }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub source_mode: SourceMode,
    pub official_url: Option<String>,
    pub mirror_url: Option<String>,
    pub port: u16,
    pub open_browser: bool,
    #[serde(default)]
    pub auto_update: AutoUpdate,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            source_mode: SourceMode::Mirror,
            official_url: Some(REPOSITORY_URL.into()),
            mirror_url: Some("https://gh-proxy.com/".into()),
            port: 37890,
            open_browser: true,
            auto_update: AutoUpdate::default(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRelease {
    pub version: String,
    pub commit: String,
    pub sequence: u64,
    pub release_id: String,
    pub data_schema: u32,
    #[serde(default)]
    pub data_dir: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Artifact {
    pub platform: String,
    pub arch: String,
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub kind: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Migration {
    pub data_schema: u32,
    pub requires_migration: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseManifest {
    pub schema_version: u32,
    pub sequence: u64,
    pub expires_at: u64,
    pub version: String,
    pub commit: String,
    pub channel: String,
    pub min_launcher_version: String,
    pub release_id: String,
    pub artifacts: Vec<Artifact>,
    pub migration: Migration,
    pub release_notes: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub manifest: ReleaseManifest,
    pub available: bool,
    pub source: String,
    pub can_install: bool,
    pub reason: Option<String>,
}
/// A fully built new version waiting for the user to stop the service and switch to it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedRelease {
    pub version: String,
    pub commit: String,
    pub sequence: u64,
    pub release_id: String,
    pub data_schema: u32,
    pub files: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedInfo {
    pub version: String,
    pub commit: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRecord {
    pub last_check: i64,
    pub last_result: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub config: Config,
    pub installed: Option<InstalledRelease>,
    pub running: bool,
    pub pid: Option<u32>,
    pub url: String,
    pub platform: String,
    pub repository_url: String,
    pub recovery_required: bool,
    pub preparing: bool,
    pub prepared: Option<PreparedInfo>,
    pub auto_record: AutoRecord,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    config: Config,
    installed: Option<InstalledRelease>,
    highest_sequence: u64,
    #[serde(default)]
    manifest_digest: Option<String>,
    #[serde(default)]
    files: BTreeMap<String, String>,
    #[serde(default)]
    prepared: Option<PreparedRelease>,
    #[serde(default)]
    auto: AutoRecord,
}
pub struct Manager {
    root: PathBuf,
    state: State,
    client: Client,
    child: Option<Child>,
    shutdown_token: Option<String>,
    pending_restore: Option<(Option<InstalledRelease>, BTreeMap<String, String>)>,
    busy: Arc<AtomicBool>,
    _lock: File,
    #[cfg(windows)]
    job: Option<Job>,
}
impl Manager {
    pub fn new(root: PathBuf) -> Result<Self> {
        ensure!(
            root.is_absolute(),
            "Application data directory must be absolute"
        );
        fs::create_dir_all(&root)?;
        reject_link(&root)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
        }
        for dir in ["state", "releases", "staging", "data", "logs", "cache", "data-versions", "sources", "temp", "runtime-home"] {
            let path = root.join(dir);
            fs::create_dir_all(&path)?;
            reject_link(&path)?;
        }
        let lock_path = root.join("state/manager.lock");
        if lock_path.exists() {
            reject_link(&lock_path)?;
        }
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join("state/manager.lock"))?;
        lock.try_lock_exclusive()
            .context("Another launcher owns this managed installation")?;
        // Staging only holds interrupted work; the exclusive lock above means nothing else uses it.
        if let Ok(entries) = fs::read_dir(root.join("staging")) {
            for entry in entries.flatten() {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
        let state_path = root.join("state/state.json");
        let state: State = if state_path.exists() {
            reject_link(&state_path)?;
            let bytes = read_bounded(File::open(&state_path)?, MAX_STATE)?;
            serde_json::from_slice(&bytes)
                .context("Invalid persisted state; manual recovery required")?
        } else {
            State::default()
        };
        validate_config(&state.config)?;
        if let Some(i) = &state.installed {
            validate_id(&i.release_id)?;
        }
        let client = Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 {
                    return attempt.error("Too many download redirects");
                }
                let url = attempt.url();
                let first_host = attempt
                    .previous()
                    .first()
                    .and_then(|u| u.host_str())
                    .unwrap_or("");
                let allowed = if PUBLIC_MIRRORS.contains(&first_host) {
                    url.host_str() == Some(first_host)
                } else {
                    [
                        "api.github.com",
                        "github.com",
                        "release-assets.githubusercontent.com",
                        "objects.githubusercontent.com",
                        "codeload.github.com",
                        "raw.githubusercontent.com",
                    ]
                    .contains(&url.host_str().unwrap_or(""))
                };
                if url.scheme() == "https"
                    && allowed
                    && url.username().is_empty()
                    && url.password().is_none()
                {
                    attempt.follow()
                } else {
                    attempt.error("Redirect outside approved public release hosts")
                }
            }))
            .user_agent("yingce-launcher/0.1.0")
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(600))
            .build()?;
        Ok(Self {
            root,
            state,
            client,
            child: None,
            shutdown_token: None,
            pending_restore: None,
            busy: Arc::new(AtomicBool::new(false)),
            _lock: lock,
            #[cfg(windows)]
            job: None,
        })
    }
    pub fn status(&mut self) -> Result<Status> {
        if let Some(child) = self.child.as_mut() {
            if child.try_wait()?.is_some() {
                self.child = None;
                #[cfg(windows)]
                {
                    self.job = None;
                }
            }
        }
        Ok(Status {
            config: self.state.config.clone(),
            installed: self.state.installed.clone(),
            running: self.child.is_some(),
            pid: self.child.as_ref().map(Child::id),
            url: format!("http://127.0.0.1:{}", self.state.config.port),
            platform: format!("{}-{}", platform()?.0, platform()?.1),
            repository_url: REPOSITORY_URL.into(),
            recovery_required: self.pending_restore.is_some(),
            preparing: self.busy.load(Ordering::SeqCst),
            prepared: self.state.prepared.as_ref().map(|p| PreparedInfo { version: p.version.clone(), commit: p.commit.clone() }),
            auto_record: self.state.auto.clone(),
        })
    }
    pub fn configure(&mut self, config: Config) -> Result<Status> {
        validate_config(&config)?;
        let old = self.state.config.clone();
        // The update schedule does not touch the running service, so it may change at any time.
        let schedule_only = Config { auto_update: old.auto_update.clone(), ..config.clone() } == old;
        ensure!(
            schedule_only || self.child.is_none(),
            "Stop the managed runtime before changing configuration"
        );
        self.state.config = config;
        if let Err(e) = self.save() {
            self.state.config = old;
            return Err(e);
        }
        self.status()
    }
    pub fn check_updates(&mut self) -> Result<UpdateInfo> {
        let (manifest, source, _) = self.fetch_manifest()?;
        let available = self
            .state
            .installed
            .as_ref()
            .map_or(true, |i| manifest.commit != i.commit);
        let reason = public_install_reason(&manifest, self.state.installed.is_some());
        Ok(UpdateInfo {
            manifest,
            available,
            source,
            can_install: reason.is_none(),
            reason,
        })
    }
    fn prepare_ctx(&self) -> Prepare {
        Prepare {
            root: self.root.clone(),
            client: self.client.clone(),
            config: self.state.config.clone(),
            installed_commit: self.state.installed.as_ref().map(|i| i.commit.clone()),
            prepared_commit: self.state.prepared.as_ref().map(|p| p.commit.clone()),
        }
    }
    fn fetch_manifest(&mut self) -> Result<(ReleaseManifest, String, Vec<u8>)> {
        self.prepare_ctx().fetch_manifest()
    }
    /// Prepares (unless already prepared) and switches to the latest commit. Requires a stopped service.
    pub fn install(&mut self) -> Result<Status> {
        ensure!(!self.status()?.running, "请先停止服务再安装或更新。");
        let _busy = BusyGuard::acquire(&self.busy)?;
        progress(&self.root, "resolve", 2, "读取公共仓库版本")?;
        let (manifest, _, _) = self.fetch_manifest()?;
        if let Some(installed) = &self.state.installed {
            ensure!(installed.commit != manifest.commit, "当前源码版本已经安装，无需重复更新。");
            verify_files(&self.root.join("releases").join(&installed.release_id), &self.state.files)?;
        }
        let prepared = match self.state.prepared.clone().filter(|p| p.commit == manifest.commit) {
            Some(prepared) => {
                verify_files(&self.root.join("releases").join(&prepared.release_id), &prepared.files)?;
                prepared
            }
            None => self.prepare_ctx().prepare(&manifest)?,
        };
        self.apply_prepared(prepared)
    }
    /// Switches to the version prepared in the background. Requires a stopped service.
    pub fn switch_prepared(&mut self) -> Result<Status> {
        ensure!(!self.status()?.running, "请先停止服务再切换到新版本。");
        let _busy = BusyGuard::acquire(&self.busy)?;
        let prepared = self.state.prepared.clone().context("没有已经准备好的新版本")?;
        if let Some(installed) = &self.state.installed {
            ensure!(installed.commit != prepared.commit, "该版本已经安装。");
            verify_files(&self.root.join("releases").join(&installed.release_id), &self.state.files)?;
        }
        progress(&self.root, "integrity", 2, "核对已准备好的新版本文件")?;
        verify_files(&self.root.join("releases").join(&prepared.release_id), &prepared.files)?;
        self.apply_prepared(prepared)
    }
    fn apply_prepared(&mut self, prepared: PreparedRelease) -> Result<Status> {
        let id = prepared.release_id.clone();
        let old_installed = self.state.installed.clone();
        let old_files = self.state.files.clone();
        let data_relative = format!("data-versions/{}-{}", id, SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis());
        let new_data = self.root.join(&data_relative);
        progress(&self.root, "backup", 87, "复制一致数据快照，保留旧版本和原始数据")?;
        let mut data_lock = None;
        if let Some(old) = &old_installed {
            let old_data = self.installed_data(old)?;
            let lock = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(old_data.join(".yingce-runtime.lock"))?;
            lock.try_lock_exclusive().context("旧版本仍在使用数据，不能并发更新")?;
            copy_snapshot(&old_data, &new_data)?;
            data_lock = Some(lock);
        } else { fs::create_dir(&new_data)?; }
        // Migrations run against the copy only. Original data and the persisted version pointer remain untouched until readiness.
        self.pending_restore = Some((old_installed.clone(), old_files.clone()));
        self.state.installed = Some(InstalledRelease { version: prepared.version.clone(), commit: prepared.commit.clone(),
            sequence: prepared.sequence, release_id: id, data_schema: prepared.data_schema, data_dir: Some(data_relative) });
        self.state.files = prepared.files.clone();
        let open_browser = self.state.config.open_browser;
        self.state.config.open_browser = false;
        progress(&self.root, "verify", 93, "启动真实后端并验证数据库和版本")?;
        let attempt = self.start_candidate();
        self.state.config.open_browser = open_browser;
        if let Err(error) = attempt {
            if let Err(stop_error) = self.stop() { bail!("候选服务启动失败且未能安全停止：{error:#}；{stop_error:#}"); }
            self.state.installed = old_installed;
            self.state.files = old_files;
            progress(&self.root, "failed", 93, "启动失败，原版本与原数据保持不变")?;
            return Err(error.context("启动验证失败，原版本与原数据未切换"));
        }
        let waiting = self.state.prepared.take();
        if let Err(error) = self.save() {
            self.state.prepared = waiting;
            self.stop()?;
            self.state.installed = old_installed;
            self.state.files = old_files;
            return Err(error.context("无法提交版本指针，原版本数据保留"));
        }
        self.pending_restore = None;
        drop(data_lock);
        progress(&self.root, "ready", 100, "源码安装完成，影策已经就绪")?;
        self.note("Source build switched; readiness verified; prior version and original data retained")?;
        if open_browser && self.open_browser().is_err() { self.note("Service ready; default browser failed, use Open button")?; }
        self.status()
    }
    /// Marks a scheduled background check as started when one is due and nothing else is running.
    pub fn claim_scheduled<Tz: chrono::TimeZone>(&mut self, now: &chrono::DateTime<Tz>) -> bool {
        if self.busy.load(Ordering::SeqCst) || !is_due(&self.state.config.auto_update, self.state.auto.last_check, now) {
            return false;
        }
        self.state.auto.last_check = now.timestamp();
        self.state.auto.last_result = "正在后台检查更新".into();
        self.save().is_ok()
    }
    fn finish_prepare(&mut self, outcome: Result<PrepareOutcome>) -> Result<String> {
        let result = outcome.and_then(|outcome| match outcome {
            PrepareOutcome::UpToDate => Ok("已经是最新版本".to_string()),
            PrepareOutcome::AlreadyPrepared(version) => Ok(format!("新版本 {version} 已准备好，停止服务后即可切换")),
            PrepareOutcome::Prepared(prepared) => {
                let message = format!("新版本 {} 已准备好，停止服务后即可切换", prepared.version);
                self.store_prepared(prepared)?;
                Ok(message)
            }
        });
        self.state.auto.last_check = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64;
        self.state.auto.last_result = match &result {
            Ok(message) => message.clone(),
            Err(error) => format!("失败：{error:#}"),
        };
        let _ = self.save();
        let _ = self.note(&format!("[auto-update] {}", self.state.auto.last_result));
        result
    }
    fn store_prepared(&mut self, prepared: PreparedRelease) -> Result<()> {
        let new_id = prepared.release_id.clone();
        let old = self.state.prepared.replace(prepared);
        if let Err(error) = self.save() {
            self.state.prepared = old;
            return Err(error);
        }
        if let Some(old) = old {
            let installed = self.state.installed.as_ref().map(|i| i.release_id.as_str());
            if old.release_id != new_id && installed != Some(old.release_id.as_str()) {
                let _ = fs::remove_dir_all(self.root.join("releases").join(&old.release_id));
            }
        }
        Ok(())
    }
    fn installed_data(&self, installed: &InstalledRelease) -> Result<PathBuf> {
        match &installed.data_dir {
            Some(relative) => {
                let path = safe_relative(relative)?;
                ensure!(relative.starts_with("data-versions/"), "Invalid managed data directory");
                Ok(self.root.join(path))
            },
            None => Ok(self.root.join("data")),
        }
    }
    pub fn start(&mut self) -> Result<Status> {
        ensure!(self.pending_restore.is_none(), "候选版本尚未完成恢复，请先停止服务。");
        progress(&self.root, "integrity", 0, "正在核对已安装的运行文件，请稍候")?;
        self.start_candidate()
    }
    fn start_candidate(&mut self) -> Result<Status> {
        if self.status()?.running {
            return self.status();
        }
        let installed = self
            .state
            .installed
            .as_ref()
            .context("Install a verified release first")?;
        let release = self.root.join("releases").join(&installed.release_id);
        let expected_commit = installed.commit.clone();
        let expected_version = installed.version.clone();
        let data_dir = self.installed_data(installed)?;
        verify_files(&release, &self.state.files)?;
        progress(&self.root, "launch", if self.pending_restore.is_some() { 94 } else { 0 }, "正在启动本地后端，等待数据库和服务就绪")?;
        let port = self.state.config.port;
        let reservation = TcpListener::bind(("127.0.0.1", port))
            .context("Configured browser port is in use; it will not be changed automatically")?;
        let executable = release.join(runtime_relative());
        let log_path = self.root.join("logs/runtime.log");
        rotate_log(&log_path)?;
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)?;
        let mut token_bytes = [0u8; 32];
        getrandom::fill(&mut token_bytes).map_err(|e| anyhow!("无法生成本地停机凭据：{e}"))?;
        let shutdown_token = hex::encode(token_bytes);
        let mut command = Command::new(&executable);
        command
            .current_dir(&release)
            .arg("--port")
            .arg(port.to_string())
            .arg("--data-dir")
            .arg(&data_dir)
            .env_clear()
            .env("CANVAS_BACKEND_DATA_DIR", &data_dir)
            .env("YINGCE_RUNTIME_SHUTDOWN_TOKEN", &shutdown_token)
            .env("TEMP", self.root.join("temp"))
            .env("TMP", self.root.join("temp"))
            .env("TMPDIR", self.root.join("temp"))
            .env("HOME", self.root.join("runtime-home"))
            .env("USERPROFILE", self.root.join("runtime-home"))
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log);
        // Windows runtime dependencies may require SystemRoot; never inherit secrets or arbitrary PATH.
        #[cfg(windows)]
        if let Some(value) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", value);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW: the console-subsystem gateway must not open a terminal; its
            // hidden console is inherited by the backend and Agent children.
            command.creation_flags(0x08000000);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(windows)]
        let job = Job::new()?;
        drop(reservation);
        let mut child = command
            .spawn()
            .context("Could not start packaged runtime")?;
        #[cfg(windows)]
        {
            if let Err(e) = job.assign(&child) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
            self.job = Some(job);
        }
        self.child = Some(child);
        self.shutdown_token = Some(shutdown_token);
        let health_client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(2))
            .build()?;
        let deadline = Instant::now() + Duration::from_secs(45);
        loop {
            if !self.status()?.running {
                bail!("Runtime exited before readiness; inspect runtime logs");
            }
            if let Ok(response) = health_client
                .get(format!("http://127.0.0.1:{port}/api/health/ready"))
                .send()
            {
                if response.status().is_success() {
                    if let Ok(raw) = read_bounded(response, 64 * 1024) {
                        if readiness_matches(&raw, &expected_version, &expected_commit) {
                            break;
                        }
                    }
                }
            }
            if Instant::now() >= deadline {
                self.stop()?;
                bail!("Runtime readiness/version handshake timed out; owned runtime stopped. Package build commit/version must match public release metadata.");
            }
            thread::sleep(Duration::from_millis(250));
        }
        self.note("Owned runtime ready on configured loopback port")?;
        if self.pending_restore.is_none() { progress(&self.root, "ready", 100, "影策服务已就绪")?; }
        if self.state.config.open_browser && self.open_browser().is_err() {
            self.note("Runtime is ready but default browser could not be opened")?;
        }
        self.status()
    }
    pub fn stop(&mut self) -> Result<Status> {
        if let Some(mut child) = self.child.take() {
            let result = (|| -> Result<()> {
                if child.try_wait()?.is_none() {
                    let token = self.shutdown_token.as_ref().context("缺少本地停机凭据，请勿强行更新数据")?;
                    let client = Client::builder().no_proxy().timeout(Duration::from_secs(5)).build()?;
                    let response = client.post(format!("http://127.0.0.1:{}/_launcher/stop", self.state.config.port))
                        .header("X-Yingce-Runtime-Token", token).send().context("无法请求本地服务正常退出")?;
                    ensure!(response.status().as_u16() == 202, "本地服务拒绝停机请求");
                    let deadline = Instant::now() + Duration::from_secs(60);
                    while child.try_wait()?.is_none() && Instant::now() < deadline { thread::sleep(Duration::from_millis(100)); }
                    ensure!(child.try_wait()?.is_some(), "服务尚未退出，请等待活动任务结束，不能继续更新");
                    let status = child.wait()?;
                    ensure!(status.success(), "运行时异常退出，请查看运行日志；原数据仍保留");
                }
                #[cfg(windows)] { self.job = None; }
                Ok(())
            })();
            if let Err(error) = result {
                if child.try_wait()?.is_none() { self.child = Some(child); }
                else { self.restore_pending(); }
                return Err(error);
            }
        }
        self.shutdown_token = None;
        self.restore_pending();
        self.status()
    }
    fn restore_pending(&mut self) {
        if let Some((installed, files)) = self.pending_restore.take() {
            self.state.installed = installed;
            self.state.files = files;
        }
    }
    pub fn open_browser(&mut self) -> Result<()> {
        ensure!(self.pending_restore.is_none(), "候选版本尚未提交，请先停止以恢复原版本。");
        ensure!(self.status()?.running, "Managed runtime is not running");
        open::that(format!("http://127.0.0.1:{}", self.state.config.port))
            .context("Could not open default browser")?;
        Ok(())
    }
    pub fn logs(&self) -> Result<Vec<String>> {
        // Runtime output is deliberately not exposed without a redaction/preview flow.
        let path = self.root.join("logs/launcher.log");
        if !path.exists() {
            return Ok(vec![]);
        }
        let bytes = read_bounded(File::open(path)?, MAX_LOG)?;
        Ok(String::from_utf8_lossy(&bytes)
            .lines()
            .rev()
            .take(200)
            .map(str::to_owned)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect())
    }
    fn note(&self, message: &str) -> Result<()> {
        let path = self.root.join("logs/launcher.log");
        rotate_log(&path)?;
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;
        writeln!(
            file,
            "{} {message}",
            SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs()
        )?;
        Ok(())
    }
    fn save(&self) -> Result<()> {
        let bytes = serialize_state(&self.state)?;
        let dir = self.root.join("state");
        let tmp = dir.join("state.next");
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&tmp)
            .context("Pending state transaction exists; manual recovery required")?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        atomic_replace(&tmp, &dir.join("state.json"))?;
        #[cfg(unix)]
        File::open(&dir)?.sync_all()?;
        Ok(())
    }
}
impl Drop for Manager {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(child) = self.child.as_mut() {
            // Launcher exit is an explicit forced cleanup boundary; avoid leaving orphaned writers.
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.wait();
        }
        #[cfg(windows)]
        {
            self.job = None;
            if let Some(child) = self.child.as_mut() {
                let _ = child.wait();
            }
        }
    }
}
/// Held while a prepare or install runs; exactly one such task may run at a time.
struct BusyGuard(Arc<AtomicBool>);
impl BusyGuard {
    fn acquire(flag: &Arc<AtomicBool>) -> Result<Self> {
        ensure!(
            flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok(),
            "正在准备或安装更新，请等待当前任务完成。"
        );
        Ok(Self(flag.clone()))
    }
}
impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
enum PrepareOutcome {
    UpToDate,
    AlreadyPrepared(String),
    Prepared(PreparedRelease),
}
/// Everything a prepare needs, cloned out of the manager so the long download and build run
/// without holding the manager lock (the service can be started and stopped meanwhile).
#[derive(Clone)]
pub struct Prepare {
    root: PathBuf,
    client: Client,
    config: Config,
    installed_commit: Option<String>,
    prepared_commit: Option<String>,
}
/// Downloads and builds the latest commit in the background. Never touches data or the running
/// service; the finished build waits until the user switches to it.
pub fn prepare_in_background(shared: &Arc<Mutex<Manager>>) -> Result<String> {
    let (ctx, _busy) = {
        let manager = shared.lock().map_err(|_| anyhow!("管理核心状态异常，请退出应用后重新打开。"))?;
        let busy = BusyGuard::acquire(&manager.busy)?;
        (manager.prepare_ctx(), busy)
    };
    let outcome = ctx.run_prepare();
    let mut manager = shared.lock().map_err(|_| anyhow!("管理核心状态异常，请退出应用后重新打开。"))?;
    manager.finish_prepare(outcome)
}
fn parse_time(value: &str) -> Option<(u32, u32)> {
    let (hour, minute) = value.split_once(':')?;
    if hour.len() != 2 || minute.len() != 2 {
        return None;
    }
    let (hour, minute): (u32, u32) = (hour.parse().ok()?, minute.parse().ok()?);
    (hour < 24 && minute < 60).then_some((hour, minute))
}
/// Whether a scheduled background check should start now. A missed daily slot runs as soon as the
/// launcher is open again, at most once per slot.
fn is_due<Tz: chrono::TimeZone>(config: &AutoUpdate, last_check: i64, now: &chrono::DateTime<Tz>) -> bool {
    if !config.enabled {
        return false;
    }
    match config.schedule {
        Schedule::Interval => last_check == 0 || now.timestamp() - last_check >= i64::from(config.interval_hours.max(1)) * 3600,
        Schedule::Daily => {
            let Some((hour, minute)) = parse_time(&config.time) else { return false };
            let Some(slot) = now
                .date_naive()
                .and_hms_opt(hour, minute, 0)
                .and_then(|t| t.and_local_timezone(now.timezone()).earliest())
            else {
                return false;
            };
            *now >= slot && last_check < slot.timestamp()
        }
    }
}
fn serialize_state(state: &State) -> Result<Vec<u8>> {
    let bytes = serde_json::to_vec_pretty(state)?;
    ensure!(
        bytes.len() as u64 <= MAX_STATE,
        "Installed inventory exceeds reloadable state limit"
    );
    Ok(bytes)
}
fn copy_verified_archive(
    reader: impl Read,
    output: &mut impl Write,
    artifact: &Artifact,
) -> Result<()> {
    let mut reader = reader.take(artifact.size + 1);
    let mut hasher = Sha256::new();
    let mut count = 0u64;
    let mut buffer = [0; 65536];
    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        count += n as u64;
        ensure!(
            count <= artifact.size,
            "Archive exceeds repository-reported size"
        );
        output.write_all(&buffer[..n])?;
        hasher.update(&buffer[..n]);
    }
    ensure!(count == artifact.size, "Archive truncated");
    ensure!(
        hex::encode(hasher.finalize()) == artifact.sha256.to_lowercase(),
        "Archive SHA-256 mismatch"
    );
    Ok(())
}
fn readiness_matches(raw: &[u8], version: &str, commit: &str) -> bool {
    let Ok(body) = serde_json::from_slice::<serde_json::Value>(raw) else {
        return false;
    };
    body["code"].as_i64() == Some(0)
        && body["data"]["ready"].as_bool() == Some(true)
        && body["data"]["status"].as_str() == Some("ok")
        && body["data"]["build"]["commit"].as_str() == Some(commit)
        && body["data"]["build"]["version"].as_str() == Some(version)
}
/// What this process has learned about each download host: its measured speed rank (0 = fastest)
/// and how many requests in a row failed. Hosts with recent failures sink to the end.
#[derive(Default)]
struct HostStat {
    rank: usize,
    fails: u32,
}
fn host_stats() -> &'static Mutex<HashMap<String, HostStat>> {
    static STATS: OnceLock<Mutex<HashMap<String, HostStat>>> = OnceLock::new();
    STATS.get_or_init(Default::default)
}
fn host_key(url: &Url) -> String {
    match url.host_str().unwrap_or("") {
        "api.github.com" => "github.com".to_owned(),
        host => host.to_owned(),
    }
}
fn order_sources(mut sources: Vec<Url>) -> Vec<Url> {
    if let Ok(stats) = host_stats().lock() {
        // Stable sort: sources the process knows nothing about keep the configured order.
        sources.sort_by_key(|u| stats.get(&host_key(u)).map(|s| (s.fails.min(3), s.rank)).unwrap_or((0, usize::MAX)));
    }
    sources
}
fn note_source(url: &Url, ok: bool) {
    if let Ok(mut stats) = host_stats().lock() {
        let stat = stats.entry(host_key(url)).or_default();
        stat.fails = if ok { 0 } else { stat.fails + 1 };
    }
}
fn public_sources(config: &Config, target: &str) -> Result<Vec<Url>> {
    let direct = Url::parse(target)?;
    ensure!(
        direct.scheme() == "https"
            && ["api.github.com", "github.com"].contains(&direct.host_str().unwrap_or("")),
        "Unsupported public repository host"
    );
    // The chosen proxy goes first; the other approved proxies are fallbacks because any one of
    // these free public services is often down or rate limited.
    let mirrors = || -> Result<Vec<Url>> {
        let selected = source_url(
            config
                .mirror_url
                .as_deref()
                .unwrap_or("https://gh-proxy.com/"),
        )?;
        ensure!(
            PUBLIC_MIRRORS.contains(&selected.host_str().unwrap_or(""))
                && selected.path() == "/"
                && selected.port().is_none(),
            "请选择已支持的 GitHub 公共镜像"
        );
        let chosen = selected.host_str().unwrap_or("").to_owned();
        let mut hosts = vec![chosen.clone()];
        hosts.extend(PUBLIC_MIRRORS.iter().map(|h| h.to_string()).filter(|h| *h != chosen));
        hosts
            .iter()
            .map(|host| Url::parse(&format!("https://{host}/{target}")).map_err(Into::into))
            .collect()
    };
    match config.source_mode {
        SourceMode::Official => Ok(vec![direct]),
        SourceMode::Mirror => mirrors(),
        SourceMode::Auto => Ok(std::iter::once(direct).chain(mirrors()?).collect()),
    }
}
fn manifest_from_public(release: &PublicRelease) -> Result<ReleaseManifest> {
    platform()?;
    Ok(ReleaseManifest { schema_version: 1, sequence: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
        expires_at: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() + 3600,
        version: release.version.clone(), commit: release.commit.clone(), channel: "stable".into(),
        min_launcher_version: env!("CARGO_PKG_VERSION").into(), release_id: format!("source-{}", release.commit),
        artifacts: vec![], migration: Migration { data_schema: 1, requires_migration: false }, release_notes: release.notes.clone() })
}
fn public_install_reason(_manifest: &ReleaseManifest, _installed: bool) -> Option<String> { None }
fn progress(root: &Path, stage: &str, percent: u8, message: &str) -> Result<()> {
    let bytes = serde_json::to_vec(&serde_json::json!({ "stage": stage, "percent": percent, "message": message }))?;
    fs::write(root.join("logs/source-build.progress.json"), bytes)?;
    Ok(())
}
fn copy_snapshot(source: &Path, destination: &Path) -> Result<()> {
    reject_link(source)?;
    ensure!(!destination.exists(), "快照目录已存在，拒绝覆盖");
    fs::create_dir(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        reject_link(&path)?;
        if entry.file_name() == ".yingce-runtime.lock" { continue; }
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() { copy_snapshot(&path, &target)?; }
        else {
            ensure!(entry.file_type()?.is_file(), "数据快照不支持特殊文件");
            fs::copy(&path, &target)?;
            OpenOptions::new().read(true).write(true).open(target)?.sync_all()?;
        }
    }
    Ok(())
}
fn file_sha256(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new(); let mut bytes = [0u8; 65536];
    loop { let n = file.read(&mut bytes)?; if n == 0 { break; } hash.update(&bytes[..n]); }
    Ok(hex::encode(hash.finalize()))
}
fn hash_inventory(root: &Path) -> Result<BTreeMap<String, String>> {
    let mut names = BTreeMap::new(); inventory_names(root, root, &mut names)?;
    let mut files = BTreeMap::new();
    for name in names.keys() {
        let mut file = File::open(root.join(name))?;
        let mut hash = Sha256::new(); let mut bytes = [0u8; 65536];
        loop { let n = file.read(&mut bytes)?; if n == 0 { break; } hash.update(&bytes[..n]); }
        files.insert(name.clone(), hex::encode(hash.finalize()));
    }
    Ok(files)
}
fn source_url(value: &str) -> Result<Url> {
    let url = Url::parse(value)?;
    ensure!(
        url.scheme() == "https"
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && url.path().ends_with('/'),
        "Source must be a credential-free HTTPS base URL ending in /, without query or fragment"
    );
    Ok(url)
}
fn validate_config(config: &Config) -> Result<()> {
    ensure!(
        config.port >= 1024,
        "Choose an unprivileged fixed port between 1024 and 65535"
    );
    if let Some(url) = &config.official_url {
        ensure!(
            url.trim_end_matches('/') == REPOSITORY_URL,
            "当前版本固定使用影策上游公共仓库"
        );
    }
    if let Some(url) = &config.mirror_url {
        source_url(url)?;
    }
    ensure!(
        (1..=168).contains(&config.auto_update.interval_hours),
        "自动更新间隔应在 1 到 168 小时之间"
    );
    ensure!(parse_time(&config.auto_update.time).is_some(), "自动更新时间应为 HH:MM，例如 03:00");
    public_sources(config, DEFAULT_API_ROOT)?;
    Ok(())
}
fn validate_id(value: &str) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= 100
            && value
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_' || c == b'.')
            && value != "."
            && value != "..",
        "Invalid release identifier"
    );
    Ok(())
}
fn platform() -> Result<(&'static str, &'static str)> {
    platform_for(std::env::consts::OS, std::env::consts::ARCH)
}
fn platform_for(os: &str, arch: &str) -> Result<(&'static str, &'static str)> {
    match (os, arch) {
        ("windows", "x86_64") => Ok(("windows", "x86_64")),
        ("linux", "x86_64") => Ok(("linux", "x86_64")),
        ("macos", "x86_64") => Ok(("macos", "x86_64")),
        ("macos", "aarch64") => Ok(("macos", "aarch64")),
        _ => bail!("Unsupported platform/architecture: {os}/{arch}"),
    }
}
fn validate_manifest(m: &ReleaseManifest, highest: u64) -> Result<()> {
    ensure!(
        m.schema_version == 1 && m.channel == "stable",
        "Unsupported manifest schema or channel"
    );
    ensure!(
        m.sequence > 0 && m.sequence >= highest,
        "Old release manifest replay rejected"
    );
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    ensure!(
        now > 1_700_000_000 && m.expires_at > now,
        "Manifest expired or system clock invalid"
    );
    ensure!(
        version_tuple(&m.min_launcher_version)? <= version_tuple(env!("CARGO_PKG_VERSION"))?,
        "A newer launcher is required"
    );
    validate_id(&m.release_id)?;
    validate_id(&m.version)?;
    ensure!(
        m.commit.len() == 40 && m.commit.bytes().all(|c| c.is_ascii_hexdigit()),
        "Expected complete 40-character commit"
    );
    ensure!(m.migration.data_schema > 0, "Data schema must be explicit");
    ensure!(
        m.artifacts.len() <= 32 && !m.artifacts.is_empty(),
        "Invalid artifact count"
    );
    for a in &m.artifacts {
        safe_relative(&a.path)?;
        ensure!(
            !a.path.contains('%') && !a.path.contains('?') && !a.path.contains('#'),
            "Artifact path must be literal relative path"
        );
        ensure!(
            a.kind == "zip" && a.size > 0 && a.size <= MAX_ARCHIVE,
            "Unsupported artifact kind or size"
        );
        ensure!(
            a.sha256.len() == 64 && a.sha256.bytes().all(|c| c.is_ascii_hexdigit()),
            "Invalid artifact SHA-256"
        );
    }
    Ok(())
}
fn version_tuple(value: &str) -> Result<(u64, u64, u64)> {
    let parts = value.split('.').collect::<Vec<_>>();
    ensure!(
        parts.len() == 3,
        "Launcher version must be major.minor.patch"
    );
    Ok((parts[0].parse()?, parts[1].parse()?, parts[2].parse()?))
}
fn select_artifact(m: &ReleaseManifest) -> Result<&Artifact> {
    let (os, arch) = platform()?;
    let mut matches = m
        .artifacts
        .iter()
        .filter(|a| a.platform == os && a.arch == arch);
    let first = matches
        .next()
        .context("No runtime artifact for this platform/architecture")?;
    ensure!(matches.next().is_none(), "Ambiguous platform artifact");
    Ok(first)
}
fn safe_relative(value: &str) -> Result<PathBuf> {
    ensure!(
        !value.is_empty()
            && !value.contains('\\')
            && !value.contains(':')
            && !value
                .chars()
                .any(|c| c.is_control() || matches!(c, '<' | '>' | '\"' | '|' | '?' | '*')),
        "Unsafe archive path"
    );
    let path = Path::new(value);
    ensure!(
        path.components().all(|c| matches!(c, Component::Normal(_))),
        "Unsafe relative path"
    );
    ensure!(
        value.split('/').count() <= 64 && value.len() <= 1024,
        "Archive path depth or length exceeds limit"
    );
    for part in value.split('/') {
        ensure!(
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with('.')
                && !part.ends_with(' '),
            "Nonportable archive path"
        );
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        ensure!(
            !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !(stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && stem.as_bytes()[3].is_ascii_digit()),
            "Reserved archive path"
        );
    }
    Ok(path.to_owned())
}
fn reject_link(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    ensure!(
        !meta.file_type().is_symlink(),
        "Managed path must not be a symbolic link"
    );
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        ensure!(
            meta.file_attributes() & 0x400 == 0,
            "Managed path must not be a reparse point"
        );
    }
    Ok(())
}
fn extract_zip(archive: &Path, destination: &Path) -> Result<BTreeMap<String, String>> {
    let mut zip = zip::ZipArchive::new(File::open(archive)?)?;
    ensure!(zip.len() <= MAX_FILES, "Archive has too many entries");
    let mut files = BTreeMap::new();
    let mut seen = std::collections::HashSet::new();
    let mut total = 0u64;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index)?;
        let name = entry.name().trim_end_matches('/').to_owned();
        let relative = safe_relative(&name)?;
        ensure!(
            seen.insert(name.to_ascii_lowercase()),
            "Duplicate/case-colliding archive entry"
        );
        let mode = entry.unix_mode().unwrap_or(0);
        let kind = mode & 0o170000;
        ensure!(
            kind == 0 || kind == 0o100000 || (kind == 0o040000 && entry.is_dir()),
            "Archive links or special files are forbidden"
        );
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target)?;
            continue;
        }
        total = total
            .checked_add(entry.size())
            .context("Expanded archive size overflow")?;
        ensure!(
            total <= MAX_EXPANDED && entry.size() <= MAX_ARCHIVE,
            "Expanded archive exceeds limit"
        );
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&target)?;
        let mut digest = Sha256::new();
        let mut count = 0u64;
        let expected = entry.size();
        let mut buffer = [0; 65536];
        loop {
            let n = entry.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            count += n as u64;
            ensure!(
                count <= expected,
                "Archive entry expanded beyond declared size"
            );
            digest.update(&buffer[..n]);
            output.write_all(&buffer[..n])?;
        }
        ensure!(count == expected, "Truncated archive entry");
        output.sync_all()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                &target,
                fs::Permissions::from_mode(if mode & 0o111 != 0 { 0o755 } else { 0o644 }),
            )?;
        }
        files.insert(name, hex::encode(digest.finalize()));
    }
    Ok(files)
}
fn verify_files(root: &Path, files: &BTreeMap<String, String>) -> Result<()> {
    reject_link(root)?;
    ensure!(!files.is_empty(), "Installed file inventory missing");
    let mut discovered = BTreeMap::new();
    inventory_names(root, root, &mut discovered)?;
    ensure!(
        discovered.len() == files.len() && discovered.keys().eq(files.keys()),
        "Installed files added or removed; repair required"
    );
    let mut total = 0u64;
    // Every path is still link-checked and every file hashed on each start.
    // Shared parent directories need only one metadata query per verification pass.
    let mut checked = std::collections::HashSet::new();
    for (name, expected) in files {
        let relative = safe_relative(name)?;
        let mut path = root.to_owned();
        for component in relative.components() {
            path.push(component);
            if checked.insert(path.clone()) { reject_link(&path)?; }
        }
        let mut file = File::open(path)?;
        let size = file.metadata()?.len();
        total = total.checked_add(size).context("Installed size overflow")?;
        ensure!(
            size <= MAX_ARCHIVE && total <= MAX_EXPANDED,
            "Installed file exceeds size limit"
        );
        let mut digest = Sha256::new();
        let mut buffer = [0; 65536];
        loop {
            let n = file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            digest.update(&buffer[..n]);
        }
        ensure!(
            hex::encode(digest.finalize()) == *expected,
            "Installed file changed; repair required"
        );
    }
    Ok(())
}
fn inventory_names(root: &Path, dir: &Path, files: &mut BTreeMap<String, ()>) -> Result<()> {
    ensure!(
        dir.strip_prefix(root)?.components().count() <= 64,
        "Installed directory depth exceeds limit"
    );
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        reject_link(&path)?;
        if entry.file_type()?.is_dir() {
            inventory_names(root, &path, files)?;
        } else {
            ensure!(
                entry.file_type()?.is_file(),
                "Installed special file rejected"
            );
            ensure!(
                files.len() < MAX_FILES,
                "Installed file count exceeds limit"
            );
            files.insert(
                path.strip_prefix(root)?
                    .to_str()
                    .context("Non-UTF8 installed filename")?
                    .replace('\\', "/"),
                (),
            );
        }
    }
    Ok(())
}
fn runtime_relative() -> &'static str {
    if cfg!(windows) {
        "runtime/bin/yingce-runtime.exe"
    } else {
        "runtime/bin/yingce-runtime"
    }
}
fn read_bounded(mut reader: impl Read, limit: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.by_ref().take(limit + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() as u64 <= limit, "Input exceeds size limit");
    Ok(bytes)
}
fn rotate_log(path: &Path) -> Result<()> {
    if path.exists() {
        reject_link(path)?;
        if fs::metadata(path)?.len() >= MAX_LOG {
            let previous = path.with_extension("previous.log");
            if previous.exists() {
                fs::remove_file(&previous)?;
            }
            fs::rename(path, previous)?;
        }
    }
    Ok(())
}
#[cfg(not(windows))]
fn atomic_replace(from: &Path, to: &Path) -> Result<()> {
    fs::rename(from, to)?;
    Ok(())
}
#[cfg(windows)]
fn atomic_replace(from: &Path, to: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    ensure!(
        unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } != 0,
        "Atomic state replacement failed: {}",
        std::io::Error::last_os_error()
    );
    Ok(())
}
#[cfg(windows)]
struct Job(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for Job {}
#[cfg(windows)]
impl Job {
    fn new() -> Result<Self> {
        use windows_sys::Win32::System::JobObjects::*;
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        ensure!(!handle.is_null(), "Could not create runtime job");
        let job = Self(handle);
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        ensure!(
            unsafe {
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of_val(&info) as u32,
                )
            } != 0,
            "Could not configure runtime job"
        );
        Ok(job)
    }
    fn assign(&self, child: &Child) -> Result<()> {
        use std::os::windows::io::AsRawHandle;
        ensure!(
            unsafe {
                windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(
                    self.0,
                    child.as_raw_handle() as _,
                )
            } != 0,
            "Could not assign owned runtime to job"
        );
        Ok(())
    }
    fn terminate(&self) -> Result<()> {
        ensure!(
            unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1) } != 0,
            "Could not terminate owned runtime job"
        );
        Ok(())
    }
}
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

impl Prepare {
    fn run_prepare(&self) -> Result<PrepareOutcome> {
        progress(&self.root, "resolve", 2, "读取公共仓库版本")?;
        let (manifest, _, _) = self.fetch_manifest()?;
        if self.installed_commit.as_deref() == Some(manifest.commit.as_str()) {
            return Ok(PrepareOutcome::UpToDate);
        }
        if self.prepared_commit.as_deref() == Some(manifest.commit.as_str()) {
            return Ok(PrepareOutcome::AlreadyPrepared(manifest.version));
        }
        self.prepare(&manifest).map(PrepareOutcome::Prepared)
    }
    fn fetch_manifest(&self) -> Result<(ReleaseManifest, String, Vec<u8>)> {
        let mut errors = Vec::new();
        for source in public_sources(&self.config, DEFAULT_API_ROOT)? {
            match public_release::fetch_latest(&self.client, &source) {
                Ok(release) => {
                    let manifest = manifest_from_public(&release)?;
                    let raw = serde_json::to_vec(&manifest)?;
                    let origin = format!("{REPOSITORY_URL}/tree/{}", public_release::TRACKED_BRANCH);
                    return Ok((manifest, origin, raw));
                }
                Err(error) => errors.push(format!("{error:#}")),
            }
        }
        bail!("无法读取公共仓库版本信息：{}", errors.join("；"))
    }
    /// Downloads (incrementally when possible), builds and inventories one commit under `releases/`.
    fn prepare(&self, manifest: &ReleaseManifest) -> Result<PreparedRelease> {
        let id = format!("source-{}", manifest.commit);
        let stage = self.root.join("staging").join(format!("{}-{}", id, SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis()));
        fs::create_dir(&stage)?;
        progress(&self.root, "download", 5, "下载独立源码，不修改现有开发仓库")?;
        let source = self.download_source(&manifest.commit, &stage)?;
        let release = stage.join("release");
        fs::create_dir(&release)?;
        source_install::build_source(&source, &release, &self.root.join("cache"), &manifest.version, &manifest.commit,
            !matches!(self.config.source_mode, SourceMode::Official), &self.root.join("logs/source-build.log"))?;
        let executable = release.join(runtime_relative());
        fs::create_dir_all(executable.parent().context("Missing runtime parent")?)?;
        fs::write(&executable, include_bytes!(concat!(env!("OUT_DIR"), "/yingce-runtime.bin")))?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o755))?;
        }
        progress(&self.root, "inventory", 84, "核对构建文件")?;
        let files = hash_inventory(&release)?;
        let target = self.root.join("releases").join(&id);
        if target.exists() { fs::rename(&target, stage.join("previous-failed-build")).context("无法保留前次失败构建，请确认相关进程已经退出")?; }
        fs::rename(&release, &target)?;
        let source_target = self.root.join("sources").join(&manifest.commit);
        if !source_target.exists() { let _ = fs::rename(&source, &source_target); }
        let _ = fs::remove_dir_all(&stage);
        self.prune_archives(&manifest.commit);
        Ok(PreparedRelease { version: manifest.version.clone(), commit: manifest.commit.clone(), sequence: manifest.sequence,
            release_id: id, data_schema: manifest.migration.data_schema, files })
    }
    /// Keeps only the installed and newest pristine archives; each is ~300 MB.
    fn prune_archives(&self, newest: &str) {
        let Ok(entries) = fs::read_dir(self.root.join("cache")) else { return };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(rest) = name.strip_prefix("source-") else { continue };
            let commit = rest.split('.').next().unwrap_or("");
            let is_archive = rest.ends_with(".zip") || rest.ends_with(".json");
            if is_archive && commit.len() == 40 && commit != newest && self.installed_commit.as_deref() != Some(commit) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    /// Commits that have a cached source archive, newest file first (e.g. one imported from a local checkout).
    fn cached_commits(&self) -> Vec<String> {
        let Ok(entries) = fs::read_dir(self.root.join("cache")) else { return vec![] };
        let mut found: Vec<(SystemTime, String)> = entries.flatten().filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let commit = name.strip_prefix("source-")?.strip_suffix(".zip")?.to_owned();
            let valid = commit.len() == 40 && commit.bytes().all(|b| b.is_ascii_hexdigit());
            valid.then(|| (entry.metadata().and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH), commit))
        }).collect();
        found.sort_by(|a, b| b.0.cmp(&a.0));
        found.into_iter().map(|(_, commit)| commit).collect()
    }
    /// A cached pristine archive of `commit` whose recorded digest still matches.
    fn base_archive(&self, commit: &str) -> Option<PathBuf> {
        let cached = self.root.join("cache").join(format!("source-{commit}.zip"));
        let metadata: serde_json::Value = serde_json::from_slice(&read_bounded(File::open(cached.with_extension("json")).ok()?, 4096).ok()?).ok()?;
        let digest_ok = metadata["commit"].as_str() == Some(commit) && metadata["sha256"].as_str() == Some(file_sha256(&cached).ok()?.as_str());
        (digest_ok && zip::ZipArchive::new(File::open(&cached).ok()?).is_ok()).then_some(cached)
    }
    fn fetch_tree(&self, commit: &str) -> Result<Vec<public_release::TreeEntry>> {
        let mut errors = Vec::new();
        for root in order_sources(public_sources(&self.config, DEFAULT_API_ROOT)?) {
            match public_release::fetch_tree(&self.client, &root, commit) {
                Ok(tree) => {
                    note_source(&root, true);
                    return Ok(tree);
                }
                Err(error) => {
                    note_source(&root, false);
                    errors.push(format!("{error:#}"));
                }
            }
        }
        bail!("无法读取源码目录清单：{}", errors.join("；"))
    }
    fn fetch_raw(&self, commit: &str, entry: &public_release::TreeEntry) -> Result<Vec<u8>> {
        // Files already fetched by an interrupted run are reused: proxies do not support `Range`,
        // so per-file granularity is the only resume point a failed install has.
        let cached = self.root.join("cache/blobs").join(&entry.sha);
        if let Ok(bytes) = fs::read(&cached) {
            if bytes.len() as u64 == entry.size && incremental::blob_sha1(&bytes) == entry.sha {
                return Ok(bytes);
            }
        }
        let mut url = Url::parse(REPOSITORY_URL)?;
        url.path_segments_mut()
            .map_err(|_| anyhow!("Invalid repository URL"))?
            .pop_if_empty()
            .extend(["raw", commit])
            .extend(entry.path.split('/'));
        let mut errors = Vec::new();
        for round in 0..4u32 {
            if round > 0 {
                // Dropped connections are usually rate limiting: back off instead of hammering.
                let jitter = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| u64::from(d.subsec_millis()) % 250).unwrap_or(0);
                thread::sleep(Duration::from_millis(500u64 << (round - 1)) + Duration::from_millis(jitter));
            }
            for source in order_sources(public_sources(&self.config, url.as_str())?) {
                let result = (|| -> Result<Vec<u8>> {
                    let response = self.client.get(source.clone()).timeout(Duration::from_secs(60)).send()?.error_for_status()?;
                    ensure!(response.content_length().unwrap_or(0) <= entry.size, "文件大小与目录清单不一致");
                    read_bounded(response, entry.size)
                })();
                match result {
                    Ok(bytes) => {
                        note_source(&source, true);
                        let temporary = cached.with_extension("part");
                        if fs::create_dir_all(cached.parent().unwrap_or(Path::new("."))).is_ok()
                            && fs::write(&temporary, &bytes).is_ok()
                            && fs::rename(&temporary, &cached).is_err()
                        {
                            let _ = fs::remove_file(&temporary);
                        }
                        return Ok(bytes);
                    }
                    Err(error) => {
                        note_source(&source, false);
                        errors.push(format!("{}：{error:#}", source.host_str().unwrap_or("?")));
                    }
                }
            }
        }
        let tail = errors.len().saturating_sub(3);
        bail!("下载 {} 失败（已重试 4 轮）：{}", entry.path, errors[tail..].join("；"))
    }
    /// Measures every download host once per run (a few seconds) so the fastest is tried first.
    fn rank_sources(&self, sources: &[Url]) {
        let unranked = host_stats().lock().map(|s| s.is_empty()).unwrap_or(false);
        if sources.len() < 2 || !unranked { return; }
        let _ = progress(&self.root, "download", 4, "测试各下载来源速度");
        let urls: Vec<String> = sources.iter().map(Url::to_string).collect();
        let speeds = download::measure(&self.client, &urls, Duration::from_secs(8));
        let mut order: Vec<usize> = (0..sources.len()).collect();
        order.sort_by_key(|&i| std::cmp::Reverse(speeds[i]));
        if let Ok(mut stats) = host_stats().lock() {
            for (rank, &i) in order.iter().enumerate() {
                let host = host_key(&sources[i]);
                stats.insert(host, HostStat { rank, fails: u32::from(speeds[i] == 0) });
            }
        }
    }
    /// Rebuilds the previous pristine tree locally and downloads only the files that differ.
    /// `Ok(None)` means there is no previous archive to build on.
    fn incremental_source(&self, commit: &str, stage: &Path) -> Result<Option<PathBuf>> {
        let known = [self.prepared_commit.clone(), self.installed_commit.clone()];
        let Some((base_commit, base_archive)) = known.into_iter().flatten().chain(self.cached_commits())
            .filter(|c| c != commit).find_map(|c| self.base_archive(&c).map(|a| (c, a)))
        else { return Ok(None) };
        progress(&self.root, "download", 4, "读取目录清单，只下载与上一版不同的文件")?;
        let tree = incremental::filter_needed(self.fetch_tree(commit)?);
        let unpacked = stage.join("checkout");
        fs::create_dir(&unpacked)?;
        extract_zip(&base_archive, &unpacked)?;
        let base_root = unpacked.join(format!("open-ai-canvas-{base_commit}"));
        ensure!(base_root.is_dir(), "上一版源码包目录结构不符合预期");
        let plan = incremental::plan(&incremental::index_tree(&base_root)?, &tree);
        ensure!(plan.within_limits(), "与上一版差异较大（{} 个文件、{} MiB），改用完整源码包", plan.download.len(), plan.bytes / 1024 / 1024);
        let root = unpacked.join(format!("open-ai-canvas-{commit}"));
        fs::rename(&base_root, &root)?;
        self.sync_tree(&root, &plan, &tree, commit, incremental::UPDATE_WORKERS, false)?;
        Ok(Some(root))
    }
    /// First install: there is nothing to diff against, so fetch only the files the source build
    /// reads (about a third of the repository) instead of the complete archive.
    fn selective_source(&self, commit: &str, stage: &Path) -> Result<PathBuf> {
        progress(&self.root, "download", 4, "读取目录清单，只下载构建需要的文件")?;
        let tree = incremental::filter_needed(self.fetch_tree(commit)?);
        let plan = incremental::plan(&BTreeMap::new(), &tree);
        ensure!(plan.within_scratch_limits(), "需下载 {} 个文件、{} MiB，改用完整源码包", plan.download.len(), plan.bytes / 1024 / 1024);
        let root = stage.join("checkout").join(format!("open-ai-canvas-{commit}"));
        fs::create_dir_all(&root)?;
        self.sync_tree(&root, &plan, &tree, commit, incremental::SCRATCH_WORKERS, true)?;
        Ok(root)
    }
    /// `guard`: give up early when per-file requests are too slow to beat the single archive
    /// (many small requests through a throttled proxy), so a first install is never worse than before.
    fn sync_tree(&self, root: &Path, plan: &incremental::Plan, tree: &[public_release::TreeEntry], commit: &str, workers: usize, guard: bool) -> Result<()> {
        let started = Instant::now();
        let finished = std::sync::atomic::AtomicUsize::new(0);
        let message = |done: usize, total: usize| {
            finished.store(done, std::sync::atomic::Ordering::SeqCst);
            let _ = progress(&self.root, "download", 5, &format!("按需下载 {done}/{total} 个文件"));
        };
        let fetch = |entry: &public_release::TreeEntry| {
            if guard && started.elapsed() > Duration::from_secs(90)
                && finished.load(std::sync::atomic::Ordering::SeqCst) * 100 < plan.download.len() * 3 {
                bail!("90 秒内下载不足 3% 的文件，代理对小文件请求太慢");
            }
            self.fetch_raw(commit, entry)
        };
        incremental::apply(root, plan, workers, &fetch, &message)?;
        incremental::verify(root, tree)?;
        ensure!(root.join("backend/go.mod").is_file() && root.join("web/bun.lock").is_file(), "源码缺少后端或锁文件");
        // Keep this pristine tree as the base of the next increment; failure only costs a full download later.
        let cached = self.root.join("cache").join(format!("source-{commit}.zip"));
        let partial = cached.with_extension("zip.part");
        if incremental::write_archive(root, &partial).and_then(|_| Ok(fs::rename(&partial, &cached)?)).is_ok() {
            let record = serde_json::to_vec(&serde_json::json!({"commit": commit, "source": "incremental", "sha256": file_sha256(&cached)?}))?;
            let _ = fs::write(cached.with_extension("json"), record);
        } else {
            let _ = fs::remove_file(&partial);
        }
        let _ = fs::remove_dir_all(self.root.join("cache/blobs"));
        Ok(())
    }
    fn download_source(&self, commit: &str, stage: &Path) -> Result<PathBuf> {
        ensure!(commit.len() == 40 && commit.bytes().all(|b| b.is_ascii_hexdigit()), "无效源码提交号");
        let official = format!("{REPOSITORY_URL}/archive/{commit}.zip");
        let archive = stage.join("source.zip");
        let sources = public_sources(&self.config, &official)?;
        let cached = self.root.join("cache").join(format!("source-{commit}.zip"));

        let record = cached.with_extension("json");
        let valid_cache = (|| -> Result<bool> {
            let metadata: serde_json::Value = serde_json::from_slice(&read_bounded(File::open(&record)?, 4096)?)?;
            let local = matches!(metadata["source"].as_str(), Some("incremental" | "local"));
            if metadata["commit"].as_str() != Some(commit) || !(local || sources.iter().any(|s| Some(s.as_str()) == metadata["source"].as_str())) { return Ok(false); }
            Ok(metadata["sha256"].as_str() == Some(file_sha256(&cached)?.as_str()) && zip::ZipArchive::new(File::open(&cached)?).is_ok())
        })().unwrap_or(false);
        if !valid_cache {
            self.rank_sources(&sources);
            match self.incremental_source(commit, stage) {
                Ok(Some(source)) => return Ok(source),
                Ok(None) => match self.selective_source(commit, stage) {
                    Ok(source) => return Ok(source),
                    Err(error) => {
                        let _ = progress(&self.root, "download", 5, &format!("按需下载不可用，改用完整源码包：{error:#}"));
                        let _ = fs::remove_dir_all(stage.join("checkout"));
                    }
                },
                Err(error) => {
                    let _ = progress(&self.root, "download", 5, &format!("增量更新不可用，改用完整源码包：{error:#}"));
                    let _ = fs::remove_dir_all(stage.join("checkout"));
                }
            }
        }
        let sources = order_sources(sources);
        let mut downloaded = valid_cache;
        if valid_cache { fs::copy(&cached, &archive)?; }
        let mut errors = Vec::new();
        let _ = fs::create_dir_all(self.root.join("cache"));
        // Partial downloads of other commits can never be continued.
        if let Ok(entries) = fs::read_dir(self.root.join("cache")) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with("source-") && name.ends_with(".part") && !name.starts_with(&format!("source-{commit}.")) {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        for url in sources {
            if downloaded { break; }
            let origin = url.to_string();
            let result = (|| -> Result<()> {
                // Resumable per source: a different proxy may build a different (but equivalent) ZIP,
                // so partial bytes are only ever continued from the same URL.
                let part = self.root.join("cache").join(format!("source-{commit}.{}.part", &hex::encode(Sha256::digest(origin.as_bytes()))[..12]));
                let report = |done: u64, total: Option<u64>| {
                    let _ = progress(&self.root, "download", 5, &match total {
                        Some(total) => format!("正在下载独立源码，已接收 {} / {} MiB", done / 1024 / 1024, total / 1024 / 1024),
                        None => format!("正在下载独立源码，已接收 {} MiB", done / 1024 / 1024),
                    });
                };
                let size = download::fetch_to_file(&self.client, &origin, &part, &download::Options::new(MAX_ARCHIVE), &report)?;
                ensure!(size > 0, "源码下载为空");
                if archive.exists() { fs::remove_file(&archive)?; }
                if fs::rename(&part, &archive).is_err() {
                    fs::copy(&part, &archive)?;
                    fs::remove_file(&part)?;
                }
                zip::ZipArchive::new(File::open(&archive)?).context("源码下载被截断或不是完整 ZIP")?;
                fs::copy(&archive, &cached)?;
                fs::write(&record, serde_json::to_vec(&serde_json::json!({"commit":commit,"source":origin,"sha256":file_sha256(&cached)?}))?)?;
                Ok(())
            })();
            match result {
                Ok(()) => { note_source(&url, true); downloaded = true; break; }
                Err(error) => { note_source(&url, false); errors.push(format!("{error:#}")) }
            }
            if archive.exists() { fs::remove_file(&archive)?; }
        }
        ensure!(downloaded, "源码下载失败，请检查网络或切换镜像：{}", errors.join("；"));
        let unpacked = stage.join("checkout");
        fs::create_dir(&unpacked)?;
        extract_zip(&archive, &unpacked)?;
        let entries = fs::read_dir(&unpacked)?.collect::<std::io::Result<Vec<_>>>()?;
        ensure!(entries.len() == 1 && entries[0].file_type()?.is_dir(), "公共源码包目录结构不符合预期");
        ensure!(entries[0].file_name() == std::ffi::OsStr::new(&format!("open-ai-canvas-{commit}")), "源码归档根目录与固定提交不匹配");
        let source = entries[0].path();
        ensure!(source.join("backend/go.mod").is_file() && source.join("web/bun.lock").is_file(), "源码缺少后端或锁文件");
        Ok(source)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failing_or_slow_hosts_are_tried_last() {
        let urls = |hosts: &[&str]| hosts.iter().map(|h| Url::parse(&format!("https://{h}/x")).unwrap()).collect::<Vec<_>>();
        let hosts = |urls: Vec<Url>| urls.iter().map(|u| u.host_str().unwrap().to_owned()).collect::<Vec<_>>();
        {
            let mut stats = host_stats().lock().unwrap();
            stats.insert("down.order.test".into(), HostStat { rank: 0, fails: 0 });
            stats.insert("fast.order.test".into(), HostStat { rank: 1, fails: 0 });
            stats.insert("slow.order.test".into(), HostStat { rank: 2, fails: 0 });
        }
        let all = ["slow.order.test", "down.order.test", "fast.order.test"];
        for _ in 0..3 {
            note_source(&Url::parse("https://down.order.test/").unwrap(), false);
        }
        assert_eq!(hosts(order_sources(urls(&all))), ["fast.order.test", "slow.order.test", "down.order.test"]);
        note_source(&Url::parse("https://down.order.test/").unwrap(), true);
        assert_eq!(hosts(order_sources(urls(&all))), ["down.order.test", "fast.order.test", "slow.order.test"], "a success clears the demotion");
        assert_eq!(host_key(&Url::parse("https://api.github.com/x").unwrap()), "github.com");
    }

    #[test]
    #[ignore = "explicit live probe of the public GitHub proxies"]
    fn proxy_speed_live_probe() {
        let client = Client::builder().connect_timeout(Duration::from_secs(10)).build().unwrap();
        let commit = std::env::var("PROBE_COMMIT").unwrap();
        let urls: Vec<String> = PUBLIC_MIRRORS.iter().map(|h| format!("https://{h}/{REPOSITORY_URL}/archive/{commit}.zip")).collect();
        let speeds = download::measure(&client, &urls, Duration::from_secs(8));
        for (host, bytes) in PUBLIC_MIRRORS.iter().zip(&speeds) {
            println!("PROBE {host}: {} KiB in 8s", bytes / 1024);
        }
        assert!(speeds.iter().any(|b| *b > 0));
    }

    #[test]
    fn public_source_modes_are_strict_without_keys() {
        let mut config = Config::default();
        assert!(matches!(config.source_mode, SourceMode::Mirror), "default source is the mirror");
        config.source_mode = SourceMode::Official;
        let direct = public_sources(&config, DEFAULT_API_ROOT).unwrap();
        assert_eq!(direct.len(), 1);
        assert_eq!(direct[0].as_str(), DEFAULT_API_ROOT);
        config.source_mode = SourceMode::Mirror;
        let mirrors = public_sources(&config, DEFAULT_API_ROOT).unwrap();
        assert_eq!(mirrors[0].host_str(), Some("gh-proxy.com"));
        config.mirror_url = Some("https://ghproxy.net/".into());
        let order: Vec<_> = public_sources(&config, DEFAULT_API_ROOT).unwrap().iter().map(|u| u.host_str().unwrap().to_owned()).collect();
        assert_eq!(order, ["ghproxy.net", "gh-proxy.com", "gh-proxy.org", "gh.idayer.com", "cors.isteed.cc", "ghfast.top"], "selected proxy first, the others as fallbacks");
        config.source_mode = SourceMode::Auto;
        let auto = public_sources(&config, DEFAULT_API_ROOT).unwrap();
        assert_eq!(auto.len(), 1 + PUBLIC_MIRRORS.len());
        assert_eq!(auto[0].host_str(), Some("api.github.com"));
        config.mirror_url = Some("https://gh-proxy.com/".into());
        config.mirror_url = Some("https://unapproved.example/".into());
        assert!(public_sources(&config, DEFAULT_API_ROOT).is_err());
    }
    #[test]
    fn repository_source_can_build_without_desktop_runtime_assets() {
        let release = PublicRelease {
            version: "main-aaaaaaa".into(),
            commit: "a".repeat(40),
            notes: "测试数据".into(),
        };
        let manifest = manifest_from_public(&release).unwrap();
        assert_eq!(manifest.version, "main-aaaaaaa");
        assert!(public_install_reason(&manifest, false).is_none());
    }
    #[test]
    #[ignore = "explicit public network probe, never runs in ordinary CI"]
    fn public_repository_live_probe() {
        let root = std::env::temp_dir().join(format!(
            "yingce-public-probe-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut manager = Manager::new(root.clone()).unwrap();
        if std::env::var_os("YINGCE_LAUNCHER_PROBE_MIRROR").is_some() {
            let mut config = manager.state.config.clone(); config.source_mode = SourceMode::Mirror; manager.configure(config).unwrap();
        }
        let result = manager.check_updates();
        drop(manager);
        let _ = fs::remove_dir_all(root);
        let info = result.unwrap();
        println!(
            "repository={} version={} canInstall={} reason={}",
            REPOSITORY_URL,
            info.manifest.version,
            info.can_install,
            info.reason.unwrap_or_default()
        );
    }
    #[test]
    #[ignore = "downloads and builds actual upstream, then starts real backend against isolated retained data"]
    fn source_install_live_smoke() {
        let root = PathBuf::from(std::env::var_os("YINGCE_LAUNCHER_SMOKE_ROOT").expect("explicit isolated smoke root required"));
        assert!(root.is_absolute());
        let mut manager = Manager::new(root.clone()).unwrap();
        let mut config = manager.state.config.clone();
        config.open_browser = false;
        if std::env::var_os("YINGCE_LAUNCHER_SMOKE_MIRROR").is_some() { config.source_mode = SourceMode::Auto; }
        manager.configure(config).unwrap();
        let result = if manager.state.installed.is_some() { manager.start() } else { manager.install() };
        if let Err(error) = result {
            for name in ["logs/source-build.log", "logs/runtime.log"] {
                if let Ok(text) = fs::read_to_string(root.join(name)) { eprintln!("{}\n{}", name, text.lines().rev().take(100).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")); }
            }
            panic!("Live source install failed: {error:#}");
        }
        let status = manager.status().unwrap();
        assert!(status.running);
        println!("LIVE_READY version={} commit={} url={}", status.installed.as_ref().unwrap().version, status.installed.as_ref().unwrap().commit, status.url);
        let client = Client::builder().no_proxy().timeout(Duration::from_secs(10)).build().unwrap();
        let html = client.get(&status.url).send().unwrap().error_for_status().unwrap().text().unwrap();
        assert!(html.contains("<script") && html.contains("assets/"));
        manager.stop().unwrap();
        assert!(!manager.status().unwrap().running);
        println!("LIVE_STOPPED_CLEANLY");
        drop(manager);
        let mut reloaded = Manager::new(root).unwrap();
        reloaded.start().unwrap();
        reloaded.stop().unwrap();
        println!("LIVE_RESTARTED_WITH_PERSISTED_STATE");
    }
    #[test]
    fn snapshots_do_not_mutate_original_data_or_copy_live_lock() {
        let root = std::env::temp_dir().join(format!("yingce-snapshot-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let source = root.join("old"); let target = root.join("new");
        fs::create_dir_all(source.join("uploads")).unwrap();
        fs::write(source.join("uploads/asset"), b"original").unwrap();
        fs::write(source.join(".yingce-runtime.lock"), b"").unwrap();
        copy_snapshot(&source, &target).unwrap();
        assert!(!target.join(".yingce-runtime.lock").exists());
        fs::write(target.join("uploads/asset"), b"changed").unwrap();
        assert_eq!(fs::read(source.join("uploads/asset")).unwrap(), b"original");
        assert!(copy_snapshot(&source, &target).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn stopping_uncommitted_candidate_restores_original_pointer() {
        let root = std::env::temp_dir().join(format!("yingce-pending-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let mut manager = Manager::new(root.clone()).unwrap();
        manager.pending_restore = Some((None, BTreeMap::new()));
        assert!(manager.start().is_err());
        assert!(manager.open_browser().is_err());
        manager.stop().unwrap();
        assert!(manager.pending_restore.is_none());
        assert!(manager.state.installed.is_none());
        drop(manager);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn inventory_larger_than_manifest_limit_remains_reloadable() {
        let mut state = State::default();
        for i in 0..20_000 {
            state.files.insert(
                format!("runtime/agent/node_modules/package-{i}/index.js"),
                "a".repeat(64),
            );
        }
        let bytes = serialize_state(&state).unwrap();
        assert!(bytes.len() as u64 > MAX_MANIFEST);
        let loaded = read_bounded(std::io::Cursor::new(bytes), MAX_STATE).unwrap();
        let restored: State = serde_json::from_slice(&loaded).unwrap();
        assert_eq!(restored.files.len(), 20_000);
    }
    #[test]
    fn archive_copy_keeps_expected_identity_across_sources() {
        let bytes = b"same expected bytes from any approved source";
        let artifact = Artifact {
            platform: "windows".into(),
            arch: "x86_64".into(),
            path: "runtime.zip".into(),
            size: bytes.len() as u64,
            sha256: hex::encode(Sha256::digest(bytes)),
            kind: "zip".into(),
        };
        let mut output = Vec::new();
        assert!(copy_verified_archive(
            std::io::Cursor::new(b"wrong source"),
            &mut output,
            &artifact
        )
        .is_err());
        output.clear();
        copy_verified_archive(std::io::Cursor::new(bytes), &mut output, &artifact).unwrap();
        assert_eq!(output, bytes);
        output.clear();
        let mut oversized = bytes.to_vec();
        oversized.push(0);
        assert!(
            copy_verified_archive(std::io::Cursor::new(oversized), &mut output, &artifact).is_err()
        );
    }
    #[test]
    fn traversal_and_portable_names_rejected() {
        for name in [
            "../escape",
            "/absolute",
            "C:/x",
            "x/../y",
            "a\\b",
            "a//b",
            "./x",
            "NUL.txt",
            "a.",
            "COM1",
        ] {
            assert!(safe_relative(name).is_err(), "{name}");
        }
        assert!(safe_relative("runtime/bin/yingce-runtime").is_ok());
    }
    #[test]
    fn exact_platform_matrix() {
        assert!(platform_for("windows", "x86_64").is_ok());
        assert!(platform_for("macos", "aarch64").is_ok());
        assert!(platform_for("linux", "aarch64").is_err());
        assert!(platform_for("windows", "x86").is_err());
    }
    #[test]
    fn source_validation() {
        for value in [
            "http://example.org/",
            "https://user:secret@example.org/",
            "https://example.org/?key=x",
            "https://example.org/base",
        ] {
            assert!(source_url(value).is_err());
        }
        assert!(source_url("https://example.org/releases/").is_ok());
        assert!(validate_config(&Config {
            port: 0,
            ..Config::default()
        })
        .is_err());
    }
    #[test]
    fn schedule_runs_once_per_slot_and_catches_up() {
        use chrono::{FixedOffset, TimeZone};
        let zone = FixedOffset::east_opt(8 * 3600).unwrap();
        let at = |d: u32, h: u32, m: u32| zone.with_ymd_and_hms(2026, 10, d, h, m, 0).unwrap();
        let daily = AutoUpdate { enabled: true, schedule: Schedule::Daily, time: "03:00".into(), interval_hours: 24 };
        // Before today's slot: not due. After it: due until a check is recorded.
        assert!(!is_due(&daily, at(25, 20, 0).timestamp(), &at(26, 2, 59)));
        assert!(is_due(&daily, at(25, 20, 0).timestamp(), &at(26, 3, 0)));
        assert!(!is_due(&daily, at(26, 3, 5).timestamp(), &at(26, 20, 0)));
        // Launcher was closed over the slot: runs when reopened, once.
        assert!(is_due(&daily, at(24, 3, 1).timestamp(), &at(26, 9, 0)));
        assert!(is_due(&daily, 0, &at(26, 3, 0)));
        let interval = AutoUpdate { schedule: Schedule::Interval, interval_hours: 6, ..daily.clone() };
        assert!(is_due(&interval, 0, &at(26, 0, 0)));
        assert!(!is_due(&interval, at(26, 0, 0).timestamp(), &at(26, 5, 59)));
        assert!(is_due(&interval, at(26, 0, 0).timestamp(), &at(26, 6, 0)));
        let off = AutoUpdate { enabled: false, ..daily };
        assert!(!is_due(&off, 0, &at(26, 3, 0)));
    }
    #[test]
    fn schedule_settings_are_validated_and_do_not_need_a_stopped_service() {
        for (time, hours) in [("3:00", 24), ("24:00", 24), ("03:60", 24), ("03:00", 0), ("03:00", 169)] {
            let config = Config { auto_update: AutoUpdate { time: time.into(), interval_hours: hours, ..AutoUpdate::default() }, ..Config::default() };
            assert!(validate_config(&config).is_err(), "{time} {hours}");
        }
        assert!(validate_config(&Config::default()).is_ok());
        // Old state files without the field still load.
        let state: State = serde_json::from_str(r#"{"config":{"sourceMode":"mirror","officialUrl":null,"mirrorUrl":null,"port":37890,"openBrowser":true},"installed":null,"highestSequence":0}"#).unwrap();
        assert!(!state.config.auto_update.enabled && state.prepared.is_none());
    }
    #[test]
    fn cached_archives_are_listed_for_incremental_bases() {
        let root = std::env::temp_dir().join(format!("yingce-cached-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let manager = Manager::new(root.clone()).unwrap();
        let (old, new) = ("a".repeat(40), "b".repeat(40));
        fs::write(root.join(format!("cache/source-{old}.zip")), b"x").unwrap();
        thread::sleep(Duration::from_millis(30));
        fs::write(root.join(format!("cache/source-{new}.zip")), b"x").unwrap();
        fs::write(root.join("cache/source-notacommit.zip"), b"x").unwrap();
        fs::write(root.join(format!("cache/source-{old}.json")), b"{}").unwrap();
        assert_eq!(manager.prepare_ctx().cached_commits(), vec![new, old]);
        drop(manager);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn only_one_prepare_or_install_runs_at_a_time() {
        let flag = Arc::new(AtomicBool::new(false));
        let first = BusyGuard::acquire(&flag).unwrap();
        assert!(BusyGuard::acquire(&flag).is_err());
        drop(first);
        assert!(BusyGuard::acquire(&flag).is_ok());
    }
    #[test]
    #[ignore = "explicit network probe: needs a previous source archive and record in YINGCE_INCREMENTAL_BASE_CACHE"]
    fn incremental_live_probe() {
        let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} is required"));
        let (cache, base, target) = (PathBuf::from(var("YINGCE_INCREMENTAL_BASE_CACHE")), var("YINGCE_INCREMENTAL_BASE_COMMIT"), var("YINGCE_INCREMENTAL_TARGET_COMMIT"));
        let root = std::env::temp_dir().join(format!("yingce-incremental-live-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let manager = Manager::new(root.clone()).unwrap();
        for ext in ["zip", "json"] { fs::copy(cache.join(format!("source-{base}.{ext}")), root.join(format!("cache/source-{base}.{ext}"))).unwrap(); }
        let mut ctx = manager.prepare_ctx();
        ctx.installed_commit = Some(base);
        let stage = root.join("staging/probe");
        fs::create_dir_all(&stage).unwrap();
        let started = Instant::now();
        let source = ctx.incremental_source(&target, &stage).unwrap().expect("a base archive exists");
        println!("INCREMENTAL_OK {} files in {:?}", incremental::index_tree(&source).unwrap().len(), started.elapsed());
        assert!(root.join(format!("cache/source-{target}.zip")).is_file() && ctx.base_archive(&target).is_some());
        drop(manager);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn size_bounds() {
        assert!(read_bounded(&b"12345"[..], 4).is_err());
    }
    #[test]
    fn readiness_requires_real_json_and_exact_build_identity() {
        let raw = br#"{"code":0,"data":{"ready":true,"status":"ok","build":{"version":"1.0.0","commit":"abc"}}}"#;
        assert!(readiness_matches(raw, "1.0.0", "abc"));
        assert!(!readiness_matches(raw, "1.0.1", "abc"));
        assert!(!readiness_matches(raw, "1.0.0", "other"));
        assert!(!readiness_matches(
            b"<html>SPA fallback</html>",
            "1.0.0",
            "abc"
        ));
        assert!(!readiness_matches(
            br#"{"code":0,"data":{"ready":false}}"#,
            "1.0.0",
            "abc"
        ));
    }
    #[test]
    fn invalid_manifest_and_replay_rejected() {
        let mut manifest = ReleaseManifest {
            schema_version: 1,
            sequence: 2,
            expires_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs()
                + 3600,
            version: "1.0.0".into(),
            commit: "a".repeat(40),
            channel: "stable".into(),
            min_launcher_version: "0.1.0".into(),
            release_id: "release-2".into(),
            artifacts: vec![Artifact {
                platform: "windows".into(),
                arch: "x86_64".into(),
                path: "packages/runtime.zip".into(),
                size: 1,
                sha256: "a".repeat(64),
                kind: "zip".into(),
            }],
            migration: Migration {
                data_schema: 1,
                requires_migration: false,
            },
            release_notes: String::new(),
        };
        assert!(validate_manifest(&manifest, 2).is_ok());
        assert!(validate_manifest(&manifest, 3).is_err());
        manifest.expires_at = 0;
        assert!(validate_manifest(&manifest, 0).is_err());
        manifest.schema_version = 99;
        assert!(validate_manifest(&manifest, 0).is_err());
    }
    #[test]
    fn version_validation() {
        assert!(version_tuple("1.2").is_err());
        assert!(version_tuple("1.2.3-dev").is_err());
        assert!(version_tuple("1.2.3").unwrap() > version_tuple("0.9.9").unwrap());
    }
}
