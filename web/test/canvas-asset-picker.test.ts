import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { assetPickerItemsToInsertPayloads } from "@/components/canvas/asset-picker-modal";
import type { AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import type { ImageAsset, TextAsset } from "@/stores/use-asset-store";

const timestamp = "2026-08-28T00:00:00.000Z";

describe("canvas asset picker", () => {
    test("maps multiple local and external selections in the requested order", () => {
        const image: ImageAsset = {
            id: "image-1",
            kind: "image",
            title: "场景图",
            coverUrl: "",
            tags: [],
            createdAt: timestamp,
            updatedAt: timestamp,
            data: { dataUrl: "data:image/png;base64,AAAA", storageKey: "resource:image-1", width: 1280, height: 720, bytes: 1024, mimeType: "image/png" },
        };
        const text: TextAsset = {
            id: "text-1",
            kind: "text",
            title: "旁白",
            coverUrl: "",
            tags: [],
            createdAt: timestamp,
            updatedAt: timestamp,
            data: { content: "夜色渐深。" },
        };
        const items: AssetLibraryPickerItem[] = [
            { id: image.id, title: image.title, category: "environment", kindLabel: "图片", asset: image },
            { id: text.id, title: text.title, category: "other", kindLabel: "文本", asset: text },
            {
                id: "external-video",
                title: "外部视频",
                category: "external:eagle",
                kindLabel: "视频",
                external: {
                    sourceId: "eagle",
                    sourceName: "Eagle",
                    item: { id: "video-1", title: "外部视频", kind: "video", fileUrl: "http://127.0.0.1/video.mp4", width: 1920, height: 1080, bytes: 2048, mimeType: "video/mp4" },
                },
            },
        ];

        expect(assetPickerItemsToInsertPayloads(["external-video", image.id, text.id], items)).toEqual([
            { kind: "video", url: "http://127.0.0.1/video.mp4", title: "外部视频", width: 1920, height: 1080, bytes: 2048, mimeType: "video/mp4", assetId: "external:eagle:video-1" },
            { kind: "image", dataUrl: "data:image/png;base64,AAAA", storageKey: "resource:image-1", title: "场景图", width: 1280, height: 720, bytes: 1024, mimeType: "image/png", assetId: "image-1" },
            { kind: "text", content: "夜色渐深。", title: "旁白", assetId: "text-1" },
        ]);
    });

    test("rejects stale selections instead of silently dropping them", () => {
        expect(() => assetPickerItemsToInsertPayloads(["missing"], [])).toThrow("所选素材已不存在");
    });
});

describe("canvas context menu motion", () => {
    test("keeps hover feedback stationary while retaining spotlight surfaces", () => {
        const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        const menu = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-context-menu.tsx"), "utf8");
        const menuRule = styles.match(/\.canvas-menu-item\s*\{([\s\S]*?)\}/)?.[1] || "";

        expect(menuRule).not.toContain("transform");
        expect(styles).not.toContain(".canvas-menu-item:not(:disabled):hover {");
        expect(styles).not.toContain(".canvas-menu-item:not(:disabled):active");
        expect(menu).not.toContain("group-hover:translate-x");
        expect(menu).not.toContain("scale: 0.97");
        expect(menu).toContain("<SpotlightSurface");
    });
});
