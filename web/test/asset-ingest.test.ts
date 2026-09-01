import { describe, expect, test } from "bun:test";
import { assetToClipKind, makeClipFromAsset } from "@/lib/timeline/asset-ingest";
import type { ProjectAsset } from "@/services/api/projects";

function makeAsset(overrides: Partial<ProjectAsset>): ProjectAsset {
    return {
        id: "ast-1",
        title: "Demo Video",
        mediaType: "video",
        category: "video",
        status: "ready",
        versionCount: 1,
        usages: [],
        position: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        storageKey: "assets/ast-1/master.mp4",
        ...overrides,
    };
}

describe("assetToClipKind", () => {
    test("映射 video/audio/image/text", () => {
        expect(assetToClipKind("video")).toBe("video");
        expect(assetToClipKind("audio")).toBe("audio");
        expect(assetToClipKind("image")).toBe("image");
        expect(assetToClipKind("text")).toBe("text");
    });

    test("未知媒体类型返回 null", () => {
        expect(assetToClipKind("archive")).toBeNull();
        expect(assetToClipKind("")).toBeNull();
    });
});

describe("makeClipFromAsset", () => {
    const options = { trackId: "track-video-1", startMs: 12_000, id: "asset:ast-1:1" };

    test("生成 video clip 且 directMedia 引用资产", () => {
        const clip = makeClipFromAsset(makeAsset({}), options);
        expect(clip).not.toBeNull();
        expect(clip).toMatchObject({
            id: "asset:ast-1:1",
            kind: "video",
            nodeId: "asset:ast-1",
            trackId: "track-video-1",
            startMs: 12_000,
            durationMs: 3_000,
            title: "Demo Video",
            directMedia: {
                id: "ast-1",
                kind: "video",
                title: "Demo Video",
                storageKey: "assets/ast-1/master.mp4",
            },
        });
    });

    test("默认时长可覆盖", () => {
        const clip = makeClipFromAsset(makeAsset({}), { ...options, defaultDurationMs: 500 });
        expect(clip?.durationMs).toBe(500);
    });

    test("无 id 时使用 asset 前缀", () => {
        const clip = makeClipFromAsset(makeAsset({}), { trackId: options.trackId, startMs: 0 });
        expect(clip?.id).toBe("asset:ast-1");
    });

    test("audio 资产映射到 audio kind", () => {
        const clip = makeClipFromAsset(makeAsset({ mediaType: "audio", category: "audio" }), options);
        expect(clip?.kind).toBe("audio");
        expect(clip?.directMedia?.kind).toBe("audio");
    });

    test("text 与未知媒体类型不入轨", () => {
        expect(makeClipFromAsset(makeAsset({ mediaType: "text" }), options)).toBeNull();
        expect(makeClipFromAsset(makeAsset({ mediaType: "script" }), options)).toBeNull();
    });

    test("输入资产不被修改", () => {
        const asset = makeAsset({});
        const before = JSON.stringify(asset);
        makeClipFromAsset(asset, options);
        expect(JSON.stringify(asset)).toBe(before);
    });
});
