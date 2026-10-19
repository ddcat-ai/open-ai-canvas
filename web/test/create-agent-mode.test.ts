import { expect, test } from "bun:test";
import * as creationModes from "../src/pages/create/creation-types";
const { defaultCreationMode, modeLabels } = creationModes;

test("新建首页会话默认 Agent，保留旧文本消息的标签", () => {
    expect(defaultCreationMode).toBe("agent");
    expect(modeLabels.text).toBe("文本");
    expect(modeLabels.agent).toBe("Agent");
});

test("模式框只有 Agent、图片和视频，对话模型走文本能力", () => {
    expect((creationModes as any).creationComposerModeOptions?.map((item: { key: string }) => item.key)).toEqual(["agent", "image", "video"]);
    expect((creationModes as any).creationModelCapability?.("agent")).toBe("text");
    expect((creationModes as any).creationModelCapability?.("image")).toBe("image");
});
