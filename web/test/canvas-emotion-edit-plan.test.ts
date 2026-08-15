import { describe, expect, test } from "bun:test";

import { buildEmotionPrompt, emotionProviderMask, normalizeEmotionPromptForProvider, resolveEmotionEditPlan } from "../src/lib/canvas/canvas-emotion";

const faceBox = { id: "face-1", x: 120, y: 80, width: 160, height: 180, source: "detected" as const };
const editRegion = { x: 40, y: 20, width: 320, height: 360 };

describe("emotion edit provider plan", () => {
    test("keeps provider mask when the selected image model supports it", () => {
        expect(resolveEmotionEditPlan(true)).toEqual({ mode: "provider-mask", includeMask: true });
    });

    test("falls back visibly to local compositing when the provider does not support masks", () => {
        const plan = resolveEmotionEditPlan(false);
        expect(plan).toEqual({
            mode: "local-composite",
            includeMask: false,
            notice: "当前渠道不支持蒙版，使用脸部裁切与本地羽化融合",
        });
        expect(emotionProviderMask(plan, { dataUrl: "data:image/png;base64,bWFzaw==" })).toBeUndefined();
    });

    test("does not promise a provider mask in the shared emotion prompt", () => {
        const prompt = buildEmotionPrompt(
            { presetId: "emotion-0-0", intimacy: 0, arousal: 0, characterName: "角色1", faceBox },
            editRegion,
        );

        expect(prompt).not.toContain("透明蒙版");
        expect(prompt).not.toContain("白色蒙版");
        expect(prompt).toContain("目标人脸框");
    });

    test("removes legacy mask promises before retrying an existing emotion node", () => {
        const legacyPrompt = [
            "只允许修改目标框及其透明蒙版对应的这一张脸。",
            "输入图已裁切到目标人物头部区域；透明蒙版内允许编辑，白色蒙版区域必须保持不变，蒙版外绝对不要生成或修改任何内容。",
        ].join("\n");

        const prompt = normalizeEmotionPromptForProvider(legacyPrompt);
        expect(prompt).not.toContain("透明蒙版");
        expect(prompt).not.toContain("白色蒙版");
        expect(prompt).toContain("目标人脸框及其邻近表情区域");
    });
});
