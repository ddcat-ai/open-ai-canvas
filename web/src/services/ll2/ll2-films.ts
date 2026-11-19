/**
 * 本地作品库：只存元数据 + DMC 公开直链，不复制视频二进制。
 *
 * 上游结果直链在服务发布成功后至少保留 24 小时（不是精确 24h 失效，
 * 实际可能更晚删除，也可能已被清理）。所以作品列表会标注生成时间，
 * 并提醒用户尽快下载到本机；链接失效不等于任务失败。
 */

import type { LL2ConnectedVideoModel } from "@/lib/ll2-models";

const STORAGE_KEY = "ll2:films:v1";
const MAX_FILMS = 60;

export type LL2Film = {
    id: string;
    taskId: string;
    model: LL2ConnectedVideoModel;
    prompt: string;
    seconds: number;
    chargedSeconds: number;
    resolution: string;
    ratio: string;
    estimateCNY: number;
    actualCNY: number;
    url: string;
    createdAt: number;
};

function safeParse(raw: string | null): LL2Film[] {
    if (!raw) return [];
    try {
        const value = JSON.parse(raw);
        return Array.isArray(value) ? (value as LL2Film[]).filter((item) => item && typeof item.url === "string") : [];
    } catch {
        return [];
    }
}

export function ll2ListFilms(): LL2Film[] {
    try {
        return safeParse(window.localStorage.getItem(STORAGE_KEY)).sort((a, b) => b.createdAt - a.createdAt);
    } catch {
        return [];
    }
}

export function ll2AddFilm(film: LL2Film): LL2Film[] {
    const next = [film, ...ll2ListFilms().filter((item) => item.id !== film.id)].slice(0, MAX_FILMS);
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // 隐私模式或容量不足：本次会话内仍可用，只是刷新后不保留。
    }
    return next;
}

export function ll2RemoveFilm(id: string): LL2Film[] {
    const next = ll2ListFilms().filter((item) => item.id !== id);
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // 同上
    }
    return next;
}

/** 结果直链最早可清理时间（发布成功后 24h），只用于提示，不做自动删除。 */
export function ll2FilmAgeLabel(createdAt: number) {
    const hours = Math.floor((Date.now() - createdAt) / 3_600_000);
    if (hours < 1) return "刚刚生成";
    if (hours < 24) return `${hours} 小时前生成`;
    return `${Math.floor(hours / 24)} 天前生成 · 直链可能已被清理`;
}

/**
 * 优先把视频下载成 Blob 存到本机；上游对象存储不允许跨域时，
 * 退化为在新标签页打开直链，由用户手动另存。
 */
export async function ll2DownloadFilm(film: LL2Film) {
    const filename = `LL2_${film.model.replace(/[^\w.-]+/g, "_")}_${film.seconds}s_${new Date(film.createdAt).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.mp4`;
    try {
        const response = await fetch(film.url, { mode: "cors" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        return { saved: true, message: "已下载到本机" };
    } catch {
        window.open(film.url, "_blank", "noopener,noreferrer");
        return { saved: false, message: "已在新标签页打开视频，请在播放器里另存到本机" };
    }
}
