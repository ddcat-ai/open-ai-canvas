import { invoke, isTauri } from "@tauri-apps/api/core";

export type AutoUpdate = { enabled: boolean; schedule: "daily" | "interval"; time: string; intervalHours: number };
export const defaultAutoUpdate: AutoUpdate = { enabled: false, schedule: "daily", time: "03:00", intervalHours: 24 };
export type Config = { sourceMode: "auto" | "official" | "mirror"; officialUrl: string | null; mirrorUrl: string | null; port: number; openBrowser: boolean; autoUpdate: AutoUpdate };
/** Must match `PUBLIC_MIRRORS` in src-tauri/src/core.rs. The first entry is the default. */
export const publicMirrors = ["gh-proxy.com", "gh-proxy.org", "gh.idayer.com", "cors.isteed.cc", "ghfast.top", "ghproxy.net"] as const;
export type Installed = { version: string; commit: string; [key: string]: unknown };
export type Status = { config: Config; installed: Installed | null; running: boolean; pid: number | null; url: string; platform: string; repositoryUrl: string; recoveryRequired?: boolean; preparing: boolean; prepared: { version: string; commit: string } | null; autoRecord: { lastCheck: number; lastResult: string } };
export type UpdateInfo = { available: boolean; canInstall: boolean; reason: string | null; source: string; manifest: { version: string; commit: string; releaseNotes: string; migration: { dataSchema: number; requiresMigration: boolean } } };
export type OperationProgress = { stage: string; percent: number; message: string };
export function progressPercent(progress: OperationProgress | null): number | undefined {
  return progress && Number.isFinite(progress.percent) && progress.percent > 0
    ? Math.min(100, progress.percent) : undefined;
}
// One request at a time; cancellation also discards any in-flight result.
export function pollOperationProgress(
  read: () => Promise<OperationProgress | null>,
  receive: (progress: OperationProgress | null) => void,
  failed: (error: unknown) => void,
  interval = 800,
): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try { const progress = await read(); if (!disposed) receive(progress); }
    catch (error) { if (!disposed) failed(error); }
    if (!disposed) timer = setTimeout(() => { void poll(); }, interval);
  };
  void poll();
  return () => { disposed = true; clearTimeout(timer); };
}
export const desktop = isTauri();
export async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!desktop) throw new Error("当前仅为网页界面。请运行桌面应用，以使用安装、启动和更新功能。");
  return invoke<T>(name, args);
}
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function validateConfig(config: Config): string | null {
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) return "本地端口应为 1024 到 65535 之间的整数。";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.autoUpdate.time)) return "自动更新时间应为 HH:MM，例如 03:00。";
  if (!Number.isInteger(config.autoUpdate.intervalHours) || config.autoUpdate.intervalHours < 1 || config.autoUpdate.intervalHours > 168) return "自动更新间隔应为 1 到 168 小时的整数。";
  for (const value of [config.mirrorUrl]) {
    if (!value) continue;
    try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/")) return "下载源应为以 / 结尾、不包含凭据、查询参数或片段的 HTTPS 基础地址。"; }
    catch { return "下载源地址格式不正确。"; }
  }
  if (config.officialUrl && config.officialUrl.replace(/\/$/, "") !== "https://github.com/ddcat-ai/open-ai-canvas") return "当前版本固定使用影策上游公共仓库。";
  if (config.mirrorUrl && !publicMirrors.map((host) => `https://${host}/`).includes(config.mirrorUrl)) return "请选择支持的公共 GitHub 镜像。";
  return null;
}
