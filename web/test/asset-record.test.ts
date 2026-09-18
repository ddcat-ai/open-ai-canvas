import { describe, expect, test } from "bun:test";

import { parseAssetRecord, parseAssetRecordList } from "@/lib/asset-record";

const completeImage = {
    id: "image-1",
    kind: "image",
    title: "完整图片",
    coverUrl: "https://example.com/a.png",
    tags: ["角色"],
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    data: { dataUrl: "https://example.com/a.png", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
};

describe("parseAssetRecord", () => {
    test("accepts a complete image asset", () => {
        expect(parseAssetRecord(completeImage).tags).toEqual(["角色"]);
    });

    test("rejects missing or malformed tags", () => {
        expect(() => parseAssetRecord({ ...completeImage, tags: undefined })).toThrow(/tags/);
        expect(() => parseAssetRecord({ ...completeImage, tags: ["角色", 1] })).toThrow(/tags/);
    });

    test("rejects incomplete image data instead of filling zeros", () => {
        expect(() => parseAssetRecord({
            ...completeImage,
            data: undefined,
        })).toThrow(/data/);
        expect(() => parseAssetRecord({
            ...completeImage,
            data: { dataUrl: "", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
        })).toThrow(/dataUrl 或 storageKey/);
        expect(() => parseAssetRecord({
            ...completeImage,
            data: { dataUrl: "https://example.com/a.png", width: 0, height: 1, bytes: 1, mimeType: "image/png" },
        })).toThrow(/width/);
    });

    test("rejects wildcard and cross-kind MIME metadata", () => {
        expect(() => parseAssetRecord({
            ...completeImage,
            data: { ...completeImage.data, mimeType: "image/*" },
        })).toThrow(/具体 MIME/);
        expect(() => parseAssetRecord({
            ...completeImage,
            data: { ...completeImage.data, mimeType: "audio/mpeg" },
        })).toThrow(/不匹配/);
        expect(parseAssetRecord({
            ...completeImage,
            data: { ...completeImage.data, mimeType: "application/octet-stream" },
        }).kind).toBe("image");
    });

    test("parseAssetRecordList names the failing record", () => {
        expect(() => parseAssetRecordList([{ ...completeImage, id: "bad", tags: undefined }])).toThrow(/素材 bad/);
    });
});

const completeVideo = {
    id: "video-1",
    kind: "video",
    title: "生成视频",
    coverUrl: "https://example.com/a.mp4",
    tags: ["生成"],
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    data: { url: "https://example.com/a.mp4", width: 720, height: 1280, bytes: 1, mimeType: "video/mp4" },
};

describe("parseAssetRecord 视频尺寸", () => {
    test("宽高未知（0）放行，视频照常入库", () => {
        const parsed = parseAssetRecord({ ...completeVideo, data: { ...completeVideo.data, width: 0, height: 0 } });
        expect(parsed.kind).toBe("video");
        if (parsed.kind === "video") {
            expect(parsed.data.width).toBe(0);
            expect(parsed.data.height).toBe(0);
        }
    });

    test("负数与非法值仍然拒", () => {
        expect(() => parseAssetRecord({ ...completeVideo, data: { ...completeVideo.data, width: -1 } })).toThrow(/width/);
        expect(() => parseAssetRecord({ ...completeVideo, data: { ...completeVideo.data, height: Number.NaN } })).toThrow(/height/);
        expect(() => parseAssetRecord({ ...completeVideo, data: { ...completeVideo.data, width: "720" } })).toThrow(/width/);
    });

    test("图片不受影响：零尺寸仍然拒", () => {
        expect(() => parseAssetRecord({ ...completeImage, data: { ...completeImage.data, width: 0, height: 1 } })).toThrow(/width/);
    });
});
