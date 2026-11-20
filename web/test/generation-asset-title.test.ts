import { expect, test } from "bun:test";
import { generationAssetTitle } from "@/lib/generation-asset-title";

test("生成素材优先继承节点名，其余按提示词命名并区分多输出", () => {
    const task = { id: "task-123456", prompt: "  雨夜\n主角穿过街道  " };
    expect(generationAssetTitle({ ...task, clientContext: { assetTitle: "雨夜重逢 · 主镜头" } }, "video", 0, 1)).toBe("雨夜重逢 · 主镜头");
    expect(generationAssetTitle(task, "video", 0, 1)).toBe("雨夜 主角穿过街道");
    expect(generationAssetTitle({ ...task, prompt: "雨夜" }, "image", 1, 3)).toBe("雨夜 · 2");
    expect(generationAssetTitle({ ...task, prompt: "🌙".repeat(49) }, "image", 0, 1)).toBe("🌙".repeat(48) + "…");
    expect(generationAssetTitle({ ...task, prompt: "" }, "video", 0, 1)).toBe("生成视频 · task-123");
});
