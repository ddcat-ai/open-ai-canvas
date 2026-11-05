import { translate } from "@/i18n";
import { appearanceLogoURL, applyAppearanceMetadata, useAppearanceStore } from "@/stores/use-appearance-store";
import { useDocumentTitleStore } from "@/stores/use-document-title-store";

let unseenCount = 0;
let badgeRequest = 0;
let listening = false;

/**
 * 标签页在后台时记下完成数量：标题前缀「(2) 生成完成 ·」，图标右上角加一个成功色圆点。
 * 回到标签页立即清除。返回 false 表示页面当前可见，调用方应直接展示通知。
 */
export function remindHiddenTab(count: number) {
    if (typeof document === "undefined" || !document.hidden || count <= 0) return false;
    unseenCount += count;
    ensureVisibilityListener();
    useDocumentTitleStore.getState().setAttention(unseenCount, translate("shell.generationNotice.tabTitle"));
    void applyFaviconBadge();
    return true;
}

function clearTabAttention() {
    if (!unseenCount || document.hidden) return;
    unseenCount = 0;
    badgeRequest += 1;
    useDocumentTitleStore.getState().setAttention(0, "");
    // 由外观元数据统一恢复标题与 favicon，避免这里保存一份可能过期的原始图标。
    applyAppearanceMetadata(useAppearanceStore.getState().appearance);
}

function ensureVisibilityListener() {
    if (listening) return;
    listening = true;
    document.addEventListener("visibilitychange", clearTabAttention);
    window.addEventListener("focus", clearTabAttention);
}

async function applyFaviconBadge() {
    const request = ++badgeRequest;
    const appearance = useAppearanceStore.getState().appearance;
    const source = appearanceLogoURL(appearance, document.documentElement.classList.contains("dark") ? "dark" : "light");
    try {
        const href = await faviconWithBadge(source, badgeColor());
        const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
        if (request !== badgeRequest || !unseenCount || !favicon) return;
        favicon.href = href;
    } catch {
        // 跨域 Logo 没有 CORS 时画布会被污染，只保留标题提醒。
    }
}

function badgeColor() {
    return getComputedStyle(document.documentElement).getPropertyValue("--status-success").trim() || "#16a34a";
}

function faviconWithBadge(source: string, color: string) {
    return new Promise<string>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
            try {
                const size = 64;
                const canvas = document.createElement("canvas");
                canvas.width = size;
                canvas.height = size;
                const context = canvas.getContext("2d");
                if (!context) throw new Error("canvas unavailable");
                context.drawImage(image, 0, 0, size, size);
                context.beginPath();
                context.arc(48, 16, 15, 0, Math.PI * 2);
                context.fillStyle = "#ffffff";
                context.fill();
                context.beginPath();
                context.arc(48, 16, 11, 0, Math.PI * 2);
                context.fillStyle = color;
                context.fill();
                resolve(canvas.toDataURL("image/png"));
            } catch (error) {
                reject(error);
            }
        };
        image.onerror = () => reject(new Error("favicon unavailable"));
        image.src = source;
    });
}
