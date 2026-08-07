import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { collectStoryboardInputSlots } from "@/lib/canvas/storyboard-input-slots";

export type StoryboardGenerationContext = {
    projectStyle: {
        presetId: string;
        title: string;
        prompt: string;
    };
    characters: Array<{
        assetId: string;
        versionId: string;
        name: string;
        definition: Record<string, unknown>;
    }>;
    /** 白盒：上下文来自哪一槽 */
    source?: "slots" | "legacy_scan";
};

function characterFromNode(node: CanvasNodeData) {
    const assetId = node.metadata?.characterAssetId?.trim() || "";
    const versionId = node.metadata?.characterVersionId?.trim() || "";
    const name = (node.metadata?.characterName || node.title || "").trim();
    if (!assetId || !versionId || !name) {
        throw new Error(`角色卡“${name || "未命名角色"}”版本未同步，请刷新角色资产后再生成分镜`);
    }
    return {
        assetId,
        versionId,
        name,
        definition: node.metadata?.characterDefinition || { prompt: node.metadata?.characterPrompt || "" },
    };
}

function styleFromNode(styleNode: CanvasNodeData) {
    const stylePrompt = String(styleNode.metadata?.content || styleNode.metadata?.prompt || "").trim();
    const stylePresetId = String(styleNode.metadata?.stylePresetId || "").trim();
    if (!stylePrompt || !stylePresetId) {
        throw new Error("画风输入口已连接，但画风内容或预设未就绪，请重新设置项目画风");
    }
    return {
        presetId: stylePresetId,
        title: styleNode.title.replace(/^(?:项目)?画风\s*[·：:]?\s*/, "").trim() || styleNode.title,
        prompt: stylePrompt,
    };
}

/**
 * 分镜规划上下文：优先读脚本节点五槽入边（白盒）。
 * 传入 scriptNodeId + connections 时不再扫整张画布。
 * 仅传 nodes 的旧调用保留整画布扫描（兼容测试/旁路），但自动分镜主路径应走 slots。
 */
export function resolveStoryboardGenerationContext(
    nodes: CanvasNodeData[],
    options?: { scriptNodeId?: string; connections?: CanvasConnection[] },
): StoryboardGenerationContext {
    if (options?.scriptNodeId && options.connections) {
        const slots = collectStoryboardInputSlots(options.scriptNodeId, nodes, options.connections);
        const styleNode = slots.style[0];
        if (!styleNode) {
            throw new Error("请将项目画风连接到分镜节点的「画风」输入口，再生成分镜");
        }
        const projectStyle = styleFromNode(styleNode);
        const characters = slots.characters
            .filter((node) => node.metadata?.workflowKind === "character" || node.metadata?.characterAssetId)
            .map(characterFromNode);
        return { projectStyle, characters, source: "slots" };
    }

    // legacy：整画布扫描（仅兼容）
    const styleNode = nodes.find((node) => node.metadata?.workflowKind === "styleboard");
    if (!styleNode) throw new Error("请先设置项目画风，再生成分镜");
    const projectStyle = styleFromNode(styleNode);
    const characterNodes = nodes.filter((node) => node.metadata?.workflowKind === "character");
    const characters = characterNodes.map(characterFromNode);
    return { projectStyle, characters, source: "legacy_scan" };
}
