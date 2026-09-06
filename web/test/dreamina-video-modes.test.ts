import { expect, test } from "bun:test";

import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import {
    dreaminaVideoModeError,
    dreaminaVideoModeMaxReferences,
    dreaminaVideoModeOptions,
    dreaminaVideoOperation,
    dreaminaVideoProfileForMode,
    isLocalDreaminaVideoModel,
} from "../src/lib/dreamina-video-modes";

test("Create exposes exactly the three Dreamina CLI video modes requested by the product", async () => {
    expect(dreaminaVideoModeOptions.map((option) => option.label)).toEqual(["全能参考", "首尾帧", "智能多帧"]);
    expect(isLocalDreaminaVideoModel("local:dreamina-cli:seedance2.5")).toBe(true);
    expect(isLocalDreaminaVideoModel("system::seedance2.5")).toBe(false);

    const source = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
    expect(source.indexOf("<DreaminaVideoModePicker")).toBeGreaterThan(source.indexOf("<ModelPicker"));
    expect(source).toContain("<FirstLastFrameReferenceSlots");
    expect(source).toContain('aria-label="首尾帧参考图"');
    expect(source).toContain('aria-label="交换首帧和尾帧"');
    expect(source).not.toContain("智能编辑 Beta");
    expect(source).not.toContain("超长视频 Beta");
});

test("Dreamina menu choices map to distinct official CLI operations", () => {
    expect(dreaminaVideoOperation("all_reference", { image: 0, video: 0, audio: 0 })).toBe("text_to_video");
    expect(dreaminaVideoOperation("all_reference", { image: 1, video: 1, audio: 1 })).toBe("reference_to_video");
    expect(dreaminaVideoOperation("first_last_frames", { image: 2, video: 0, audio: 0 })).toBe("image_to_video");
    expect(dreaminaVideoOperation("smart_multi_frame", { image: 3, video: 0, audio: 0 })).toBe("multi_frame_to_video");
});

test("Dreamina mode limits match the installed CLI contract", () => {
    const model = "local:dreamina-cli:seedance2.0mini";
    expect(dreaminaVideoModeMaxReferences("first_last_frames", model)).toBe(2);
    expect(dreaminaVideoModeMaxReferences("smart_multi_frame", model)).toBe(20);
    expect(dreaminaVideoModeError("first_last_frames", model, { image: 1, video: 0, audio: 0 })).toContain("共 2 张");
    expect(dreaminaVideoModeError("first_last_frames", model, { image: 2, video: 0, audio: 0 })).toBe("");
    expect(dreaminaVideoModeError("smart_multi_frame", model, { image: 2, video: 0, audio: 0 })).toBe("");
    expect(dreaminaVideoModeError("smart_multi_frame", model, { image: 2, video: 1, audio: 0 })).toContain("只接受图片");

    const twoFrame = dreaminaVideoProfileForMode(defaultModelCapabilityConfig().video!, "smart_multi_frame", { image: 2, video: 0, audio: 0 });
    const threeFrame = dreaminaVideoProfileForMode(defaultModelCapabilityConfig().video!, "smart_multi_frame", { image: 3, video: 0, audio: 0 });
    expect(twoFrame.duration.min).toBe(2);
    expect(threeFrame.duration.min).toBe(1);
    expect(threeFrame.resolutions).toEqual(["720p", "1080p"]);
    expect(threeFrame.ratios).toEqual([]);
});
