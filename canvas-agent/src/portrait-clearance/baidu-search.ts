import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright-core";

export type PortraitSearchCandidate = { originalRank: number; title: string; imageUrl: string; sourcePageUrl?: string; sourceDomain?: string };

export class PortraitBaiduSearchError extends Error {
    constructor(readonly code: "portrait_search_captcha" | "portrait_search_layout_changed" | "portrait_search_browser_unavailable", message: string) {
        super(message);
        this.name = "PortraitBaiduSearchError";
    }
}

export type PortraitBrowserStatus = { available: boolean; executablePath?: string; browserName?: string };

export async function detectPortraitBrowser(): Promise<PortraitBrowserStatus> {
    for (const candidate of browserCandidates()) {
        try { await fs.access(candidate); return { available: true, executablePath: candidate, browserName: path.basename(candidate) }; } catch { /* try next */ }
    }
    return { available: false };
}

export async function searchBaiduByImage(queryPath: string, options: { maxCandidates: number; scrolls: number; visible: boolean; signal?: AbortSignal } ): Promise<PortraitSearchCandidate[]> {
    const browser = await detectPortraitBrowser();
    if (!browser.available || !browser.executablePath) throw new PortraitBaiduSearchError("portrait_search_browser_unavailable", "未找到系统 Chrome、Edge 或 Chromium");
    const context = await chromium.launch({ executablePath: browser.executablePath, headless: !options.visible });
    try {
        const page = await context.newPage({ acceptDownloads: false });
        await page.goto("https://graph.baidu.com/pcpage/index?tpl_from=pc", { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (options.signal?.aborted) throw abortError();
        const upload = page.locator('input[type="file"]').first();
        if (await upload.count() === 0) throw new PortraitBaiduSearchError("portrait_search_layout_changed", "百度识图上传入口发生变化");
        await upload.setInputFiles(queryPath);
        await page.waitForTimeout(2_000);
        for (let index = 0; index < options.scrolls; index += 1) {
            if (options.signal?.aborted) throw abortError();
            await page.mouse.wheel(0, 1_500);
            await page.waitForTimeout(600);
        }
        const candidates = await page.locator("img").evaluateAll((images) => images.map((image) => {
            const element = image as HTMLImageElement;
            const parent = element.closest("a");
            return { title: element.alt || element.title || "百度识图候选", imageUrl: element.currentSrc || element.src, sourcePageUrl: parent?.href || undefined };
        }).filter((item) => item.imageUrl && /^https?:/i.test(item.imageUrl)));
        if (!candidates.length) {
            const text = await page.locator("body").innerText().catch(() => "");
            if (/验证码|安全验证|异常流量/i.test(text)) throw new PortraitBaiduSearchError("portrait_search_captcha", "百度识图需要验证码或安全验证");
            throw new PortraitBaiduSearchError("portrait_search_layout_changed", "未能从百度识图结果页提取候选图片");
        }
        return candidates.slice(0, options.maxCandidates).map((candidate, index) => ({ ...candidate, originalRank: index + 1, ...(candidate.sourcePageUrl ? { sourceDomain: safeDomain(candidate.sourcePageUrl) } : {}) }));
    } finally {
        await context.close();
    }
}

function browserCandidates() {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return [
        path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(programFiles, "Chromium", "Application", "chrome.exe"),
    ];
}

function safeDomain(value: string) {
    try { return new URL(value).hostname; } catch { return undefined; }
}

function abortError() {
    return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}
