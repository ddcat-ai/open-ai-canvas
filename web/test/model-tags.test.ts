import { expect, test } from "bun:test";
import { videoReferenceCapabilityTag } from "../src/lib/model-tags";

test("formats video reference limits in image, video, audio order", () => {
    const examples = [
        [{ maxImages: 30, maxVideos: 10, maxAudios: 10 }, "图×30 · 视×10 · 音×10"],
        [{ maxImages: 9, maxVideos: 3, maxAudios: 3 }, "图×9 · 视×3 · 音×3"],
        [{ maxImages: 30, maxVideos: 0, maxAudios: 0 }, "图×30"],
        [{ maxImages: 30, maxVideos: 0, maxAudios: 10 }, "图×30 · 音×10"],
    ] as const;

    for (const [references, text] of examples) {
        expect(videoReferenceCapabilityTag(references)).toEqual({ text, color: "green" });
    }
});

test("omits zero, negative, and non-finite reference limits", () => {
    expect(videoReferenceCapabilityTag({ maxImages: 0, maxVideos: 0, maxAudios: 0 })).toBeUndefined();
    expect(videoReferenceCapabilityTag({ maxImages: -1, maxVideos: Number.NaN, maxAudios: Number.POSITIVE_INFINITY })).toBeUndefined();
    expect(videoReferenceCapabilityTag()).toBeUndefined();
});
