import { expect, test } from "bun:test";

import { workbenchVideoOperation } from "../src/pages/workbench/workbench-input";
import { inferVideoOperation } from "../src/lib/model-selection";

test("video workbench distinguishes frames from reference media", () => {
    const first = { kind: "image", role: "first_frame" };
    const last = { kind: "image", role: "last_frame" };
    const reference = { kind: "image", role: "reference" };
    const video = { kind: "video" };
    const audio = { kind: "audio" };
    for (const [references, operation] of [
        [[], "text_to_video"],
        [[first], "image_to_video"],
        [[last, first], "image_to_video"],
        [[reference], "reference_to_video"],
        [[{ kind: "image" }], "reference_to_video"],
        [[first, reference], "reference_to_video"],
        [[video], "reference_to_video"],
        [[audio], "audio_to_video"],
        [[first, audio], "image_to_video"],
        [[reference, audio], "reference_to_video"],
    ] as const) {
        expect(workbenchVideoOperation(references)).toBe(operation);
    }
});

test("model selection uses explicit image roles while preserving legacy count-based input", () => {
    const input = { textCount: 1, imageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 };
    expect(inferVideoOperation(input)).toBe("image_to_video");
    expect(inferVideoOperation({ ...input, referenceImageCount: 0 })).toBe("image_to_video");
    expect(inferVideoOperation({ ...input, referenceImageCount: 1 })).toBe("reference_to_video");
});
