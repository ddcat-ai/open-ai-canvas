import { describe, expect, test } from "bun:test";
import { remoteAssetToPickerItem, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { creationLibraryDisabledReason, creationLibrarySelectionToAttachments } from "@/pages/create/creation-library";
import type { Asset } from "@/stores/use-asset-store";

const base = { title: "远端素材", coverUrl: "", tags: [], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
const image: Asset = { ...base, id: "remote-image", kind: "image", data: { dataUrl: "https://example.com/image.png", width: 1280, height: 720, bytes: 1024, mimeType: "image/png" } };
const video: Asset = { ...base, id: "remote-video", kind: "video", data: { url: "https://example.com/video.mp4", storageKey: "resource:video", width: 1280, height: 720, durationMs: 1000, bytes: 2048, mimeType: "video/mp4" } };
const audio: Asset = { ...base, id: "remote-audio", kind: "audio", data: { url: "https://example.com/audio.mp3", storageKey: "resource:audio", durationMs: 1000, bytes: 512, mimeType: "audio/mpeg" } };

function remoteItem(asset: Asset, mode: "text" | "image" | "video" = "text") {
    return remoteAssetToPickerItem(asset, undefined, true, creationLibraryDisabledReason(mode, asset.kind));
}

describe("creation remote library", () => {
    test("uncached remote media can be selected and converted without a local asset record", () => {
        const items = [remoteItem(image), remoteItem(video), remoteItem(audio)];
        expect(items.every((item) => !item.disabledReason)).toBe(true);
        const attachments = creationLibrarySelectionToAttachments([audio.id, image.id, video.id], items, "text");
        expect(attachments.map((item) => item.id)).toEqual([`asset:${audio.id}`, `asset:${image.id}`, `asset:${video.id}`]);
        expect(attachments.map((item) => item.type)).toEqual(["audio/mpeg", "image/png", "video/mp4"]);
        expect(attachments[0].url).toBe(audio.data.url);
        expect(attachments[1].url).toBe(image.data.dataUrl);
        expect(attachments[2].storageKey).toBe(video.data.storageKey);
    });

    test("unselected items from other pages are not added to the references", () => {
        const attachments = creationLibrarySelectionToAttachments([video.id, image.id], [remoteItem(image), remoteItem(audio), remoteItem(video)], "text");
        expect(attachments.map((item) => item.id)).toEqual([`asset:${video.id}`, `asset:${image.id}`]);
    });

    test("other callers still reject uncached assets unless they accept remote records", () => {
        expect(remoteAssetToPickerItem(image, undefined, false).disabledReason).toBe("此素材不适用于当前操作");
        const known = { ...remoteItem(image), disabledReason: "素材不可用" };
        expect(remoteAssetToPickerItem(image, known, true).disabledReason).toBe("素材不可用");
    });

    test("image creation applies the same media restrictions before selection and on confirmation", () => {
        expect(remoteItem(image, "image").disabledReason).toBeUndefined();
        expect(remoteItem(video, "image").disabledReason).toBe("图片创作仅支持参考图");
        expect(remoteItem(audio, "image").disabledReason).toBe("图片创作仅支持参考图");
        expect(() => creationLibrarySelectionToAttachments([image.id, video.id], [remoteItem(image), remoteItem(video)], "image")).toThrow("图片创作仅支持参考图");
    });

    test("video creation revalidates changed model capabilities on confirmation", () => {
        const limits = { maxImages: 1, maxVideos: 1, maxAudios: 0 };
        expect(creationLibraryDisabledReason("video", "image", limits)).toBeUndefined();
        expect(creationLibraryDisabledReason("video", "video", limits)).toBeUndefined();
        expect(remoteAssetToPickerItem(audio, undefined, true, creationLibraryDisabledReason("video", "audio", limits)).disabledReason).toBe("当前视频模型不支持参考音频");
        expect(() => creationLibrarySelectionToAttachments([audio.id], [remoteItem(audio)], "video", limits)).toThrow("当前视频模型不支持参考音频");
        expect(creationLibrarySelectionToAttachments([video.id], [remoteItem(video)], "video", limits)[0].id).toBe(`asset:${video.id}`);
    });

    test("missing, disabled and unsupported records fail explicitly", () => {
        expect(() => creationLibrarySelectionToAttachments([image.id, "missing"], [remoteItem(image)], "text")).toThrow("所选素材已不存在");
        expect(() => creationLibrarySelectionToAttachments([image.id], [{ ...remoteItem(image), disabledReason: "素材不可用" }], "text")).toThrow("素材不可用");
        const text: Asset = { ...base, id: "remote-text", kind: "text", data: { content: "参考文本" } };
        expect(remoteItem(text).disabledReason).toBe("此类型素材暂不支持作为创作参考");
        expect(() => creationLibrarySelectionToAttachments([text.id], [remoteAssetToPickerItem(text, undefined, true)], "text")).toThrow("此类型素材暂不支持作为创作参考");
    });

    test("plugin assets are still converted alongside remote library assets", () => {
        const external: AssetLibraryPickerItem = {
            id: "external:eagle:image",
            title: "Eagle 图片",
            category: "external:eagle",
            kindLabel: "图片",
            external: { sourceId: "eagle", sourceName: "Eagle", item: { id: "image", title: "Eagle 图片", kind: "image", fileUrl: "https://example.com/external.png" } },
        };
        const attachments = creationLibrarySelectionToAttachments([external.id, image.id], [remoteItem(image), external], "text");
        expect(attachments.map((item) => item.id)).toEqual([external.id, `asset:${image.id}`]);
        expect(attachments[0].url).toBe("https://example.com/external.png");
    });
});
