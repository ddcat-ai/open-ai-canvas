import { buildNodeGenerationContext, buildNodeGenerationInputs, type NodeGenerationContext, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type {
    CanvasConnection,
    CanvasGenerationMode,
    CanvasGenerationPath,
    CanvasNodeData,
    CanvasReferenceRole,
    GenerationSubmissionMention,
    GenerationSubmissionReference,
    GenerationSubmissionSnapshot,
} from "@/types/canvas";
import { CanvasNodeType } from "@/types/canvas";

const ROLE_LABEL: Record<CanvasReferenceRole, string> = {
    auto: "自动",
    prompt_text: "并入提示词",
    style_ref: "风格参考",
    subject_ref: "主体参考",
    first_frame: "首帧",
    last_frame: "尾帧",
    motion_ref: "动作参考",
    audio_ref: "音频参考",
    character_ref: "角色参考",
};

export function canvasReferenceRoleLabel(role: CanvasReferenceRole = "auto") {
    return ROLE_LABEL[role] || ROLE_LABEL.auto;
}

export function canvasGenerationPathLabel(path: CanvasGenerationPath) {
    switch (path) {
        case "t2i":
            return "文生图";
        case "i2i":
            return "图生图";
        case "t2v":
            return "文生视频";
        case "i2v":
            return "图生视频";
        case "edit-mask":
            return "蒙版编辑";
        case "text":
            return "文本生成";
        case "audio":
            return "音频生成";
        default:
            return "生成";
    }
}

export function resolveConnectionRole(connection: CanvasConnection, fromNode?: CanvasNodeData, toNode?: CanvasNodeData): CanvasReferenceRole {
    if (connection.role && connection.role !== "auto") return connection.role;
    if (toNode?.metadata?.videoStartFrameNodeId && connection.fromNodeId === toNode.metadata.videoStartFrameNodeId) return "first_frame";
    if (toNode?.metadata?.videoEndFrameNodeId && connection.fromNodeId === toNode.metadata.videoEndFrameNodeId) return "last_frame";
    if (fromNode?.type === CanvasNodeType.Video && toNode?.type === CanvasNodeType.Video) return "motion_ref";
    if (fromNode?.type === CanvasNodeType.Audio) return "audio_ref";
    if (fromNode?.metadata?.workflowKind === "character" || fromNode?.metadata?.characterAssetId) return "character_ref";
    if (fromNode?.type === CanvasNodeType.Text || fromNode?.type === CanvasNodeType.Script) return "prompt_text";
    if (fromNode?.type === CanvasNodeType.Image || fromNode?.type === CanvasNodeType.Drawing) return "subject_ref";
    return "auto";
}

export function detectGenerationPath(mode: CanvasGenerationMode, context: Pick<NodeGenerationContext, "referenceImages" | "referenceVideos" | "referenceAudios">, hasMask = false): CanvasGenerationPath {
    if (mode === "text") return "text";
    if (mode === "audio") return "audio";
    if (mode === "image") {
        if (hasMask) return "edit-mask";
        return context.referenceImages.length ? "i2i" : "t2i";
    }
    if (mode === "video") {
        return context.referenceImages.length || context.referenceVideos.length ? "i2v" : "t2v";
    }
    return "unknown";
}

export function buildGenerationSubmissionSnapshot(options: {
    nodeId: string;
    mode: CanvasGenerationMode;
    userPrompt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    /** 用户明确排除的参考 nodeId */
    excludedReferenceNodeIds?: string[];
    /** 展开 skill 后的 prompt；缺省等于 userPrompt */
    effectivePrompt?: string;
    model?: string;
    interfaceType?: string;
    size?: string;
    seconds?: string;
    vquality?: string;
    hasMask?: boolean;
}): GenerationSubmissionSnapshot {
    const sourceNode = options.nodes.find((node) => node.id === options.nodeId);
    const excluded = new Set(options.excludedReferenceNodeIds || sourceNode?.metadata?.excludedReferenceNodeIds || []);
    const rawContext = buildNodeGenerationContext(options.nodeId, options.nodes, options.connections, options.userPrompt);
    const inputs = buildNodeGenerationInputs(options.nodeId, options.nodes, options.connections);
    const incoming = options.connections.filter((connection) => connection.toNodeId === options.nodeId);
    const roleByNodeId = new Map<string, CanvasReferenceRole>();
    incoming.forEach((connection) => {
        const from = options.nodes.find((node) => node.id === connection.fromNodeId);
        roleByNodeId.set(connection.fromNodeId, resolveConnectionRole(connection, from, sourceNode));
    });
    if (sourceNode?.metadata?.videoStartFrameNodeId) roleByNodeId.set(sourceNode.metadata.videoStartFrameNodeId, "first_frame");
    if (sourceNode?.metadata?.videoEndFrameNodeId) roleByNodeId.set(sourceNode.metadata.videoEndFrameNodeId, "last_frame");

    const mentionTokens = Array.from(options.userPrompt.matchAll(/@\[(node|skill):([^\]]+)\]/g)).map((match) => ({
        kind: match[1] as "node" | "skill",
        id: match[2],
        token: match[0],
    }));
    const mentionedNodeIds = new Set(mentionTokens.filter((item) => item.kind === "node").map((item) => item.id));
    const hasExplicitMention = mentionTokens.length > 0;
    const usesComposer = sourceNode?.type === CanvasNodeType.Config || Boolean(sourceNode?.metadata?.composerContent?.trim()) || hasExplicitMention;

    const references: GenerationSubmissionReference[] = [];
    const pushReference = (item: GenerationSubmissionReference) => {
        const key = item.nodeId || item.id;
        if (references.some((existing) => (existing.nodeId || existing.id) === key && existing.kind === item.kind)) return;
        references.push(item);
    };

    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));

    // 入边 / 生成输入
    inputs.forEach((input) => {
        const role = roleByNodeId.get(input.nodeId) || defaultRoleForInput(input);
        const mentioned = mentionedNodeIds.has(input.nodeId);
        const frameForced = role === "first_frame" || role === "last_frame";
        const autoInclude = usesComposer ? mentioned || frameForced || Boolean(input.alwaysIncludeText) : true;
        const included = autoInclude && !excluded.has(input.nodeId);
        const fromNode = options.nodes.find((node) => node.id === (input.nodeId.includes(":") ? input.nodeId.split(":")[0] : input.nodeId));
        const characterPreview = input.type === "character"
            ? (fromNode?.metadata?.characterCoverUrl || undefined)
            : undefined;
        pushReference({
            id: input.nodeId,
            nodeId: input.nodeId.includes(":") ? input.nodeId.split(":")[0] : input.nodeId,
            label: input.title || input.nodeId,
            title: input.title,
            kind: input.type === "character" ? "character" : input.type,
            role,
            included,
            source: frameForced ? "frame" : mentioned ? "mention" : input.alwaysIncludeText ? "storyboard" : "connection",
            reason: !autoInclude
                ? "当前为显式 @ 模式：未 @ 且非首尾帧，默认不发送"
                : excluded.has(input.nodeId)
                  ? "已在发送清单中取消"
                  : frameForced
                    ? "视频结构化首尾帧"
                    : mentioned
                      ? "提示词中已 @"
                      : input.type === "character"
                        ? "角色卡入边（将解析三视图参考图）"
                      : "入边自动带入",
            previewUrl: input.image?.dataUrl || input.image?.url || input.video?.url || characterPreview,
            storageKey: input.image?.storageKey || input.video?.storageKey || input.audio?.storageKey,
        });
    });

    // 仅被 @ 但未进入 inputs 的 token（例如失效引用）
    mentionTokens.forEach((token) => {
        if (token.kind === "skill") {
            pushReference({
                id: `skill:${token.id}`,
                label: token.id,
                kind: "skill",
                role: "auto",
                included: !excluded.has(`skill:${token.id}`),
                source: "mention",
                reason: "提示词 skill 引用",
            });
            return;
        }
        if (inputByNodeId.has(token.id)) return;
        pushReference({
            id: token.id,
            nodeId: token.id,
            label: token.id,
            kind: "text",
            role: "auto",
            included: false,
            source: "mention",
            reason: "已 @ 但未解析到可用媒体/文本节点",
        });
    });

    const includedImageCount = references.filter((item) => item.included && (item.kind === "image" || item.kind === "character")).length;
    const includedVideoCount = references.filter((item) => item.included && item.kind === "video").length;
    const pathContext = {
        referenceImages: includedImageCount ? rawContext.referenceImages.slice(0, includedImageCount) : [],
        referenceVideos: includedVideoCount ? rawContext.referenceVideos.slice(0, includedVideoCount) : [],
        referenceAudios: rawContext.referenceAudios,
    };
    // 按 included 过滤 context 用于路径判断
    const filteredContext: NodeGenerationContext = {
        ...rawContext,
        referenceImages: rawContext.referenceImages.filter((image) => {
            const ref = references.find((item) => item.nodeId === image.id || item.id === image.id);
            return ref ? ref.included : true;
        }),
        referenceVideos: rawContext.referenceVideos.filter((video) => {
            const ref = references.find((item) => item.nodeId === video.id || item.id === video.id);
            return ref ? ref.included : true;
        }),
        referenceAudios: rawContext.referenceAudios.filter((audio) => {
            const ref = references.find((item) => item.nodeId === audio.id || item.id === audio.id);
            return ref ? ref.included : true;
        }),
    };
    const path = detectGenerationPath(options.mode, filteredContext, options.hasMask);
    const warnings: string[] = [];
    if (options.mode === "image" && path === "t2i") warnings.push("当前无参考图，将走文生图接口 /images/generations");
    if (options.mode === "image" && path === "i2i") warnings.push("检测到参考图，将走图生图/编辑接口 /images/edits");
    if (usesComposer && !hasExplicitMention && !references.some((item) => item.included && item.kind !== "text")) {
        warnings.push("显式 @ 模式下未引用任何媒体；若需要参考图请 @ 或设置首尾帧");
    }
    if (!options.userPrompt.trim() && (options.mode === "text" || options.mode === "audio")) {
        warnings.push("提示词为空");
    }
    if (mentionTokens.length === 0 && inputs.some((input) => input.type === "image" || input.type === "video")) {
        warnings.push("有可引用的图/视频节点，但提示词中尚未使用 @；可在发送清单确认是否自动带上");
    }
    if (inputs.length === 0 && mentionTokens.length === 0) {
        warnings.push("当前没有可 @ 的上游节点。连接图片/视频/角色节点，或从素材库添加后会出现在引用列表");
    }

    const mentions: GenerationSubmissionMention[] = mentionTokens.map((token) => ({
        token: token.token,
        nodeId: token.kind === "node" ? token.id : undefined,
        skillId: token.kind === "skill" ? token.id : undefined,
        included: token.kind === "skill" ? !excluded.has(`skill:${token.id}`) : !excluded.has(token.id),
        label: token.kind === "node" ? inputByNodeId.get(token.id)?.title || token.id : token.id,
    }));

    // 应用 excluded 后的 effective prompt：仍用 rawContext.prompt（skill 展开在外层处理）
    const effectivePrompt = options.effectivePrompt ?? rawContext.prompt;

    return {
        path,
        pathLabel: canvasGenerationPathLabel(path),
        mode: options.mode,
        userPrompt: options.userPrompt,
        effectivePrompt,
        mentions,
        references,
        model: options.model,
        interfaceType: options.interfaceType,
        size: options.size,
        seconds: options.seconds,
        vquality: options.vquality,
        warnings,
        createdAt: new Date().toISOString(),
    };
}

export function applySubmissionExclusions(
    context: NodeGenerationContext,
    snapshot: GenerationSubmissionSnapshot,
): NodeGenerationContext {
    const excludedIds = new Set(snapshot.references.filter((item) => !item.included).map((item) => item.nodeId || item.id));
    if (!excludedIds.size) return context;
    return {
        ...context,
        referenceImages: context.referenceImages.filter((image) => !excludedIds.has(image.id)),
        referenceVideos: context.referenceVideos.filter((video) => !excludedIds.has(video.id)),
        referenceAudios: context.referenceAudios.filter((audio) => !excludedIds.has(audio.id)),
        characterReferences: context.characterReferences.filter((item) => !excludedIds.has(item.nodeId)),
        imageCount: context.referenceImages.filter((image) => !excludedIds.has(image.id)).length,
        videoCount: context.referenceVideos.filter((video) => !excludedIds.has(video.id)).length,
        audioCount: context.referenceAudios.filter((audio) => !excludedIds.has(audio.id)).length,
    };
}

function defaultRoleForInput(input: NodeGenerationInput): CanvasReferenceRole {
    if (input.type === "character") return "character_ref";
    if (input.type === "video") return "motion_ref";
    if (input.type === "audio") return "audio_ref";
    if (input.type === "text") return "prompt_text";
    if (input.type === "image") return "subject_ref";
    return "auto";
}
