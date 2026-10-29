import type { PrevisRenderMode } from "@/types/previs";

/**
 * 第二屏监看窗口：独立浏览器窗口持续显示当前镜头摄影机画面，方便多屏用户把成片取景
 * 投到另一块屏幕，主屏继续编辑。
 *
 * - window.open 必须在用户点击的同步路径里调用，否则会被弹窗拦截；
 * - 定位到外接屏依赖 Window Management API（Chrome/Edge，需用户授权），不可用时
 *   窗口照常打开，由用户手动拖到第二屏并按 F 全屏；
 * - 渲染仍由主窗口的 WebGL 上下文完成，监看窗口只接收逐帧拷贝的 2D 画面，
 *   不会创建第二套场景、模型或 GPU 资源。
 */
export type PrevisMonitorFrame = { canvas: HTMLCanvasElement; shotName: string; timecode: string; mode: PrevisRenderMode };
export type PrevisMonitorHandle = { close: () => void; closed: () => boolean; setBrandName: (brandName: string) => void };

const MODE_LABELS: Record<PrevisRenderMode, string> = { beauty: "预览", clay: "白膜", depth: "深度", normal: "法线", pose: "骨骼" };

type ScreenDetailsLike = { screens: Array<{ isPrimary?: boolean; availLeft: number; availTop: number; availWidth: number; availHeight: number }> };
const monitorSessions = new WeakMap<Window, () => void>();

export function openPrevisMonitorWindow(input: { brandName: string; renderFrame: () => PrevisMonitorFrame | null; onClosed: () => void; fps?: number }): PrevisMonitorHandle {
    // 同步打开：保住用户激活，避免被弹窗拦截。
    const popup = window.open("", "yingce-previs-monitor", "popup=yes,width=960,height=600");
    if (!popup) throw new Error("浏览器拦截了监看窗口，请允许本站弹出窗口后重试");
    const monitor: Window = popup;
    monitorSessions.get(monitor)?.();
    const doc = monitor.document;
    doc.body.replaceChildren();
    let stopped = false;
    const setBrandName = (brandName: string) => {
        if (!stopped && !monitor.closed) doc.title = `${brandName}预演台 · 镜头监看`;
    };
    setBrandName(input.brandName);
    // 独立文档拿不到主站 token，这里只用纯黑监看底色与白色文字。
    doc.body.style.cssText = "margin:0;background:#000;color:#fff;font:12px/1.4 system-ui,sans-serif;overflow:hidden;display:grid;place-items:center;height:100vh;";
    const canvas = doc.createElement("canvas");
    canvas.style.cssText = "max-width:100vw;max-height:100vh;object-fit:contain;";
    const hud = doc.createElement("div");
    hud.style.cssText = "position:fixed;left:12px;top:10px;opacity:.72;pointer-events:none;letter-spacing:.04em;";
    const tip = doc.createElement("div");
    tip.style.cssText = "position:fixed;right:12px;bottom:10px;opacity:.45;pointer-events:none;";
    tip.textContent = "F 全屏 · Esc 退出全屏";
    doc.body.append(canvas, hud, tip);
    const ctx = canvas.getContext("2d");
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key.toLowerCase() !== "f") return;
        if (doc.fullscreenElement) void doc.exitFullscreen();
        else void doc.documentElement.requestFullscreen().catch(() => undefined);
    };
    popup.addEventListener("keydown", onKeyDown);

    let last = 0;
    let animationFrame = 0;
    const interval = 1000 / Math.max(1, Math.min(60, input.fps ?? 24));
    const loop = (now: number) => {
        if (stopped || monitor.closed) return finish();
        if (now - last >= interval) {
            last = now;
            try {
                const frame = input.renderFrame();
                if (frame && ctx) {
                    if (canvas.width !== frame.canvas.width || canvas.height !== frame.canvas.height) {
                        canvas.width = frame.canvas.width;
                        canvas.height = frame.canvas.height;
                    }
                    ctx.drawImage(frame.canvas, 0, 0);
                    hud.textContent = `${frame.shotName} · ${MODE_LABELS[frame.mode]} · ${frame.timecode}`;
                }
            } catch (error) {
                hud.textContent = error instanceof Error ? error.message : "监看画面暂不可用";
            }
        }
        animationFrame = monitor.requestAnimationFrame(loop);
    };
    // 监看窗口自己的 rAF：主窗口被遮挡时仍能刷新。
    animationFrame = monitor.requestAnimationFrame(loop);
    const watch = window.setInterval(() => {
        if (monitor.closed) finish();
    }, 500);
    function finish() {
        if (stopped) return;
        stopped = true;
        window.clearInterval(watch);
        monitor.cancelAnimationFrame(animationFrame);
        monitor.removeEventListener("keydown", onKeyDown);
        monitorSessions.delete(monitor);
        input.onClosed();
    }
    monitorSessions.set(monitor, finish);
    void moveToExternalScreen(monitor);
    return {
        close: () => {
            if (stopped) return;
            finish();
            if (!monitor.closed) monitor.close();
        },
        closed: () => stopped || monitor.closed,
        setBrandName,
    };
}

async function moveToExternalScreen(popup: Window) {
    const getScreenDetails = (window as Window & { getScreenDetails?: () => Promise<ScreenDetailsLike> }).getScreenDetails;
    if (typeof getScreenDetails !== "function") return;
    try {
        const details = await getScreenDetails.call(window);
        const external = details.screens.find((screen) => !screen.isPrimary);
        if (!external || popup.closed) return;
        popup.moveTo(external.availLeft, external.availTop);
        popup.resizeTo(external.availWidth, external.availHeight);
    } catch {
        // 用户拒绝授权或浏览器不支持：保留窗口在当前屏，由用户手动拖动。
    }
}

export function formatPrevisTimecode(seconds: number, fps: number) {
    const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const whole = Math.floor(safe);
    const frame = Math.floor((safe - whole) * fps);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}:${pad(frame)}`;
}
