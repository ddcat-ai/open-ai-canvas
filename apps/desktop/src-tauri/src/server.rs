//! 本地服务的启动、健康门、导航与停止。

use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::config::{self, BootMode, ManagedBoot};
use crate::log::LogSink;
use crate::shell_i18n;
use crate::state::{lock, DesktopService, ShellEnv, ShellState, StartupSnapshot};
use crate::MAIN_WINDOW;

pub const STARTUP_EVENT: &str = "desktop://startup";
const SIDECAR_NAME: &str = "canvas-server";
const PROBE_INTERVAL: Duration = Duration::from_millis(350);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(600);
const PROBE_READ_TIMEOUT: Duration = Duration::from_millis(1500);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 拉起本地服务并把窗口导航过去。失败一律写进启动快照，由启动页解释原因。
pub async fn boot(app: AppHandle) {
    {
        let state = app.state::<ShellState>();
        if state.booting.swap(true, Ordering::SeqCst) {
            return;
        }
    }

    let outcome = boot_inner(&app).await;
    app.state::<ShellState>().booting.store(false, Ordering::SeqCst);

    if let Err(detail) = outcome {
        let env = app.state::<ShellEnv>();
        let lang = env.prefs().lang;
        env.log.line("shell", &format!("启动失败：{detail}"));
        publish(
            &app,
            StartupSnapshot::failed(detail, shell_i18n::text(&lang).phase_starting_service, env.log_path()),
        );
    }
}

async fn boot_inner(app: &AppHandle) -> Result<(), String> {
    let env = app.state::<ShellEnv>();
    if let Some(err) = env.boot_error.clone() {
        return Err(err);
    }
    let paths = env
        .paths
        .clone()
        .ok_or_else(|| "应用数据目录不可用".to_string())?;

    match config::boot_mode(app, &paths)? {
        BootMode::DevUrl(url) => {
            let lang = env.prefs().lang;
            env.log.note(&format!("开发模式：窗口指向 {url}，不拉起本地服务"));
            publish(
                app,
                StartupSnapshot::dev(url.clone(), shell_i18n::text(&lang).phase_dev, env.log_path()),
            );
            navigate(app, &url)
        }
        BootMode::External { base_url, timeout } => {
            let lang = env.prefs().lang;
            let text = shell_i18n::text(&lang);
            publish(app, StartupSnapshot::booting(text.phase_external, env.log_path()));
            let target = ProbeTarget::parse(&base_url)?;
            wait_ready(&target, timeout, None).await?;
            env.log.note(&format!("已连接的本地服务就绪：{base_url}"));
            publish(
                app,
                StartupSnapshot::external(base_url.clone(), text.phase_ready, env.log_path()),
            );
            navigate(app, &base_url)
        }
        BootMode::Managed(boot) => run_managed(app, boot).await,
    }
}

async fn run_managed(app: &AppHandle, boot: ManagedBoot) -> Result<(), String> {
    let env = app.state::<ShellEnv>();
    let log_path = env.log_path();
    let lang = env.prefs().lang;
    let text = shell_i18n::text(&lang);

    publish(app, StartupSnapshot::booting(text.phase_selecting_port, log_path.clone()));
    let preferred = env.prefs().port;
    let port = select_port(preferred)?;
    let base_url = format!("http://127.0.0.1:{port}");
    // 端口就是前端 origin：浏览器存储（个人渠道等）按 origin 隔离，能沿用就沿用。
    let port_note = match preferred {
        Some(previous) if previous == port => format!("沿用上次端口 {port}"),
        Some(previous) => format!("上次端口 {previous} 不可用，改用 {port}"),
        None => format!("首次启动，选用端口 {port}"),
    };
    env.log.note(&format!(
        "{port_note}；数据目录 {}；前端资源 {}",
        boot.data_dir.display(),
        boot.static_dir.display()
    ));

    let command = match &boot.server_bin {
        Some(path) => app.shell().command(path.to_string_lossy().to_string()),
        None => app
            .shell()
            .sidecar(SIDECAR_NAME)
            .map_err(|err| format!("找不到本地服务可执行文件：{err}"))?,
    };
    let command = command
        .env("CANVAS_BACKEND_ADDR", format!("127.0.0.1:{port}"))
        .env("CANVAS_BACKEND_DATA_DIR", boot.data_dir.to_string_lossy().to_string())
        .env("CANVAS_PUBLIC_BASE_URL", base_url.clone())
        .env("CANVAS_STATIC_DIR", boot.static_dir.to_string_lossy().to_string())
        // 与 Go 侧孤儿看门狗约定：父进程消失或壳正常退出都不留孤儿服务。
        .env("CANVAS_EXIT_WITH_PARENT", "1")
        .env("CANVAS_PARENT_PID", std::process::id().to_string());
    // 告诉后端官方协议插件在哪；拿不到时后端回退到从工作目录向上找。
    let command = match &boot.plugin_dir {
        Some(dir) => command.env("CANVAS_OFFICIAL_PLUGIN_DIR", dir.to_string_lossy().to_string()),
        None => command,
    };
    // 告诉后端 pi 运行时压缩包在哪；拿不到时后端回退到仓库目录。
    let command = match &boot.pi_archive {
        Some(archive) => command.env("CANVAS_PI_ARCHIVE", archive.to_string_lossy().to_string()),
        None => command,
    };
    #[cfg(windows)]
    let command = command.creation_flags(CREATE_NO_WINDOW);

    publish(app, StartupSnapshot::booting(text.phase_starting_service, log_path.clone()));
    let (events, child) = command
        .spawn()
        .map_err(|err| format!("拉起本地服务失败：{err}"))?;
    env.log.note(&format!("本地服务进程已拉起（pid={}）", child.pid()));

    let exited = Arc::new(AtomicBool::new(false));
    pump_output(env.log.clone(), events, exited.clone());
    *lock(&app.state::<ShellState>().service) = Some(DesktopService {
        child,
        exited: exited.clone(),
    });

    publish(app, StartupSnapshot::booting(text.phase_waiting_ready, log_path.clone()));
    let target = ProbeTarget::at("127.0.0.1", port)?;
    if let Err(detail) = wait_ready(&target, boot.health_timeout, Some(&exited)).await {
        // 启动失败立刻收掉子进程，避免重试时留下第二个实例占用端口。
        stop(app);
        return Err(detail);
    }

    env.log.note("本地服务已就绪，导航窗口");
    remember_port(&env, port);
    publish(app, StartupSnapshot::ready(base_url.clone(), text.phase_ready, log_path));
    navigate(app, &base_url)
}

/// 停止被托管的本地服务；对未托管的形态（dev / external）不做任何事。
pub fn stop(app: &AppHandle) {
    let state = app.state::<ShellState>();
    let service = lock(&state.service).take();
    if let Some(service) = service {
        let exited = service.exited.clone();
        match service.child.kill() {
            Ok(()) => app.state::<ShellEnv>().log.note("已结束本地服务进程"),
            Err(err) => app
                .state::<ShellEnv>()
                .log
                .line("shell", &format!("结束本地服务进程失败：{err}")),
        }
        exited.store(true, Ordering::SeqCst);
    }
}

/// 重启被托管的本地服务：结束当前进程后按同一启动形态重新拉起。
pub fn restart(app: &AppHandle) {
    stop(app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move { boot(handle).await });
}

fn publish(app: &AppHandle, snapshot: StartupSnapshot) {
    {
        let state = app.state::<ShellState>();
        *lock(&state.snapshot) = Some(snapshot.clone());
    }
    let _ = app.emit(STARTUP_EVENT, &snapshot);
}

fn navigate(app: &AppHandle, url: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| format!("找不到主窗口 {MAIN_WINDOW}"))?;
    let parsed = tauri::Url::parse(url).map_err(|err| format!("窗口地址不合法：{err}"))?;
    window
        .navigate(parsed)
        .map_err(|err| format!("窗口导航失败：{err}"))?;
    let _ = window.set_focus();
    Ok(())
}

/// 优先沿用上次的端口：端口变了前端就换了 origin，用户上次配好的模型渠道会看不到。
/// 上次的端口不可用（被别的进程占着、或落在特权段）时回退到内核分配的空闲端口。
fn select_port(preferred: Option<u16>) -> Result<u16, String> {
    if let Some(port) = preferred {
        if loopback_port_available(port) {
            return Ok(port);
        }
    }
    pick_free_port()
}

/// 只检查回环地址：本地服务不监听外部网卡，占用判定也应只看回环。
fn loopback_port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// 记住实际监听的端口，下次启动优先复用。
fn remember_port(env: &ShellEnv, port: u16) {
    if env.prefs().port == Some(port) {
        return;
    }
    let mut prefs = env.prefs();
    prefs.port = Some(port);
    *lock(&env.prefs) = prefs.clone();
    env.save_prefs(&prefs);
}
/// 桌面壳可接受的失败模式是健康门超时后重试，而不是固定端口带来的启动冲突。
fn pick_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|err| format!("选择空闲端口失败：{err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("读取本地端口失败：{err}"))?
        .port();
    drop(listener);
    Ok(port)
}

async fn wait_ready(
    target: &ProbeTarget,
    timeout: Duration,
    exited: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    let address = target.socket_addr()?;
    let exited = exited.cloned().unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    let wait = tauri::async_runtime::spawn_blocking(move || wait_for_startup(address, timeout, &exited));
    match wait.await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(err)) => Err(err),
        Err(err) => Err(format!("健康门任务异常：{err}")),
    }
}

fn wait_for_startup(address: SocketAddr, timeout: Duration, exited: &AtomicBool) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        if exited.load(Ordering::SeqCst) {
            return Err("本地服务在就绪前退出，请查看日志".to_string());
        }
        if probe_startup(address) {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!("等待本地服务就绪超时（{} 秒）", timeout.as_secs()));
        }
        std::thread::sleep(PROBE_INTERVAL);
    }
}

/// 只读状态行的回环探针：本地就绪判断不值得引入完整 HTTP 客户端依赖。
/// 503 表示依赖尚未就绪，属于继续等待而不是失败。
fn probe_startup(address: SocketAddr) -> bool {
    let mut stream = match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    if stream.set_read_timeout(Some(PROBE_READ_TIMEOUT)).is_err() {
        return false;
    }
    if stream.set_write_timeout(Some(PROBE_READ_TIMEOUT)).is_err() {
        return false;
    }
    let request = format!(
        "GET /api/health/startup HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nUser-Agent: yingce-desktop-shell\r\n\r\n",
        address
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut status_line = String::new();
    if BufReader::new(stream).read_line(&mut status_line).is_err() {
        return false;
    }
    let mut parts = status_line.split_whitespace();
    let _http_version = parts.next();
    let status = parts.next().and_then(|code| code.parse::<u16>().ok());
    matches!(status, Some(code) if (200..300).contains(&code))
}

fn pump_output(
    log: Arc<LogSink>,
    mut events: tauri::async_runtime::Receiver<CommandEvent>,
    exited: Arc<AtomicBool>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            // CommandEvent 是 non_exhaustive：新增事件类型不应让壳编译不过。
            match event {
                CommandEvent::Stdout(bytes) => log.line("out", &String::from_utf8_lossy(&bytes)),
                CommandEvent::Stderr(bytes) => log.line("err", &String::from_utf8_lossy(&bytes)),
                CommandEvent::Error(err) => log.line("shell", &err),
                CommandEvent::Terminated(payload) => {
                    log.line("shell", &format!("本地服务进程已退出（code={:?}）", payload.code));
                    exited.store(true, Ordering::SeqCst);
                }
                _ => {}
            }
        }
    });
}

struct ProbeTarget {
    host: String,
    port: u16,
}

impl ProbeTarget {
    fn at(host: &str, port: u16) -> Result<Self, String> {
        Ok(Self {
            host: host.to_string(),
            port,
        })
    }

    /// 只支持显式带端口的 http 地址；壳自己生成托管地址，这里主要服务复用已有服务的场景。
    fn parse(url: &str) -> Result<Self, String> {
        let invalid = || format!("本地服务地址不合法（需要 http://主机:端口）：{url}");
        let rest = url.split_once("//").map(|(_, rest)| rest).unwrap_or(url);
        let authority = rest.split(['/', '?']).next().ok_or_else(invalid)?;
        let (host, port) = authority.rsplit_once(':').ok_or_else(invalid)?;
        if host.is_empty() {
            return Err(invalid());
        }
        let port = port.parse::<u16>().map_err(|_| invalid())?;
        Self::at(host, port)
    }

    fn socket_addr(&self) -> Result<SocketAddr, String> {
        (self.host.as_str(), self.port)
            .to_socket_addrs()
            .ok()
            .and_then(|mut addrs| addrs.next())
            .ok_or_else(|| format!("无法解析本地服务地址 {}:{}", self.host, self.port))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_reusable_service_url() {
        let target = ProbeTarget::parse("http://127.0.0.1:8080/").expect("解析失败");
        assert_eq!(target.host, "127.0.0.1");
        assert_eq!(target.port, 8080);

        let target = ProbeTarget::parse("http://localhost:1234").expect("解析失败");
        assert_eq!(target.host, "localhost");
        assert_eq!(target.port, 1234);
    }

    #[test]
    fn rejects_urls_without_explicit_port() {
        assert!(ProbeTarget::parse("http://127.0.0.1").is_err());
        assert!(ProbeTarget::parse("http://127.0.0.1:abc").is_err());
        assert!(ProbeTarget::parse("").is_err());
    }

    #[test]
    fn picks_a_loopback_port() {
        let port = pick_free_port().expect("选择端口失败");
        assert!(port > 0);
    }

    #[test]
    fn reuses_the_remembered_port_when_free() {
        let port = pick_free_port().expect("选择端口失败");
        assert_eq!(select_port(Some(port)).expect("选择端口失败"), port);
    }

    #[test]
    fn falls_back_when_the_remembered_port_is_taken() {
        // 占着内存里的监听器，模拟“上次的端口已被其他进程占用”。
        let listener = TcpListener::bind("127.0.0.1:0").expect("占用端口失败");
        let taken = listener.local_addr().expect("读取端口失败").port();
        let selected = select_port(Some(taken)).expect("选择端口失败");
        assert_ne!(selected, taken);
        assert!(selected > 0);
    }

    #[test]
    fn selects_a_fresh_port_without_a_remembered_one() {
        assert!(select_port(None).expect("选择端口失败") > 0);
    }

    #[test]
    fn probe_fails_fast_when_nothing_listens() {
        // 绑一个端口后立刻释放，探针必须在连接层面就失败，而不是等到超时。
        let port = pick_free_port().expect("选择端口失败");
        let target = ProbeTarget::at("127.0.0.1", port).expect("构造探针失败");
        let address = target.socket_addr().expect("解析探针地址失败");
        assert!(!probe_startup(address));
    }

    #[test]
    fn watchdog_aborts_waiting_immediately() {
        let exited = AtomicBool::new(true);
        let started = Instant::now();
        let err = wait_for_startup("127.0.0.1:1".parse().expect("地址"), Duration::from_secs(30), &exited)
            .expect_err("应当失败");
        assert!(err.contains("退出"));
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
