import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import { FRAME_HEADER_HEIGHT } from "@/lib/canvas/canvas-frame";
import { CanvasNodeType, type CanvasConnection, type CanvasDocumentChapter, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";

export type DocumentCharacterBreakdown = {
    name: string;
    aliases: string[];
    role: string;
    appearance: string;
    clothing: string;
    physique: string;
    personality: string;
    props: string;
    consistencyPrompt: string;
    multiViewPrompt: string;
};

export function normalizeCharacterName(value?: string) {
    return (value || "").toLocaleLowerCase("zh-CN").replace(/^角色[：:]\s*/, "").replace(/[\s·•・._-]+/g, "").trim();
}

export function parseDocumentCharacterBreakdown(raw: string): DocumentCharacterBreakdown[] {
    const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const starts = [unfenced.indexOf("{"), unfenced.indexOf("[")].filter((index) => index >= 0);
    const start = starts.length ? Math.min(...starts) : -1;
    const end = Math.max(unfenced.lastIndexOf("}"), unfenced.lastIndexOf("]"));
    if (start < 0 || end < start) throw new Error("角色拆解没有返回可识别的 JSON");

    let parsed: unknown;
    try {
        parsed = JSON.parse(unfenced.slice(start, end + 1));
    } catch (error) {
        throw new Error(`角色拆解结果格式不正确：${error instanceof Error ? error.message : "无法解析 JSON"}`);
    }
    const candidates = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? (parsed as { characters?: unknown }).characters : undefined;
    if (!Array.isArray(candidates)) throw new Error("角色拆解结果缺少 characters 数组");

    const seen = new Set<string>();
    const characters: DocumentCharacterBreakdown[] = [];
    candidates.forEach((candidate) => {
        if (!candidate || typeof candidate !== "object") return;
        const value = candidate as Record<string, unknown>;
        const name = String(value.name || "").trim();
        const key = normalizeCharacterName(name);
        const aliases = Array.isArray(value.aliases) ? value.aliases.map((alias) => String(alias).trim()).filter(Boolean) : [];
        const identityKeys = [key, ...aliases.map(normalizeCharacterName)].filter(Boolean);
        if (!name || !key || identityKeys.some((identityKey) => seen.has(identityKey))) return;
        identityKeys.forEach((identityKey) => seen.add(identityKey));
        characters.push({
            name,
            aliases: Array.from(new Set(aliases.filter((alias) => normalizeCharacterName(alias) !== key))),
            role: String(value.role || "").trim(),
            appearance: String(value.appearance || "").trim(),
            clothing: String(value.clothing || "").trim(),
            physique: String(value.physique || "").trim(),
            personality: String(value.personality || "").trim(),
            props: String(value.props || "").trim(),
            consistencyPrompt: String(value.consistencyPrompt || "").trim(),
            multiViewPrompt: String(value.multiViewPrompt || "").trim(),
        });
    });
    if (!characters.length) throw new Error("没有从小说中识别到可用角色");
    return characters;
}

export function buildCharacterIdentityPrompt(character: DocumentCharacterBreakdown) {
    return [
        character.role && `人物定位：${character.role}`,
        character.appearance && `固定外貌：${character.appearance}`,
        character.clothing && `固定服饰：${character.clothing}`,
        character.physique && `身形体态：${character.physique}`,
        character.personality && `气质表演：${character.personality}`,
        character.props && `固定道具：${character.props}`,
        character.consistencyPrompt && `一致性约束：${character.consistencyPrompt}`,
    ].filter(Boolean).join("\n");
}

export function buildCharacterMultiViewPrompt(character: DocumentCharacterBreakdown, projectStyle: string) {
    return [
        `【任务】为短剧项目生成“${character.name}”的单张多视角角色转面参考图。`,
        `【项目画风】\n${projectStyle.trim()}`,
        `【角色固定设定】\n${buildCharacterIdentityPrompt(character)}`,
        `【转面设计】同一画面从左到右依次排布正面全身、严格左侧面全身、严格背面全身三个标准视角；三个人像是同一角色的转面展示，不是三个角色。${character.multiViewPrompt ? ` ${character.multiViewPrompt}` : ""}`,
        "【画面规范】纯净中性背景，均匀柔光，无透视夸张，三个视角等高、等比例、完整全身、间距清楚；必须使用同一脸型、同一发型、同一服装版本、同一体型、同一道具和同一材质系统，清楚展示服装正侧背结构与道具佩戴位置。",
        "【禁止】禁止额外人物、剧情场景、动作姿势、表情变化、文字、标注、水印、遮挡、裁切身体、服装变化、换脸、年龄漂移、体型漂移、道具错位和画风漂移。",
    ].filter(Boolean).join("\n\n");
}

export function partitionCharacterBreakdowns(characters: DocumentCharacterBreakdown[], nodes: CanvasNodeData[]) {
    const existingNames = new Set(nodes.flatMap((node) => {
        const kind = node.metadata?.workflowKind as string | undefined;
        if (kind !== "character" && kind !== "character_card") return [];
        return [node.metadata?.characterName, ...(node.metadata?.characterAliases || [])].map(normalizeCharacterName).filter(Boolean);
    }));
    const existing: DocumentCharacterBreakdown[] = [];
    const newCharacters: DocumentCharacterBreakdown[] = [];
    characters.forEach((character) => {
        const keys = [character.name, ...character.aliases].map(normalizeCharacterName).filter(Boolean);
        (keys.some((key) => existingNames.has(key)) ? existing : newCharacters).push(character);
    });
    return { existing, newCharacters };
}

export function removeLegacyCharacterCards(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const legacyIds = new Set(nodes.filter((node) => (node.metadata?.workflowKind as string | undefined) === "character_card").map((node) => node.id));
    if (!legacyIds.size) return { nodes, connections };
    return {
        nodes: nodes.filter((node) => !legacyIds.has(node.id)),
        connections: connections.filter((connection) => !legacyIds.has(connection.fromNodeId) && !legacyIds.has(connection.toNodeId)),
    };
}

export function upsertCharacterReferenceBoard({
    nodes,
    connections,
    documentNode,
    documentTitle,
    chapter,
    characters,
    projectStyle,
}: {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    documentNode: CanvasNodeData;
    documentTitle: string;
    chapter?: CanvasDocumentChapter;
    characters: DocumentCharacterBreakdown[];
    projectStyle: string;
}) {
    let nextNodes = [...nodes];
    let nextConnections = [...connections];
    const imageWidth = NODE_DEFAULT_SIZE[CanvasNodeType.Image].width;
    const imageHeight = NODE_DEFAULT_SIZE[CanvasNodeType.Image].height;
    const framePadding = 24;
    const nodeGap = 20;

    let frame = nextNodes.find((node) => node.type === CanvasNodeType.Frame && node.metadata?.workflowTitle === "角色多视角" && node.metadata?.documentNodeId === documentNode.id);
    if (!frame) {
        const columns = Math.min(3, Math.max(1, characters.length));
        const rows = Math.ceil(characters.length / columns);
        const width = framePadding * 2 + columns * imageWidth + (columns - 1) * nodeGap;
        const height = FRAME_HEADER_HEIGHT + framePadding * 2 + rows * imageHeight + (rows - 1) * nodeGap;
        const position = findFreeFramePosition(nextNodes, documentNode, width, height);
        frame = createReferenceNode(CanvasNodeType.Frame, { x: position.x + width / 2, y: position.y + height / 2 }, {
            workflowKind: "reference_set",
            workflowTitle: "角色多视角",
            documentNodeId: documentNode.id,
            frame: { collapsed: false, expandedWidth: width, expandedHeight: height },
        });
        frame.position = position;
        frame.width = width;
        frame.height = height;
        nextNodes.push(frame);
    }

    let createdCount = 0;
    let updatedCount = 0;
    characters.forEach((character) => {
        const keys = new Set([character.name, ...character.aliases].map(normalizeCharacterName).filter(Boolean));
        const matchesCharacter = (node: CanvasNodeData) => [node.metadata?.characterName, ...(node.metadata?.characterAliases || [])].some((value) => keys.has(normalizeCharacterName(value)));
        const legacyCards = nextNodes.filter((node) => (node.metadata?.workflowKind as string | undefined) === "character_card" && matchesCharacter(node));
        const existingImages = nextNodes.filter((node) => node.type === CanvasNodeType.Image && node.metadata?.workflowKind === "character" && matchesCharacter(node));
        const existing = existingImages.find((node) => node.metadata?.characterView === "multi");
        const identityPrompt = buildCharacterIdentityPrompt(character);
        const multiViewPrompt = buildCharacterMultiViewPrompt(character, projectStyle);
        const metadata: CanvasNodeMetadata = {
            ...existing?.metadata,
            prompt: multiViewPrompt,
            composerContent: multiViewPrompt,
            status: existing?.metadata?.content ? "success" : "idle",
            errorDetails: undefined,
            generationMode: "image",
            workflowKind: "character",
            workflowTitle: `${character.name}多视角参考图`,
            documentNodeId: documentNode.id,
            chapterId: chapter?.id,
            chapterTitle: chapter?.title,
            characterName: character.name,
            characterAliases: character.aliases,
            characterPrompt: identityPrompt,
            characterView: "multi",
            assetTags: Array.from(new Set([...(existing?.metadata?.assetTags || []).filter((tag) => !/^角色[：:]|^视角[：:]/.test(tag)), `角色: ${character.name}`, "视角: 多视角"])),
        };
        if (existing) {
            nextNodes = nextNodes.map((node) => node.id === existing.id ? { ...existing, title: `${character.name} · 多视角参考`, parentId: frame!.id, metadata } : node);
            updatedCount += 1;
        } else {
            const imageNode = createReferenceNode(CanvasNodeType.Image, { x: frame!.position.x + framePadding + imageWidth / 2, y: frame!.position.y + FRAME_HEADER_HEIGHT + framePadding + imageHeight / 2 }, metadata);
            imageNode.title = `${character.name} · 多视角参考`;
            imageNode.parentId = frame!.id;
            nextNodes.push(imageNode);
            createdCount += 1;
        }

        const obsoleteViewIds = new Set(existingImages.filter((node) => node.metadata?.characterView !== "multi").map((node) => node.id));
        nextNodes = nextNodes.flatMap((node) => {
            if (!obsoleteViewIds.has(node.id)) return [node];
            if (!node.metadata?.content) return [];
            return [{ ...node, parentId: undefined, metadata: { ...node.metadata, workflowKind: "free" as const, workflowTitle: "旧角色参考", characterName: undefined, characterAliases: undefined, characterPrompt: undefined, characterView: undefined, assetTags: (node.metadata.assetTags || []).filter((tag) => !/^角色[：:]|^视角[：:]/.test(tag)) } }];
        });
        nextConnections = nextConnections.filter((connection) => !obsoleteViewIds.has(connection.fromNodeId) && !obsoleteViewIds.has(connection.toNodeId));

        const legacyIds = new Set(legacyCards.map((node) => node.id));
        nextNodes = nextNodes.filter((node) => !legacyIds.has(node.id));
        nextConnections = nextConnections.filter((connection) => !legacyIds.has(connection.fromNodeId) && !legacyIds.has(connection.toNodeId));
    });

    const children = nextNodes.filter((node) => node.parentId === frame!.id && node.type === CanvasNodeType.Image && node.metadata?.workflowKind === "character" && node.metadata?.characterView === "multi");
    const columns = Math.min(3, Math.max(1, children.length));
    const rows = Math.ceil(children.length / columns);
    const frameWidth = framePadding * 2 + columns * imageWidth + (columns - 1) * nodeGap;
    const frameHeight = FRAME_HEADER_HEIGHT + framePadding * 2 + rows * imageHeight + (rows - 1) * nodeGap;
    nextNodes = nextNodes.map((node) => {
        if (node.id === frame!.id) return { ...node, title: `角色参考 · ${documentTitle}`, width: frameWidth, height: frameHeight, metadata: { ...node.metadata, workflowKind: "reference_set", workflowTitle: "角色多视角", documentNodeId: documentNode.id, chapterId: undefined, chapterTitle: undefined, frame: { collapsed: false, expandedWidth: frameWidth, expandedHeight: frameHeight } } };
        const index = children.findIndex((child) => child.id === node.id);
        if (index < 0) return node;
        const column = index % columns;
        const row = Math.floor(index / columns);
        return { ...node, position: { x: frame!.position.x + framePadding + column * (imageWidth + nodeGap) + (imageWidth - node.width) / 2, y: frame!.position.y + FRAME_HEADER_HEIGHT + framePadding + row * (imageHeight + nodeGap) + (imageHeight - node.height) / 2 } };
    });

    const emptyFrameIds = new Set(nextNodes.filter((node) => node.type === CanvasNodeType.Frame && node.id !== frame!.id && node.metadata?.workflowTitle === "角色多视角" && !nextNodes.some((child) => child.parentId === node.id)).map((node) => node.id));
    return {
        nodes: nextNodes.filter((node) => !emptyFrameIds.has(node.id)),
        connections: nextConnections.filter((connection) => !emptyFrameIds.has(connection.fromNodeId) && !emptyFrameIds.has(connection.toNodeId)),
        frameId: frame.id,
        createdCount,
        updatedCount,
    };
}

function findFreeFramePosition(nodes: CanvasNodeData[], documentNode: CanvasNodeData, width: number, height: number) {
    const left = documentNode.position.x;
    let top = documentNode.position.y + documentNode.height + 72;
    const overlaps = (node: CanvasNodeData) => !node.parentId && left < node.position.x + node.width + 24 && left + width + 24 > node.position.x && top < node.position.y + node.height + 24 && top + height + 24 > node.position.y;
    while (nodes.some(overlaps)) top += height + 36;
    return { x: left, y: top };
}

function createReferenceNode(type: CanvasNodeType.Image | CanvasNodeType.Frame, position: Position, metadata: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    return {
        id: `${type}-${Date.now()}-${nanoid(5)}`,
        type,
        title: spec.title,
        position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    };
}
