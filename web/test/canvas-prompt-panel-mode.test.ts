import { describe, expect, test } from "bun:test";

import { resolvePromptPanelMode } from "../src/components/canvas/canvas-node-prompt-panel";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "../src/types/canvas";
// 触发插件注册（节点定义里声明了 generationMode）。
import "../src/plugins/minimax-t2a/index";

/**
 * 提示词面板的**生成类型**判定（2026-09-19 用户实测的 bug）。
 *
 * 现象：MiniMax T2A 节点的提示词面板显示成「图片生成」、模型下拉只列图片模型。
 * 根因：面板按**内置节点类型**硬编码 mode，只有 `CanvasNodeType.Audio` 才是 audio；
 * 插件节点是自定义类型字符串，一律落到 image —— 尽管插件自己在节点定义里
 * 明确声明了 `generationMode: () => "audio"`。
 */
function node(type: string, metadata?: CanvasNodeMetadata): CanvasNodeData {
    return { id: type, type: type as CanvasNodeData["type"], title: type, position: { x: 0, y: 0 }, width: 100, height: 100, metadata };
}

describe("提示词面板——生成类型判定", () => {
    test("插件节点按自己声明的生成类型（minimax-t2a → 音频）", () => {
        expect(resolvePromptPanelMode(node("minimax-t2a"))).toBe("audio");
    });

    test("内置节点仍旧按类型判定", () => {
        expect(resolvePromptPanelMode(node(CanvasNodeType.Image))).toBe("image");
        expect(resolvePromptPanelMode(node(CanvasNodeType.Video))).toBe("video");
        expect(resolvePromptPanelMode(node(CanvasNodeType.Audio))).toBe("audio");
        expect(resolvePromptPanelMode(node(CanvasNodeType.Text))).toBe("text");
        expect(resolvePromptPanelMode(node(CanvasNodeType.Skill))).toBe("text");
    });

    test("未注册的自定义类型退回内置判定，不因取不到声明而崩", () => {
        // 插件若声明 generationMode: () => null（自带操作界面，宿主据此不显示提示词面板），
        // 或节点类型根本没有注册：mode 退回内置判定即可。
        expect(resolvePromptPanelMode(node("unregistered-custom-node"))).toBe("image");
    });
});
