import { describe, expect, test } from "bun:test";

import { audioUploadTitleFromFileName } from "../src/lib/audio-upload-title";
import { creationAttachmentFromAudio, creationAttachmentFromAudioAsset, creationAttachmentFromImage, creationAttachmentFromVideo, creationAudioAsset } from "../src/pages/create/creation-assets";
import type { UploadedFile } from "../src/services/file-storage";

describe("audio upload display titles", () => {
    test.each([
        ["配音.final.wav", "配音.final"],
        ["第 1 集.旁白.v2.MP3", "第 1 集.旁白.v2"],
        ["音轨 FLAC.FLAC", "音轨 FLAC"],
        ["无扩展名录音", "无扩展名录音"],
        [".隐藏录音.wav", ".隐藏录音"],
        [".wav", ".wav"],
        ["尾部圆点.", "尾部圆点."],
        ["", ""],
    ])("derives %s without losing the source name", (fileName, title) => {
        expect(audioUploadTitleFromFileName(fileName)).toBe(title);
    });

    const uploaded: UploadedFile = { url: "/api/resources/random-resource/file", storageKey: "resource:random-resource", mimeType: "audio/wav", bytes: 20, durationMs: 1500 };

    test("creation audio attachments use the source stem and retain resource identity", () => {
        const file = new File(["audio"], "旁白.final.wav", { type: "audio/wav" });
        const attachment = creationAttachmentFromAudio(file, uploaded);

        expect(attachment).toMatchObject({
            id: "upload:旁白.final.wav:resource:random-resource",
            name: "旁白.final",
            url: uploaded.url,
            previewUrl: uploaded.url,
            storageKey: uploaded.storageKey,
            type: "audio/wav",
            bytes: 20,
            durationMs: 1500,
        });
        expect(file.name).toBe("旁白.final.wav");
    });

    test("creation preserves custom audio asset titles, including names ending with an extension", () => {
        const asset = creationAudioAsset({ title: "片头音乐.wav", uploaded });
        if (asset.kind !== "audio") throw new Error("Expected an audio asset");
        const attachment = creationAttachmentFromAudioAsset({ ...asset, id: "custom-audio", createdAt: "", updatedAt: "" });

        expect(asset.title).toBe("片头音乐.wav");
        expect(attachment.name).toBe("片头音乐.wav");
    });

    test("creation image and video uploads retain their filename extensions", () => {
        const image = creationAttachmentFromImage(new File(["image"], "场景.final.png", { type: "image/png" }), { ...uploaded, mimeType: "image/png", width: 1280, height: 720 });
        const video = creationAttachmentFromVideo(new File(["video"], "镜头.final.mp4", { type: "video/mp4" }), { ...uploaded, mimeType: "video/mp4" });

        expect(image.name).toBe("场景.final.png");
        expect(video.name).toBe("镜头.final.mp4");
    });
});
