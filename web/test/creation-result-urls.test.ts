import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { creationResultStorageKeysForMessage } from "@/lib/canvas/canvas-asset-handoff";
import { creationResultEntries, usableResultUrl } from "@/pages/create/creation-result-urls";

const now = Date.parse("2026-10-21T08:00:00Z");
const remote = (storageKey: string) => storageKey.startsWith("resource:");
const signed = (id: string, expires: number) => `/api/public/resources/${id}/file?expires=${expires}&signature=sig`;
const base = { resolvedByKey: {}, failedByKey: {}, isRemoteKey: remote, now };

describe("快速创作结果展示地址", () => {
    test("远端视频解析前不挂历史 hint，解析后直接使用签名地址", () => {
        const pending = creationResultEntries({ ...base, storageKeys: ["resource:v1"], storedUrls: ["/api/resources/v1/file"], isVideo: true });
        expect(pending).toEqual({ entries: [], resolving: true });
        const resolved = creationResultEntries({ ...base, storageKeys: ["resource:v1"], storedUrls: ["/api/resources/v1/file"], isVideo: true, resolvedByKey: { "resource:v1": signed("v1", 1_800_000_000) } });
        expect(resolved).toEqual({ entries: [{ key: "resource:v1", url: signed("v1", 1_800_000_000) }], resolving: false });
    });

    test("图片以 storageKey 作为结果身份，签名地址变化时 key 不变", () => {
        const first = creationResultEntries({ ...base, storageKeys: ["resource:a", "resource:b"], storedUrls: ["/api/resources/a/file", "/api/resources/b/file"], isVideo: false });
        expect(first.entries.map((entry) => entry.key)).toEqual(["resource:a", "resource:b"]);
        expect(first.entries[0].url).toBe("/api/resources/a/file");
        const renewed = creationResultEntries({
            ...base,
            storageKeys: ["resource:a", "resource:b"],
            storedUrls: ["/api/resources/a/file", "/api/resources/b/file"],
            isVideo: false,
            resolvedByKey: { "resource:a": signed("a", 1_800_000_000), "resource:b": signed("b", 1_800_000_000) },
        });
        expect(renewed.entries.map((entry) => entry.key)).toEqual(["resource:a", "resource:b"]);
    });

    test("已解析的地址优先于 hint，不会退回历史地址", () => {
        const entries = creationResultEntries({ ...base, storageKeys: ["resource:a"], storedUrls: ["/api/resources/a/file"], isVideo: false, resolvedByKey: { "resource:a": signed("a", 1_800_000_000) } });
        expect(entries.entries[0].url).toBe(signed("a", 1_800_000_000));
    });

    test("过期 hint 不展示；首次解析中视为 resolving，解析失败后回退可用 hint", () => {
        const expired = signed("a", Math.floor(now / 1000) - 60);
        expect(usableResultUrl(expired, now)).toBe("");
        expect(creationResultEntries({ ...base, storageKeys: ["resource:a"], storedUrls: [expired], isVideo: false })).toEqual({ entries: [], resolving: true });
        const failed = creationResultEntries({ ...base, storageKeys: ["resource:v1"], storedUrls: ["/api/resources/v1/file"], isVideo: true, failedByKey: { "resource:v1": true } });
        expect(failed).toEqual({ entries: [{ key: "resource:v1", url: "/api/resources/v1/file" }], resolving: false });
    });

    test("没有 storageKey 时沿用历史地址", () => {
        expect(creationResultEntries({ ...base, storageKeys: [], storedUrls: ["https://cdn.example/a.png", ""], isVideo: false })).toEqual({ entries: [{ key: "https://cdn.example/a.png", url: "https://cdn.example/a.png" }], resolving: false });
    });
});

describe("创作消息结果恢复", () => {
    test("任务快照缺少结果字段时仍能从已落库素材恢复稳定定位", () => {
        const assets = [
            {
                id: "asset-1",
                kind: "video",
                title: "镜头",
                coverUrl: "",
                tags: [],
                createdAt: "",
                updatedAt: "",
                metadata: { source: "generation-task", taskId: "task-1", messageId: "message-1", outputIndex: 0 },
                data: { url: "/api/resources/video-1/file", storageKey: "resource:video-1", width: 0, height: 0, bytes: 1, mimeType: "video/mp4" },
            },
        ] as never[];

        expect(creationResultStorageKeysForMessage(assets, { messageId: "message-1", taskIds: ["task-1"] })).toEqual(["resource:video-1"]);
    });
});

describe("MediaResult 不因地址变化重建或闪空态", () => {
    const source = readFileSync(new URL("../src/pages/create/creation-workspace-messages.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
    const start = source.indexOf("export function MediaResult(");
    const media = source.slice(start, source.indexOf("export function CreationMediaPending", start));

    test("effect 重跑时不把已解析地址重设回 hint", () => {
        expect(media).not.toContain("setResolvedResultUrls(");
        expect(media).toContain("setResolvedByKey((current) => (current[storageKey] === url ? current");
    });

    test("结果块与下载链接不以签名地址作为 React key", () => {
        expect(media).not.toContain("key={url}");
        expect(media).not.toContain("key={`${url}-download`}");
        expect(media).toContain("resultEntries.map(({ key, url }) => ( <button key={key}");
    });

    test("首次解析中不显示「没有返回可预览结果」", () => {
        expect(media).toContain("(!displayResultUrls.length && !resolving)");
    });
});
