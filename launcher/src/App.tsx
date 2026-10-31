import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setMirrorEnabled } from "./source-preferences";
import { command, defaultAutoUpdate, desktop, errorText, pollOperationProgress, progressPercent, publicMirrors, validateConfig, type Config, type OperationProgress, type Status, type UpdateInfo } from "./bridge";

const initialConfig: Config = { sourceMode: "mirror", officialUrl: "https://github.com/ddcat-ai/open-ai-canvas", mirrorUrl: "https://gh-proxy.com/", port: 37890, openBrowser: true, autoUpdate: defaultAutoUpdate };
const formatTime = (seconds: number) => seconds > 0 ? new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false }) : "尚未检查";
type Tab = "overview" | "settings" | "logs";
export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [config, setConfig] = useState<Config>(initialConfig);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<"stop" | "restart" | "install" | "switch" | "exit" | null>(null);
  const [backgroundProgress, setBackgroundProgress] = useState<OperationProgress | null>(null);
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [progressError, setProgressError] = useState("");
  const mounted = useRef(false);
  const closing = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useRef({ busy: "", running: false, preparing: false });
  current.current = { busy, running: !!status?.running, preparing: !!status?.preparing };
  useEffect(() => {
    if (!desktop) return;
    const subscription = getCurrentWindow().onCloseRequested((event) => {
      if (!closing.current && (current.current.busy || current.current.running || current.current.preparing)) {
        event.preventDefault();
        if (current.current.busy) setError("操作尚未完成，请等待后再退出。");
        else setConfirmation("exit");
      }
    });
    return () => { void subscription.then((unlisten) => unlisten()).catch(() => {}); };
  }, []);
  const refresh = useCallback(async () => { const next = await command<Status>("status"); if (mounted.current) setStatus(next); return next; }, []);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    void refresh().then((s) => { if (!disposed) setConfig(s.config); }).catch((e) => { if (!disposed) setError(errorText(e)); });
    return () => { disposed = true; };
  }, [refresh]);
  useEffect(() => {
    if (!desktop || busy) return;
    let disposed = false;
    let pending = false;
    const id = window.setInterval(() => {
      if (pending || current.current.busy) return;
      pending = true;
      void refresh().catch((e) => { if (!disposed) setError(errorText(e)); }).finally(() => { pending = false; });
    }, 5000);
    return () => { disposed = true; window.clearInterval(id); };
  }, [refresh, busy]);
  useEffect(() => {
    if (!desktop || !busy) return;
    return pollOperationProgress(
      () => command<OperationProgress | null>("operation_progress"),
      (next) => { setProgress(next); setProgressError(""); },
      () => setProgressError("暂时无法读取进度；操作仍在进行，可打开日志目录查看详情。"),
    );
  }, [busy]);
  // The background build holds no manager lock, so its progress is read separately from foreground tasks.
  const backgroundBuilding = !!status?.preparing && !busy;
  useEffect(() => {
    if (!desktop || !backgroundBuilding) { setBackgroundProgress(null); return; }
    return pollOperationProgress(
      () => command<OperationProgress | null>("operation_progress"),
      (next) => setBackgroundProgress(next),
      () => {},
      1500,
    );
  }, [backgroundBuilding]);
  const prepareInBackground = async () => {
    setError(""); setNotice("已开始在后台准备新版本，服务可以继续使用。");
    window.setTimeout(() => { void refresh().catch(() => {}); }, 1000);
    try { const message = await command<string>("prepare_update"); if (mounted.current) setNotice(message); }
    catch (e) { if (mounted.current) { setNotice(""); setError(errorText(e)); } }
    finally { if (mounted.current) await refresh().catch(() => {}); }
  };
  const perform = async (label: string, task: () => Promise<void>) => {
    if (current.current.busy) return;
    current.current.busy = label;
    setBusy(label); setError(""); setNotice(""); setProgress(null); setProgressError("");
    try { await task(); if (mounted.current && !closing.current) await refresh(); }
    catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { current.current.busy = ""; if (mounted.current) { setBusy(""); setProgress(null); setProgressError(""); } }
  };
  const run = (name: string, label: string) => perform(label, async () => { await command(name); if (mounted.current && (name === "install" || name === "start")) setNotice("影策服务已就绪，可以打开影策开始创作。"); });
  const openLogs = async () => {
    try { await command("open_logs_dir"); }
    catch (e) { if (mounted.current) setError(`无法打开日志目录：${errorText(e)}。请检查应用数据目录权限后重试。`); }
  };
  const readLogs = async () => { const next = await command<string[]>("logs"); if (mounted.current) setLogs(next); };
  const installed = status?.installed;
  const percent = progressPercent(progress);
  const backgroundPercent = progressPercent(backgroundProgress);
  const title = busy || (status?.running ? "影策正在运行" : installed ? "准备好开始创作" : "让影策在本机就绪");
  return <div className="app-shell">
    <header className="app-header"><div className="brand"><img src="/logo.svg" alt="" width="34" height="34"/><div><strong>影策</strong><span>本地启动器</span></div></div><span className="platform">{status?.platform || "跨平台工作台"}</span></header>
    <nav className="tabs" aria-label="启动器导航">{([["overview", "工作台"], ["settings", "设置"], ["logs", "运行日志"]] as const).map(([value, label]) => <button key={value} aria-pressed={tab === value} onClick={() => { setTab(value); if (value === "settings" && status) setConfig(status.config); if (value === "logs") void perform("读取日志", readLogs); }}>{label}</button>)}</nav>
    <main>
      {busy && <section className="operation-progress" aria-label="当前操作进度">
        <div className="progress-heading" role="status"><strong>{progress?.stage || busy}</strong><span>{percent === undefined ? "进度待定" : `${Math.round(percent)}%`}</span></div>
        <progress aria-label={progress?.stage || busy} max={100} value={percent}/>
        <p>{progress?.message || "正在处理，请勿关闭应用；下载、依赖安装和源码构建可能需要较长时间。"}</p>
        {progressError && <p role="status">{progressError}</p>}
        <button disabled={!desktop} onClick={() => void openLogs()}>打开日志目录</button>
      </section>}
      {!desktop && <div className="message warning" role="status">当前是网页界面，不能管理本地服务。请从桌面应用打开；这里不会模拟安装或运行结果。</div>}
      {error && <div className="message error" role="alert"><strong>操作未完成</strong><p>{error}</p><p>请检查网络、可用磁盘空间与目录权限；下载失败可在设置中切换镜像，然后重试原操作。</p><button disabled={!desktop} onClick={() => void openLogs()}>打开日志目录</button></div>}
      {status?.recoveryRequired && <div className="message warning" role="alert">候选版本未能完成切换，原版本和原数据仍保留。请先停止服务以完成恢复，期间不要继续创作。</div>}
      {notice && <div className="message" role="status">{notice}</div>}
      {confirmation && <section className="message warning" role="alert"><strong>{confirmation === "install" ? "确认安装更新？" : confirmation === "switch" ? "确认切换到新版本？" : "请先保存工作并结束生成任务"}</strong><p>{confirmation === "switch" ? "新版本已在后台构建完成。切换只在服务停止后进行：会为当前数据创建快照，克隆为新版本的数据副本，候选版本通过就绪检查后才正式切换；旧版本和原数据仍保留。" : confirmation === "install" ? "请先保存工作并等待所有生成任务结束，再停止服务。更新只在服务停止后进行：为当前数据创建快照，克隆为新版本的数据副本，再从固定公共仓库下载源码、安装依赖并构建。候选版本通过就绪检查后才切换；旧版本数据仍保留。这不是活动任务的无损迁移，请勿直接中断任务。" : "停止、重启或退出会中断本地服务。应用会先请求后端正常关闭；超时后会停止受管进程树并报告失败，不能保证活动任务无损结束。"}</p><div className="actions"><button disabled={!!busy} onClick={() => {
        const action = confirmation; setConfirmation(null);
        void perform(action === "install" ? "正在安装更新" : action === "switch" ? "正在切换到新版本" : "正在停止服务", async () => {
          if (action === "install") { await command("install"); if (mounted.current) { setNotice("新版本服务已通过就绪检查，可以打开影策。"); setUpdate(null); } }
          else if (action === "switch") { await command("switch_prepared"); if (mounted.current) { setNotice("新版本服务已通过就绪检查，可以打开影策。"); setUpdate(null); } }
          else { await command("stop"); if (action === "restart") await command("start"); if (action === "exit") { closing.current = true; await getCurrentWindow().destroy(); } }
        });
      }}>确认{confirmation === "install" ? "安装" : confirmation === "switch" ? "切换" : confirmation === "restart" ? "重启" : confirmation === "exit" ? "停止并退出" : "停止"}</button><button onClick={() => setConfirmation(null)}>取消</button></div></section>}
      {tab === "overview" && <>
        {backgroundBuilding && <section className="operation-progress" aria-label="后台准备更新">
          <div className="progress-heading" role="status"><strong>后台正在准备新版本</strong><span>{backgroundPercent === undefined ? "进度待定" : `${Math.round(backgroundPercent)}%`}</span></div>
          <progress aria-label="后台准备更新" max={100} value={backgroundPercent}/>
          <p>{backgroundProgress?.message || "正在下载变化的文件并构建。"}影策可以继续使用，不受影响；准备好后会在这里提示切换。</p>
        </section>}
        {status?.prepared && !status.preparing && !busy && <section className="message" role="status">
          <strong>新版本 {status.prepared.version} 已准备好</strong>
          <p>已在后台下载并构建完成，当前运行的版本不受影响。{status.running ? "要使用它，请先保存工作、等待生成任务结束并停止服务，然后切换。" : "切换时会为新版本复制一份数据，旧版本和原数据都会保留。"}</p>
          <button className="primary" disabled={!desktop || !!status.running} onClick={() => setConfirmation("switch")}>切换到新版本</button>
        </section>}
        <section className="launch-section" aria-busy={!!busy}>
          <div className="status-line"><span className={`status-dot ${status?.running ? "online" : ""}`} aria-hidden="true"/>{busy ? "正在处理，请勿关闭应用" : status?.running ? "本地服务已就绪" : installed ? "服务已停止" : "尚未安装"}</div>
          <h1>{title}</h1><p className="intro">{status?.running ? "在默认浏览器里继续你的创作。关闭浏览器不会停止服务。" : "独立安装、安心更新。创作在浏览器里，服务由这里管理。"}</p>
          <div className="actions">
            <button className="primary" disabled={!desktop || !!busy || !status || !!status.recoveryRequired} onClick={() => void run(status?.running ? "open_browser" : installed ? "start" : "install", status?.running ? "正在打开浏览器" : installed ? "正在启动影策" : "正在安装并启动影策")}>{busy ? "正在处理…" : status?.running ? "打开影策" : installed ? "启动影策" : "安装并启动"}<span aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button>
            {status?.running && <><button disabled={!!busy} onClick={() => setConfirmation("stop")}>停止服务</button><button disabled={!!busy} onClick={() => setConfirmation("restart")}>重启</button></>}
            <button disabled={!desktop || !!busy || !status} onClick={() => void perform("正在检查更新", async () => { const info = await command<UpdateInfo>("check_updates"); if (mounted.current) { setUpdate(info); setNotice(!info.canInstall ? "已读取上游版本，当前无法从源码安装，请查看下方原因。" : info.available ? "发现可从源码构建的版本，请阅读下方更新说明。" : "当前没有更新版本。"); } })}>检查更新</button>
          </div>
          {!installed && <p className="operation-hint">首次安装会按需下载 Go、Bun、Node 和 Windows C 编译器，安装项目依赖并从源码构建。可能需要数分钟或更久，并占用较多磁盘空间；完成后会自动启动并检查服务就绪。</p>}
        </section>
        <dl className="details"><div><dt>当前版本</dt><dd>{installed ? installed.version : "未安装"}{installed && <code>{installed.commit.slice(0, 12)}</code>}</dd></div><div><dt>本地地址</dt><dd>{status?.url || "启动后可用"}</dd></div><div><dt>下载来源</dt><dd>{status ? ({ auto: "按需使用镜像：直连失败后切换", official: "不使用镜像：仅直连官方源", mirror: "使用镜像：仅镜像下载" }[status.config.sourceMode]) : "尚未连接桌面管理核心"}</dd></div><div><dt>公共仓库</dt><dd>{status?.repositoryUrl || initialConfig.officialUrl}</dd></div></dl>
        {update && <section className="update-section"><h2>{!update.canInstall ? "上游最新版本" : update.available ? "可安装版本" : "当前版本信息"} · {update.manifest.version}</h2><p>提交：<code>{update.manifest.commit.slice(0, 12)}</code><br/>来源：{update.source}</p><pre>{update.manifest.releaseNotes || "发布方未提供更新说明。"}</pre><p>{update.reason || "从固定上游公共仓库下载此版本源码并在本机构建，不使用预构建运行包或已签名更新清单。安装不修改你的开发仓库。"}</p>{status?.running && <p>请先等待生成任务结束并停止服务，才能安装更新。</p>}<button disabled={!!busy || !!status?.running || !update.canInstall || !update.available} onClick={() => setConfirmation("install")}>安装此版本</button></section>}
        <p className="footnote">默认从固定的影策上游公共仓库下载源码，在独立目录构建运行。公共代理只改变下载路径，不代表独立发布者身份验证。<button className="text-button" onClick={() => setTab("settings")}>设置镜像</button></p>
      </>}
      {tab === "settings" && <section className="settings"><h1>设置</h1><p className="intro">从固定上游公开仓库下载源码，在本机安装依赖并构建。镜像为可选第三方代理；关闭镜像后仅直连官方源。</p><form onSubmit={(event) => { event.preventDefault(); const invalid = validateConfig(config); if (invalid) { setError(invalid); return; } void perform("保存设置", async () => { const next = await command<Status>("configure", { config }); if (mounted.current) { setStatus(next); setConfig(next.config); setNotice("设置已保存。"); } }); }}>
        <div><label className="checkbox"><input type="checkbox" checked={config.sourceMode !== "official"} aria-describedby="mirror-help" onChange={(e) => setConfig(setMirrorEnabled(config, e.target.checked))}/>使用镜像下载</label><small id="mirror-help">{config.sourceMode === "official" ? "已关闭：仅直连官方源，即使下载失败也不会使用镜像。" : "已开启：可选择仅通过镜像下载，或在直连失败时使用镜像。"}</small></div>
        {config.sourceMode !== "official" && <label>镜像使用方式<select value={config.sourceMode} onChange={(e) => setConfig({ ...config, sourceMode: e.target.value as "auto" | "mirror" })}><option value="mirror">仅使用镜像（适合无法连接 GitHub 的网络）</option><option value="auto">按需使用：直连失败后自动切换镜像</option></select></label>}
        <label>公共仓库<input type="url" readOnly value={initialConfig.officialUrl || ""}/><small>固定指向影策上游仓库，不会操作你本机已有的开发仓库。</small></label>
        {config.sourceMode !== "official" && <label>公共 GitHub 镜像<select value={config.mirrorUrl || "https://gh-proxy.com/"} onChange={(e) => setConfig({ ...config, mirrorUrl: e.target.value })}>{publicMirrors.map((host) => <option key={host} value={`https://${host}/`}>{host}</option>)}</select><small>程序自动拼接完整公共仓库地址。第三方服务不保证长期可用；不会向代理发送账号或私有凭据。</small></label>}
        <label>浏览器访问端口<input type="number" min="1024" max="65535" required value={config.port} onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })}/><small>保持端口不变可保留同一浏览器缓存作用域；更改前请停止服务。</small></label>
        <label className="checkbox"><input type="checkbox" checked={config.openBrowser} onChange={(e) => setConfig({ ...config, openBrowser: e.target.checked })}/>服务就绪后自动打开默认浏览器</label>
        <div><label className="checkbox"><input type="checkbox" checked={config.autoUpdate.enabled} aria-describedby="auto-help" onChange={(e) => setConfig({ ...config, autoUpdate: { ...config.autoUpdate, enabled: e.target.checked } })}/>后台自动拉取更新</label><small id="auto-help">到设定时间，启动器会在后台只下载与上一版不同的文件并构建新版本，服务保持运行。构建完成后只提示，由你停止服务后再切换。仅在启动器打开时执行，错过的时间会在下次打开时补做。</small></div>
        {config.autoUpdate.enabled && <>
          <label>更新频率<select value={config.autoUpdate.schedule} onChange={(e) => setConfig({ ...config, autoUpdate: { ...config.autoUpdate, schedule: e.target.value as "daily" | "interval" } })}><option value="daily">每天固定时间</option><option value="interval">每隔若干小时</option></select></label>
          {config.autoUpdate.schedule === "daily"
            ? <label>每天几点开始<input type="time" required value={config.autoUpdate.time} onChange={(e) => setConfig({ ...config, autoUpdate: { ...config.autoUpdate, time: e.target.value } })}/><small>使用本机时间。建议选在不使用影策的时段，构建会占用 CPU 和磁盘。</small></label>
            : <label>间隔（小时）<input type="number" min="1" max="168" required value={config.autoUpdate.intervalHours} onChange={(e) => setConfig({ ...config, autoUpdate: { ...config.autoUpdate, intervalHours: Number(e.target.value) } })}/><small>可填 1 到 168。从上一次检查完成后开始计时。</small></label>}
        </>}
        {status?.autoRecord?.lastResult && <small>上次后台检查：{formatTime(status.autoRecord.lastCheck)} · {status.autoRecord.lastResult}</small>}
        <div className="actions"><button className="primary" disabled={!desktop || !!busy} type="submit">保存设置</button><button type="button" disabled={!desktop || !!busy || !!status?.preparing || !status?.installed} onClick={() => void prepareInBackground()}>立即在后台准备更新</button></div>
      </form></section>}
      {tab === "logs" && <section className="log-section"><div className="section-heading"><h1>运行日志</h1><div className="actions"><button disabled={!desktop} onClick={() => void openLogs()}>打开日志目录</button><button disabled={!desktop || !!busy} onClick={() => void perform("读取日志", readLogs)}>刷新日志</button></div></div><p className="intro">这里只显示管理核心的受控日志；原始服务日志保存在应用数据目录，不自动导出，避免泄露凭据。</p><pre className="log-output" tabIndex={0}>{logs.length ? logs.join("\n") : "暂无日志。启动服务或安装版本后，可在这里刷新查看。"}</pre></section>}
    </main><footer><span>影策启动器 · 0.1.0 开发版</span><span>仅本机访问 · 不自动开放公网</span></footer>
  </div>;
}
