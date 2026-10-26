import localforage from "localforage";
import { scopedStorageKey } from "@/lib/user-scope";
import { browserGenerationScope, assertBrowserGenerationScope } from "@/lib/browser-generation-session";
import { withGenerationArtifactCommitLock } from "@/services/generation-asset-repository";
import type { GenerationTask } from "@/services/api/task-center";
import type { VideoGenerationTask } from "@/services/api/video";

export type BrowserGenerationRecord = {
    task: GenerationTask;
    channelId: string;
    baseUrl: string;
    protocol: string;
    pendingMedia?: { mode: "image" | "audio"; sources: Array<string | Blob> };
    video?: VideoGenerationTask;
};
const prefix = "yingce:browser-generation:";
export function isBrowserGenerationTask(id: string) { return id.startsWith("browser:"); }
export async function readBrowserGeneration(id: string, scope = browserGenerationScope()) {
    assertBrowserGenerationScope(scope);
    const record = await localforage.getItem<BrowserGenerationRecord>(scopedStorageKey(prefix + id, scope));
    assertBrowserGenerationScope(scope);
    if (!record) throw new Error("本机任务记录不存在；不会查询或重提服务端任务");
    return record;
}
export async function writeBrowserGeneration(record: BrowserGenerationRecord, scope = browserGenerationScope()) {
    assertBrowserGenerationScope(scope);
    return withGenerationArtifactCommitLock(scope, async () => {
        assertBrowserGenerationScope(scope);
        const key = scopedStorageKey(prefix + record.task.id, scope);
        await localforage.setItem(key, record);
        const saved = await localforage.getItem<BrowserGenerationRecord>(key);
        assertBrowserGenerationScope(scope);
        if (saved?.task.updatedAt !== record.task.updatedAt) throw new Error("本机任务无法可靠保存，已停止请求");
    }, { requireCrossRealmLock: true });
}
export async function listBrowserGenerations(scope = browserGenerationScope()) {
    assertBrowserGenerationScope(scope);
    const suffix = `:user:${scope}`;
    const records: BrowserGenerationRecord[] = [];
    await localforage.iterate<BrowserGenerationRecord, void>((record, key) => { if (key.startsWith(prefix + "browser:") && key.endsWith(suffix)) records.push(record); });
    assertBrowserGenerationScope(scope);
    return records.map((record) => record.task);
}
/** GC-only scan under the artifact commit lock; delayed cleanup may target an inactive scope. */
export async function readBrowserGenerationMediaStorageKeys(scope: string): Promise<Set<string>> {
    const suffix = `:user:${scope}`;
    const records: BrowserGenerationRecord[] = [];
    await localforage.iterate<BrowserGenerationRecord, void>((record, key) => {
        if (key.startsWith(prefix + "browser:") && key.endsWith(suffix)) records.push(record);
    });
    const keys = new Set<string>();
    const collect = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        if ("storageKey" in value && typeof value.storageKey === "string") keys.add(value.storageKey);
        Object.values(value).forEach(collect);
    };
    // Parse outside the IndexedDB cursor callback so a corrupt record rejects instead of stranding the GC lock.
    for (const record of records) {
        if (record.task.resultJson) collect(JSON.parse(record.task.resultJson));
        if (record.pendingMedia) {
            const kind = record.pendingMedia.mode === "image" ? "image" : "audio";
            record.pendingMedia.sources.forEach((_source, index) => keys.add(`${kind}:${scope}:${record.task.id}:${index}`));
        }
        if (record.video && record.task.status !== "succeeded") keys.add(`video:${scope}:${record.task.id}:0`);
    }
    return keys;
}
export function removeBrowserGeneration(id: string, scope = browserGenerationScope()) {
    return withGenerationArtifactCommitLock(scope, async () => {
        assertBrowserGenerationScope(scope);
        await localforage.removeItem(scopedStorageKey(prefix + id, scope));
        assertBrowserGenerationScope(scope);
    }, { requireCrossRealmLock: true });
}
export function browserGenerationLock<T>(id: string, run: () => Promise<T>, scope = browserGenerationScope()) {
    assertBrowserGenerationScope(scope);
    if (typeof navigator === "undefined" || !navigator.locks) return Promise.reject(new Error("当前浏览器不支持安全的跨标签任务互斥，请使用 HTTPS 下的现代浏览器"));
    return navigator.locks.request(scopedStorageKey(prefix + id, scope), run);
}
