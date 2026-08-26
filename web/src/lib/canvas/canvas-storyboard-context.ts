import type { CanvasNodeData } from "@/types/canvas";

export type StoryboardGenerationContext = {
    projectStyle: {
        presetId: string;
        title: string;
        prompt: string;
        profileJson?: string;
    };
    characters: Array<{
        assetId: string;
        versionId: string;
        name: string;
        definition: Record<string, unknown>;
    }>;
};

// 分镜的两条入口共用同一强校验，避免画风或角色版本在某条旁路里被遗漏。
export function resolveStoryboardGenerationContext(nodes: CanvasNodeData[]): StoryboardGenerationContext {
    const styleNode = nodes.find((node) => node.metadata?.workflowKind === "styleboard");
    const stylePrompt = String(styleNode?.metadata?.content || styleNode?.metadata?.prompt || "").trim();
    const stylePresetId = String(styleNode?.metadata?.stylePresetId || "").trim();
    if (!styleNode || !stylePrompt || !stylePresetId) throw new Error("请先设置项目画风，再生成分镜");

    // `workflowKind=character` is also used by standalone character-design
    // image workflows. Only nodes linked to a project character asset are
    // storyboard character cards and therefore participate in this check.
    const characterNodes = nodes.filter((node) => node.metadata?.workflowKind === "character" && node.metadata?.characterAssetId?.trim());
    const invalidCharacter = characterNodes.find((node) => !node.metadata?.characterAssetId?.trim() || !node.metadata?.characterVersionId?.trim() || !(node.metadata?.characterName || node.title).trim());
    if (invalidCharacter) throw new Error(`角色卡“${invalidCharacter.metadata?.characterName || invalidCharacter.title || "未命名角色"}”版本未同步，请刷新角色资产后再生成分镜`);

    return {
        projectStyle: {
            presetId: stylePresetId,
            title: styleNode.title.replace(/^(?:项目)?画风\s*[·：:]?\s*/, "").trim() || styleNode.title,
            prompt: stylePrompt,
            profileJson: styleNode.metadata?.styleProfileJson,
        },
        characters: characterNodes.map((node) => ({
            assetId: node.metadata!.characterAssetId!.trim(),
            versionId: node.metadata!.characterVersionId!.trim(),
            name: (node.metadata?.characterName || node.title).trim(),
            definition: node.metadata?.characterDefinition || { prompt: node.metadata?.characterPrompt || "" },
        })),
    };
}
