import type { AiTextMessage } from "@/services/api/image";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import { getGenerationResourceNodes, getContextResourceNodes, getMentionResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { canvasNodeVideoPreviewUrl, canvasVideoAssetPreviewUrl } from "@/lib/canvas/canvas-media-preview";
import { isNeutralColorGrade, resolveCanvasColorGradeReference } from "@/lib/canvas/canvas-color-grade";
import { getNodeGenerationMode, getNodeResourceKind } from "@/lib/canvas/node-registry";
import { mediaConversionSourceFingerprint } from "@/lib/media-conversion/contracts";
import { audioFileExtension } from "@/lib/character-voice-formats";
import { resolveCanvasDrawingReference } from "@/lib/canvas/canvas-drawing-reference";
import { compileCharacterReferencePrompt, normalizeCharacterImageMentions } from "@/lib/canvas/canvas-character-reference";
import { createCanvasReferenceLabeler } from "@/lib/canvas/canvas-reference-slots";
import { nodeReferenceImage } from "@/lib/canvas/canvas-project-generation";
import { isCanvasWorkflowProvider } from "@/lib/canvas/canvas-workflow";
import { nodeGenerationPrompt } from "@/lib/canvas/generation-contract";
import type { ModelReferenceLimits } from "@/lib/model-selection";
import type { Asset } from "@/stores/use-asset-store";

export type CharacterGenerationReference = {
    nodeId: string;
    assetId: string;
    requestedVersionId?: string;
};

export type ResolvedCharacterVoice = {
    assetId: string;
    versionId: string;
    characterName: string;
    voiceKey: string;
    sampleResourceId?: string;
    language?: string;
    voiceAge?: string;
    timbre?: string;
    deliveryInstructions?: string;
    instructions: string;
};

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    /** 图片和角色卡主图在最终 image URL 列表中的槽位顺序。 */
    referenceImageSlots: Array<{ nodeId: string; kind: "image" | "character"; imageId?: string }>;
    characterReferences: CharacterGenerationReference[];
    resolvedCharacterVersions: Array<{ assetId: string; versionId: string }>;
    resolvedCharacterVoices: ResolvedCharacterVoice[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio" | "character";
    sourceKind?: "drawing";
    title: string;
    previewUrl?: string;
    alwaysIncludeText?: boolean;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
    character?: CharacterGenerationReference;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string, assets: Asset[], promptOnly = false): NodeGenerationContext {
    const pendingConversion = findPendingMediaConversionInput(nodeId, nodes, connections);
    if (pendingConversion) {
        const status = pendingConversion.metadata?.mediaConversion?.status;
        const reason = status === "stale" ? "输入或方式已变化" : status === "processing" ? "仍在处理中" : "尚未完成本地转换";
        throw new Error(`转换节点「${pendingConversion.title || pendingConversion.id}」${reason}，完成后才能执行下游生成`);
    }
    const connectedInputs = withArkAssetReferenceInputs(buildNodeGenerationInputs(nodeId, nodes, connections), nodes, assets);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    const portraitTextureInput = sourceNode?.type === CanvasNodeType.Image && sourceNode.metadata?.content && sourceNode.metadata?.portraitTexture
        ? (() => {
              const image = readReferenceImage(sourceNode, nodes, connections);
              return image ? [{ nodeId: sourceNode.id, type: "image" as const, title: sourceNode.title, image }] : [];
          })()
        : [];
    // 显式 @ 引用必须与提示词面板展示的资源集合一致；默认自动输入仍只取入边，
    // 避免已有图片在没有 @图片N 时被悄悄当作自身参考图。
    const mentionInputs = withArkAssetReferenceInputs(mergeGenerationInputs(buildNodeMentionGenerationInputs(nodeId, nodes, connections), portraitTextureInput, buildAssetGenerationInputs(assets)), nodes, assets);
    const storyboardInputs = getConnectedStoryboardRows(nodeId, nodes, connections);
    assertResolvableGenerationMentions(prompt, mentionInputs);
    const hasExplicitResourceMention = hasResolvableGenerationMention(prompt, mentionInputs);
    const isWorkflowSource = sourceNode?.type === CanvasNodeType.Config && isCanvasWorkflowProvider(sourceNode.metadata);
    const hasConnectedMedia = connectedInputs.some((input) => input.type === "image" || input.type === "video" || input.type === "audio" || input.type === "character");
    // 豆包音频按连线决定纯文本、参考音频或参考图片，不能因为提示词里没有逐个 @ 就丢掉已连接素材。
    const includeConnectedAudioMedia = Boolean(sourceNode && getNodeGenerationMode(sourceNode) === "audio");
    if ((promptOnly && hasConnectedMedia) || (sourceNode ? Boolean(nodeGenerationPrompt(sourceNode).trim()) && (sourceNode.type === CanvasNodeType.Config || isWorkflowSource) : false) || hasExplicitResourceMention) {
        const autoIncludeWorkflowMedia = isWorkflowSource || includeConnectedAudioMedia;
        return buildComposerGenerationContext(
            mentionInputs,
            prompt,
            // 工作流节点由字段映射接收全部连线媒体；视频节点的历史首尾帧字段不能再额外追加参考图。
            autoIncludeWorkflowMedia || (promptOnly && hasConnectedMedia) ? [] : [sourceNode?.metadata?.videoStartFrameNodeId, sourceNode?.metadata?.videoEndFrameNodeId].filter((id): id is string => Boolean(id)),
            autoIncludeWorkflowMedia || (promptOnly && hasConnectedMedia),
            connectedInputs,
        );
    }

    const isStoryboardMedia = sourceNode?.type === CanvasNodeType.Image || sourceNode?.type === CanvasNodeType.Video;
    const basePrompt = isStoryboardMedia && storyboardInputs.length ? removeTrailingInputBlocks(prompt, storyboardInputs) : prompt;
    const textInputs = connectedInputs.filter((input) => input.type === "text");
    const characterReferences = connectedInputs.map((input) => input.character).filter((item): item is CharacterGenerationReference => Boolean(item));
    const upstreamText = textInputs
        .map((input) => input.text)
        .filter(Boolean)
        .join("\n\n");
    const referenceImages = connectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = connectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = connectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));
    const referenceImageSlots = generationImageSlots(connectedInputs);

    return {
        prompt: promptOnly ? prompt : upstreamText ? `${basePrompt}\n\n${upstreamText}` : basePrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        referenceImageSlots,
        characterReferences,
        resolvedCharacterVersions: [],
        resolvedCharacterVoices: [],
        textCount: textInputs.length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

/**
 * 转换节点允许提前连到下游，但只有与当前唯一媒体输入匹配的已物化结果才能进入生成请求。
 * 沿上游链路检查也覆盖“生成节点 -> 配置节点 -> 转换节点”的接法。
 */
export function findPendingMediaConversionInput(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const sourceId = queue.shift()!;
        if (visited.has(sourceId)) continue;
        visited.add(sourceId);
        const source = nodesById.get(sourceId);
        if (!source) continue;
        if (source.type === CanvasNodeType.MediaConversion) {
            const state = source.metadata?.mediaConversion;
            const sourceInputs = connections
                .filter((connection) => connection.toNodeId === source.id)
                .map((connection) => nodesById.get(connection.fromNodeId))
                .filter((input): input is CanvasNodeData => Boolean(input && (input.type === CanvasNodeType.Image || input.type === CanvasNodeType.Video)));
            const sourceInput = sourceInputs[0];
            const ready = state?.status === "completed"
                && Boolean(state.resultStorageKey)
                && sourceInputs.length === 1
                && Boolean(sourceInput)
                && state.sourceNodeId === sourceInput?.id
                && state.sourceFingerprint === mediaConversionSourceFingerprint(sourceInput!);
            if (!ready) return source;
        }
        connections.filter((connection) => connection.toNodeId === sourceId).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

function removeTrailingInputBlocks(prompt: string, inputs: NodeGenerationInput[]) {
    let next = prompt.trim();
    let removed = true;
    while (removed) {
        removed = false;
        for (const input of inputs) {
            const block = input.text?.trim();
            if (!block || !next.endsWith(block)) continue;
            const prefix = next.slice(0, next.length - block.length);
            if (!prefix.trim() || !/\n\s*\n$/.test(prefix)) continue;
            next = prefix.trimEnd();
            removed = true;
            break;
        }
    }
    return next;
}

function buildComposerGenerationContext(
    inputs: NodeGenerationInput[],
    prompt: string,
    videoFrameNodeIds: string[] = [],
    autoIncludeWorkflowMedia = false,
    workflowMediaInputs: NodeGenerationInput[] = [],
): NodeGenerationContext {
    const normalizedPrompt = normalizeGenerationNodeMentionTokens(prompt, inputs);
    const slotInputByToken = new Map(generationSlotEntries(inputs).map(({ token, input }) => [token, input]));
    const assetInputById = new Map(inputs.filter((input) => input.nodeId.startsWith("asset:")).map((input) => [input.nodeId.slice("asset:".length), input]));
    const nodeInputById = new Map(inputs.filter((input) => !input.nodeId.startsWith("asset:")).map((input) => [input.nodeId, input]));
    const mentions = [...normalizedPrompt.matchAll(GENERATION_MENTION_PATTERN)].map((match) => ({
        match,
        input: resolveGenerationMention(normalizedPrompt, match, slotInputByToken, nodeInputById, assetInputById),
    }));
    const selectedIds = new Set(mentions.flatMap(({ input }) => input ? [input.nodeId] : []));
    if (autoIncludeWorkflowMedia) workflowMediaInputs.forEach((input) => {
        if (input.type !== "text") selectedIds.add(input.nodeId);
    });
    videoFrameNodeIds.forEach((id) => {
        if (nodeInputById.get(id)?.image) selectedIds.add(id);
    });
    // 始终先按槽位选定资源，再一次性编译提示词；提及先后不能改变 URL 顺序。
    const selected = inputs.filter((input) => selectedIds.has(input.nodeId));
    const selectedInputs = selected.filter((input) => input.type !== "text");
    const nextLabel = createCanvasReferenceLabeler();
    const providerLabels = new Map(selected.map((input) => [input.nodeId, nextLabel(input.type === "character" ? "image" : input.type)]));
    const textBlocks = selected.filter((input) => input.type === "text").map((input) => `【${providerLabels.get(input.nodeId)}】\n${input.text || ""}`);
    let lastIndex = 0;
    let nextPrompt = "";
    for (const { match, input } of mentions) {
        const index = match.index!;
        nextPrompt += normalizedPrompt.slice(lastIndex, index);
        const label = input ? providerLabels.get(input.nodeId) : undefined;
        nextPrompt += label ? input?.type === "text" ? `【${label}】` : `@${label}` : match[0];
        lastIndex = index + match[0].length;
    }
    nextPrompt += normalizedPrompt.slice(lastIndex);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));
    const characterReferences = selectedInputs.map((input) => input.character).filter((item): item is CharacterGenerationReference => Boolean(item));
    const referenceImageSlots = generationImageSlots(selectedInputs);

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        referenceImageSlots,
        characterReferences,
        resolvedCharacterVersions: [],
        resolvedCharacterVoices: [],
        textCount: textBlocks.length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

const GENERATION_MENTION_PATTERN = /@\[(node|asset):([^\]]+)\]|@(图片|视频|音频|文本|角色|绘图)(\d+)/g;

export function generationInputMentionLabel(input: NodeGenerationInput, inputs: NodeGenerationInput[]) {
    const entry = generationSlotEntries(inputs).find((item) => item.input.nodeId === input.nodeId);
    return entry?.label || generationLabel(input.sourceKind === "drawing" ? "drawing" : input.type, 0);
}

export function normalizeGenerationNodeMentionTokens(prompt: string, inputs: NodeGenerationInput[]) {
    const slots = generationSlotEntries(inputs);
    const labelByNodeId = new Map(slots.map(({ input, label }) => [input.nodeId, label]));
    const normalized = prompt.replace(/@\[node:([^\]]+)\]/g, (token, nodeId: string) => {
        const label = labelByNodeId.get(nodeId);
        return label ? `@${label}` : token;
    });
    // 仅保留无普通图片时的既有别名；混合引用不能猜测旧的独立编号。
    return normalizeCharacterImageMentions(normalized, slots.filter(({ input }) => input.type === "image").length, slots.filter(({ input }) => input.type === "character").map(({ label }) => label));
}

function hasResolvableGenerationMention(prompt: string, inputs: NodeGenerationInput[]) {
    return inspectGenerationMentions(prompt, inputs).hasResolved;
}

function assertResolvableGenerationMentions(prompt: string, inputs: NodeGenerationInput[]) {
    const { unresolved } = inspectGenerationMentions(prompt, inputs);
    if (!unresolved.length) return;
    throw new Error(`提示词中的 ${unresolved.join("、")} 没有对应的画布资源，请重新选择引用后再生成`);
}

function inspectGenerationMentions(prompt: string, inputs: NodeGenerationInput[]) {
    const normalizedPrompt = normalizeGenerationNodeMentionTokens(prompt, inputs);
    const slotInputByToken = new Map(generationSlotEntries(inputs).map(({ token, input }) => [token, input]));
    const nodeInputById = new Map(inputs.filter((input) => !input.nodeId.startsWith("asset:")).map((input) => [input.nodeId, input]));
    const assetInputById = new Map(inputs.filter((input) => input.nodeId.startsWith("asset:")).map((input) => [input.nodeId.slice("asset:".length), input]));
    const unresolved = new Set<string>();
    let hasResolved = false;
    for (const match of normalizedPrompt.matchAll(GENERATION_MENTION_PATTERN)) {
        if (match[3]) {
            const end = (match.index || 0) + match[0].length;
            if (!hasMentionBoundary(normalizedPrompt, end)) continue;
        }
        if (resolveGenerationMention(normalizedPrompt, match, slotInputByToken, nodeInputById, assetInputById)) hasResolved = true;
        else unresolved.add(match[0]);
    }
    return { hasResolved, unresolved: [...unresolved] };
}

function generationSlotEntries(inputs: NodeGenerationInput[]) {
    const nextLabel = createCanvasReferenceLabeler();
    return inputs.flatMap((input) => {
        if (input.nodeId.startsWith("asset:")) return [];
        const label = nextLabel(input.sourceKind === "drawing" ? "drawing" : input.type);
        return [{ input, label, token: `@${label}` }];
    });
}

function generationImageSlots(inputs: NodeGenerationInput[]): NodeGenerationContext["referenceImageSlots"] {
    return inputs.flatMap((input): NodeGenerationContext["referenceImageSlots"] => input.character
        ? [{ nodeId: input.nodeId, kind: "character" }]
        : input.image ? [{ nodeId: input.nodeId, kind: "image", imageId: input.image.id }] : []);
}

function resolveGenerationMention(
    prompt: string,
    match: RegExpMatchArray,
    slotInputByToken: Map<string, NodeGenerationInput>,
    nodeInputById: Map<string, NodeGenerationInput>,
    assetInputById: Map<string, NodeGenerationInput>,
) {
    if (match[3]) {
        const end = (match.index || 0) + match[0].length;
        return hasMentionBoundary(prompt, end) ? slotInputByToken.get(match[0]) : undefined;
    }
    if (match[1] === "node") return nodeInputById.get(match[2]);
    if (match[1] === "asset") return assetInputById.get(match[2]);
    return undefined;
}

function hasMentionBoundary(value: string, index: number) {
    const char = value[index];
    // 与编辑器一致：编号可紧邻中文或下一个引用，不能截断更长的数字。
    return !char || !/[0-9]/.test(char);
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return buildGenerationInputs(getGenerationResourceNodes(nodeId, nodes, connections), nodes, connections);
}

function buildNodeMentionGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return buildGenerationInputs(getMentionResourceNodes(nodeId, nodes, connections), nodes, connections);
}

function buildGenerationInputs(resourceNodes: CanvasNodeData[], nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return resourceNodes.flatMap((node): NodeGenerationInput[] => {
        const character = readCharacterReference(node);
        if (character) return [{ nodeId: node.id, type: "character" as const, title: node.title, character }];
        const image = readReferenceImage(node, nodes, connections);
        // sourceKind 只是「标签用绘图N而不是参考图N」的覆盖开关，不是来源全集。
        // 调色节点在下游就是一张普通参考图，按 image 标签即正确。
        if (image) return [{ nodeId: node.id, type: "image" as const, sourceKind: image.source?.kind === "drawing" ? "drawing" : undefined, title: node.title, image }];
        const video = readReferenceVideo(node);
        if (video) return [{ nodeId: node.id, type: "video" as const, title: node.title, previewUrl: canvasNodeVideoPreviewUrl(node), video }];
        const audio = readReferenceAudio(node);
        if (audio) return [{ nodeId: node.id, type: "audio" as const, title: node.title, audio }];
        const text = readNodeTextInput(node);
        if (text) return [{ nodeId: node.id, type: "text" as const, title: node.title, text }];
        return [];
    });
}

function mergeGenerationInputs(...groups: NodeGenerationInput[][]) {
    const seen = new Set<string>();
    return groups.flatMap((group) =>
        group.filter((input) => {
            if (seen.has(input.nodeId)) return false;
            seen.add(input.nodeId);
            return true;
        }),
    );
}

function buildAssetGenerationInputs(assets: Asset[]): NodeGenerationInput[] {
    return assets.flatMap((asset): NodeGenerationInput[] => {
        const nodeId = `asset:${asset.id}`;
        if (asset.kind === "text") return [{ nodeId, type: "text", title: asset.title, text: asset.data.content }];
        if (asset.kind === "image") return [{ nodeId, type: "image", title: asset.title, image: { id: asset.id, name: asset.title, type: asset.data.mimeType, dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, bytes: asset.data.bytes, width: asset.data.width, height: asset.data.height, ...(asset.arkAssetId ? { arkAssetId: asset.arkAssetId } : {}) } }];
        if (asset.kind === "video") return [{ nodeId, type: "video", title: asset.title, previewUrl: canvasVideoAssetPreviewUrl(asset.data.url, asset.coverUrl), video: { id: asset.id, name: asset.title, type: asset.data.mimeType, url: asset.data.url, storageKey: asset.data.storageKey, bytes: asset.data.bytes, width: asset.data.width, height: asset.data.height, durationMs: asset.data.durationMs } }];
        if (asset.kind === "audio") return [{ nodeId, type: "audio", title: asset.title, audio: { id: asset.id, name: asset.title, type: asset.data.mimeType, url: asset.data.url, storageKey: asset.data.storageKey, bytes: asset.data.bytes, durationMs: asset.data.durationMs } }];
        if (asset.kind === "entity" && asset.category === "character") return [{ nodeId, type: "character", title: asset.title, character: { nodeId, assetId: asset.id, requestedVersionId: asset.primaryVersionId } }];
        return [];
    });
}

// 图片节点绑定的素材若已录入方舟素材 ID，把 ID 附加到参考图上；是否改用 asset:// 引用
// 由 generation-task 按视频渠道决定，非方舟渠道与本地回退路径不受影响。
function withArkAssetReferenceInputs(inputs: NodeGenerationInput[], nodes: CanvasNodeData[], assets: Asset[]): NodeGenerationInput[] {
    if (!assets.length) return inputs;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    return inputs.map((input) => {
        if (input.type !== "image" || !input.image || input.image.arkAssetId) return input;
        const boundAssetId = nodeById.get(input.nodeId)?.metadata?.assetId;
        const arkAssetId = boundAssetId ? assetById.get(boundAssetId)?.arkAssetId : undefined;
        return arkAssetId ? { ...input, image: { ...input.image, arkAssetId } } : input;
    });
}

function getConnectedStoryboardRows(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    const targetNodeIds = new Set([nodeId]);
    connections.forEach((connection) => {
        if (connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config) {
            targetNodeIds.add(connection.toNodeId);
        }
    });
    const seen = new Set<string>();
    return connections.flatMap((connection): NodeGenerationInput[] => {
        if (!targetNodeIds.has(connection.toNodeId) || !connection.fromHandleId?.startsWith("row:")) return [];
        const scriptNode = nodes.find((node) => node.id === connection.fromNodeId && node.type === CanvasNodeType.Script);
        const row = scriptNode?.metadata?.storyboard?.rows.find((item) => `row:${item.id}` === connection.fromHandleId);
        if (!scriptNode || !row) return [];
        const inputId = `${scriptNode.id}:${connection.fromHandleId}`;
        if (seen.has(inputId)) return [];
        seen.add(inputId);
        const characters = (row.characters || []).map((character) => [character.characterName, character.characterDescription].filter(Boolean).join("：")).filter(Boolean).join("、");
        const text = [
            `【分镜 ${row.shotNumber}】`,
            `时长：${row.durationSeconds} 秒`,
            row.plotDescription && `画面描述：${row.plotDescription}`,
            row.dialogue && `台词/旁白：${row.dialogue}`,
            characters && `角色：${characters}`,
            row.shotSize && `景别：${row.shotSize}`,
            row.emotion && `情绪：${row.emotion}`,
            row.lightingAndAtmosphere && `光影氛围：${row.lightingAndAtmosphere}`,
            row.audioEffects && `音效：${row.audioEffects}`,
            row.camera && `镜头设计：${row.camera}`,
            row.motion && `运镜：${row.motion}`,
            row.timeBeats && `时间节拍：${row.timeBeats}`,
            row.imageGenerationPrompt && `图片提示词：${row.imageGenerationPrompt}`,
            row.videoMotionPrompt && `视频提示词：${row.videoMotionPrompt}`,
            row.negativePrompt && `负面要求：${row.negativePrompt}`,
        ].filter(Boolean).join("\n");
        return [{ nodeId: inputId, type: "text", title: `${scriptNode.title} · 镜头 ${row.shotNumber}`, text, alwaysIncludeText: true }];
    });
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext, projectId: string, domainProjectId?: string, mode?: CanvasGenerationMode, includeCharacterVoiceSamples = false, includeCharacterPrompt = true, referenceLimits?: ModelReferenceLimits) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    let referenceImages = await Promise.all(
        context.referenceImages.map(async (image) => {
            if (image.source?.kind === "drawing") return resolveCanvasDrawingReference(projectId, image);
            if (image.source?.kind === "colorgrade") return resolveCanvasColorGradeReference(image);
            return { ...image, dataUrl: await imageToDataUrl(image) };
        }),
    );
    if (!context.characterReferences.length) return { ...context, referenceImages };
    const { getCharacter } = await import("@/services/api/projects");
    const { getResource, resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey } = await import("@/services/api/resources");
    const details = await Promise.all(context.characterReferences.map((reference) => getCharacter(reference.assetId)));
    const remainingBudget = Math.max(0, (referenceLimits?.maxImages ?? 9) - referenceImages.length);
    const selectedEntries = details.flatMap((detail, index) => {
        const reference = context.characterReferences[index];
        if (reference.requestedVersionId && reference.requestedVersionId !== detail.character.versionId) throw new Error(`角色「${detail.asset.title}」的固定版本已变化，请重新选择角色后生成`);
        const representation = preferredCharacterRepresentation(detail.character.representations);
        if (!representation && mode !== "audio" && mode !== "text") throw new Error(`角色「${detail.asset.title}」缺少可用的主参考图，请补充形象后再生成`);
        return representation ? [{ nodeId: reference.nodeId, representation }] : [];
    });
    if (selectedEntries.length > remainingBudget) throw new Error(`当前模型参考图容量不足：角色至少需要 ${selectedEntries.length} 张主参考图`);
    const usedResourceIds = new Set(selectedEntries.map((item) => item.representation.resourceId));
    const supplementEntries = details.flatMap((detail, index) => {
        const reference = context.characterReferences[index];
        if (!reference) return [];
        return detail.character.representations.flatMap((representation) => {
            if (!["front", "side", "back", "turnaround_sheet"].includes(representation.role) || !representation.resourceId || usedResourceIds.has(representation.resourceId)) return [];
            usedResourceIds.add(representation.resourceId);
            return [{ nodeId: reference.nodeId, representation }];
        });
    });
    const imageEntries = [...selectedEntries, ...supplementEntries].slice(0, Math.max(0, remainingBudget));
    const characterImages = imageEntries.map((entry, index) => ({
        id: `character-reference-${index + 1}`,
        name: `character-reference-${index + 1}.png`,
        type: "image/png",
        dataUrl: "",
        storageKey: resourceStorageKey(entry.representation.resourceId),
    } satisfies ReferenceImage));
    const hydratedCharacterImages = await Promise.all(characterImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) })));
    const primaryByNodeId = new Map<string, ReferenceImage>();
    selectedEntries.forEach((entry, index) => {
        const image = hydratedCharacterImages[index];
        if (image) primaryByNodeId.set(entry.nodeId, image);
    });
    const regularById = new Map(referenceImages.map((image) => [image.id, image]));
    const orderedIndexByNodeId = new Map<string, number>();
    const providerMentionBySlot = new Map<string, string>();
    const orderedImages: ReferenceImage[] = [];
    context.referenceImageSlots.forEach((slot, index) => {
        const image = slot.kind === "character" ? primaryByNodeId.get(slot.nodeId) : regularById.get(slot.imageId || slot.nodeId);
        if (!image) {
            const characterIndex = context.characterReferences.findIndex((reference) => reference.nodeId === slot.nodeId);
            const detail = details[characterIndex];
            if (slot.kind !== "character" || !detail || (mode !== "text" && mode !== "audio")) throw new Error("参考图片槽位无法解析，请重新选择引用后生成");
            providerMentionBySlot.set(`@图片${index + 1}`, detail.asset.title.replaceAll("@", "＠"));
            return;
        }
        orderedImages.push(image);
        orderedIndexByNodeId.set(slot.nodeId, orderedImages.length);
        providerMentionBySlot.set(`@图片${index + 1}`, `@图片${orderedImages.length}`);
    });
    const compiledPrompt = context.prompt.replace(/@图片[1-9]\d*/g, (token, offset: number) => hasMentionBoundary(context.prompt, offset + token.length) ? providerMentionBySlot.get(token) || token : token);
    const supplementLabelsByNodeId = new Map<string, string[]>();
    supplementEntries.slice(0, Math.max(0, remainingBudget - selectedEntries.length)).forEach((entry, index) => {
        const label = imageReferenceLabel(orderedImages.length + index);
        supplementLabelsByNodeId.set(entry.nodeId, [...(supplementLabelsByNodeId.get(entry.nodeId) || []), `@${label}`]);
    });
    const supplementImages = hydratedCharacterImages.slice(selectedEntries.length);
    referenceImages = [...orderedImages, ...supplementImages];
    const characterBlocks = details.map((detail, index) => {
        const nodeId = context.characterReferences[index]?.nodeId;
        const primaryLabel = nodeId ? orderedIndexByNodeId.get(nodeId) : undefined;
        const supplementLabels = nodeId ? supplementLabelsByNodeId.get(nodeId) || [] : [];
        const referenceLine = primaryLabel ? `参考图片：@${imageReferenceLabel(primaryLabel - 1)}${supplementLabels.length ? `；补充视角：${supplementLabels.join("、")}` : ""}` : "";
        const heading = includeCharacterPrompt ? compileCharacterReferencePrompt(detail.asset.title, detail.character.definition) : `【角色卡：${detail.asset.title}】`;
        return [heading, referenceLine].filter(Boolean).join("\n");
    });
    const resolvedCharacterVersions = details.map((detail) => ({ assetId: detail.asset.id, versionId: detail.character.versionId }));
    const resolvedCharacterVoices = details.flatMap((detail): ResolvedCharacterVoice[] => {
        const voice = detail.character.voice;
        if (!voice) return [];
        const language = stringField(detail.character.definition.voiceLanguage) || stringField(voice.profile.language);
        const voiceAge = stringField(detail.character.definition.voiceAge);
        const timbre = stringField(detail.character.definition.voiceTimbre) || stringField(voice.profile.timbre);
        const deliveryInstructions = stringField(voice.instructions);
        const sampleResourceId = stringField(voice.profile.sampleResourceId);
        return [{
            assetId: detail.asset.id,
            versionId: detail.character.versionId,
            characterName: detail.asset.title,
            voiceKey: stringField(voice.profile.voiceKey),
            sampleResourceId: sampleResourceId || undefined,
            language: language || undefined,
            voiceAge: voiceAge || undefined,
            timbre: timbre || undefined,
            deliveryInstructions: deliveryInstructions || undefined,
            instructions: [language && `语言与口音：${language}`, voiceAge && `声音年龄感：${voiceAge}`, timbre && `音色气质：${timbre}`, deliveryInstructions].filter(Boolean).join("；"),
        }];
    });
    const usedAudioResourceIds = new Set(context.referenceAudios.map((audio) => resourceIdFromStorageKey(audio.storageKey)).filter(Boolean));
    const voiceSamples: ResolvedCharacterVoice[] = [];
    // 视频模型接收声音样本；独立配音任务仍通过 voiceKey 选音色，不能把两种协议混用。
    if (mode === "video" && includeCharacterVoiceSamples) {
        resolvedCharacterVoices.forEach((voice) => {
            if (!voice.sampleResourceId || usedAudioResourceIds.has(voice.sampleResourceId)) return;
            usedAudioResourceIds.add(voice.sampleResourceId);
            voiceSamples.push(voice);
        });
    }
    const maxAudios = referenceLimits?.maxAudios ?? 3;
    if (context.referenceAudios.length + voiceSamples.length > maxAudios) throw new Error(`当前模型参考音频容量不足：已连接 ${context.referenceAudios.length} 个音频，角色声音样本还需要 ${voiceSamples.length} 个名额`);
    const characterVoiceAudios = await Promise.all(voiceSamples.map(async (voice) => {
        const resource = await getResource(voice.sampleResourceId!);
        const extension = audioFileExtension(resource.mimeType, resource.objectKey);
        return {
            id: `character-voice-${voice.assetId}`,
            name: `${voice.characterName}-声音样本.${extension}`,
            type: resource.mimeType || "audio/mpeg",
            url: resourceFileUrl(voice.sampleResourceId!),
            storageKey: resourceStorageKey(voice.sampleResourceId!),
        } satisfies ReferenceAudio;
    }));
    const referenceAudios = [...context.referenceAudios, ...characterVoiceAudios];
    const voiceBlocks = mode === "video" ? resolvedCharacterVoices.flatMap((voice) => {
        const sampleIndex = voice.sampleResourceId ? referenceAudios.findIndex((audio) => resourceIdFromStorageKey(audio.storageKey) === voice.sampleResourceId) : -1;
        if (sampleIndex < 0 && !includeCharacterPrompt) return [];
        return [[
            includeCharacterPrompt ? compileResolvedVoicePrompt(voice) : `【角色声音：${voice.characterName}】`,
            sampleIndex >= 0 ? `声音参考：@音频${sampleIndex + 1}` : "",
        ].filter(Boolean).join("\n")];
    }) : [];
    return {
        ...context,
        prompt: [compiledPrompt.trim(), ...characterBlocks, ...voiceBlocks].filter(Boolean).join("\n\n"),
        referenceImages,
        referenceAudios,
        resolvedCharacterVersions,
        resolvedCharacterVoices,
        imageCount: referenceImages.length,
        audioCount: referenceAudios.length,
    };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    if (node.type === CanvasNodeType.Skill) return readSkillInput(node);
    return nodeGenerationPrompt(node);
}

function readCharacterReference(node: CanvasNodeData): CharacterGenerationReference | null {
    const assetId = node.metadata?.workflowKind === "character" ? node.metadata.characterAssetId?.trim() : "";
    return assetId ? { nodeId: node.id, assetId, requestedVersionId: node.metadata?.characterVersionPolicy === "pinned" ? node.metadata.characterVersionId : undefined } : null;
}

function preferredCharacterRepresentation(representations: Array<{ id: string; resourceId: string; role: string }>) {
    return ["turnaround_sheet", "primary", "front", "side", "back"].map((role) => representations.find((item) => item.role === role && item.resourceId.trim())).find(Boolean);
}

function compileResolvedVoicePrompt(voice: ResolvedCharacterVoice) {
    return [
        `【角色声音：${voice.characterName}】`,
        voice.language && `语言与口音：${voice.language}`,
        voice.voiceAge && `声音年龄感：${voice.voiceAge}`,
        voice.timbre && `音色气质：${voice.timbre}`,
        voice.deliveryInstructions && `表演与朗读要求：${voice.deliveryInstructions}`,
    ].filter(Boolean).join("\n");
}

function stringField(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function readSkillInput(node: CanvasNodeData) {
    const skill = node.metadata?.skillSnapshot;
    if (!skill) return node.metadata?.content || "";
    return [
        `【技能：${skill.name}】`,
        skill.description ? `用途：${skill.description}` : "",
        `执行模板：\n${skill.template}`,
        skill.outputContract ? `输出约束：\n${skill.outputContract}` : "",
        "请严格执行该技能，只输出结果，不要输出解释性套话。",
    ]
        .filter(Boolean)
        .join("\n\n");
}

function generationLabel(type: NodeGenerationInput["type"] | "drawing", index: number) {
    if (type === "character") return `角色${index + 1}`;
    if (type === "drawing") return `绘图${index + 1}`;
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return seedanceReferenceLabel("video", index);
    if (type === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function readReferenceImage(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]): ReferenceImage | null {
    if (node.type === CanvasNodeType.Drawing && node.metadata?.drawingId) {
        return {
            id: node.id,
            name: node.title || `绘图-${node.id}`,
            type: "image/png",
            dataUrl: "",
            source: {
                kind: "drawing",
                drawingId: node.metadata.drawingId,
                revision: node.metadata.drawingRevision || 0,
                shapeCount: node.metadata.drawingShapeCount || 0,
            },
        };
    }
    if (node.type === CanvasNodeType.ColorGrade) {
        // 调色节点自己不存图：源图在上游，参数在 metadata。没连线就跳过这条输入，
        // 而不是抛错——画布上放一个还没连线的调色节点是很正常的中间状态。
        // 判据与节点渲染保持一致（都要求上游是带 content 的图片），
        // 否则会出现「预览里看到了、生成时却没用上」这类不报错的偏差。
        const source = getContextResourceNodes(node.id, nodes, connections).find((item) => getNodeResourceKind(item) === "image" && item.metadata?.content);
        const url = source?.metadata?.content;
        if (!source || !url) return null;

        const grade = node.metadata?.colorGrade;
        // 未调色时直接透传源图，省掉一次渲染与上传（也就不占文件容量）。
        if (!grade || isNeutralColorGrade(grade)) {
            const passthrough = nodeReferenceImage(source);
            return passthrough ? { ...passthrough, id: node.id, name: node.title || `调色-${node.id}` } : null;
        }
        return {
            id: node.id,
            name: node.title || `调色-${node.id}`,
            type: "image/png",
            dataUrl: "",
            source: { kind: "colorgrade", url, grade },
        };
    }
    return nodeReferenceImage(node);
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || (!node.metadata?.content && !node.metadata?.storageKey)) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content || "",
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || (!node.metadata?.content && !node.metadata?.storageKey)) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content || "",
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        durationMs: node.metadata.durationMs,
    };
}
