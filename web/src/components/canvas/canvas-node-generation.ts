import type { AiTextMessage } from "@/services/api/image";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import { getGenerationResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { resolveCanvasDrawingReference } from "@/lib/canvas/canvas-drawing-reference";
import { compileCharacterReferencePrompt } from "@/lib/canvas/canvas-character-reference";
import { nodeReferenceImage } from "@/lib/canvas/canvas-project-generation";

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
    alwaysIncludeText?: boolean;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
    character?: CharacterGenerationReference;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    const storyboardInputs = getConnectedStoryboardRows(nodeId, nodes, connections);
    const hasExplicitNodeMention = /@\[node:[^\]]+\]/.test(normalizeLegacyNodeMentions(prompt, inputs));
    // 仅 Config 的 composer / 显式 @ 进入「只收集被 @ 的」路径。
    // 视频/图片节点 prompt 里写 @[node:…] 只是标注参考，入边角色/画风/章节仍应全部带上。
    const useComposerPath = sourceNode?.type === CanvasNodeType.Config
        && (Boolean(sourceNode.metadata?.composerContent?.trim()) || hasExplicitNodeMention);
    if (useComposerPath) {
        return buildComposerGenerationContext(inputs, prompt, [sourceNode?.metadata?.videoStartFrameNodeId, sourceNode?.metadata?.videoEndFrameNodeId].filter((id): id is string => Boolean(id)));
    }

    const isStoryboardMedia = sourceNode?.type === CanvasNodeType.Image || sourceNode?.type === CanvasNodeType.Video;
    // 节点 metadata.prompt 可能已是上一轮展开后的最终稿；先剥掉末尾已拼接的分镜/参考块，避免重试再叠一层。
    const strippedPrompt = removeContainedInputBlocks(prompt, inputs);
    const basePrompt = isStoryboardMedia && storyboardInputs.length ? removeContainedInputBlocks(strippedPrompt, storyboardInputs) : strippedPrompt;
    const textInputs = inputs.filter((input) => input.type === "text");
    const characterReferences = inputs.map((input) => input.character).filter((item): item is CharacterGenerationReference => Boolean(item));
    // 画风/章节等文本参考：仅追加 basePrompt 里还没有的正文，防止「连线展开 + 节点已 bake」双写。
    const upstreamText = textInputs
        .map((input) => input.text?.trim() || "")
        .filter((text) => text && !containsTextBlock(basePrompt, text))
        .join("\n\n");
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? `${basePrompt}\n\n${upstreamText}` : basePrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        characterReferences,
        resolvedCharacterVersions: [],
        resolvedCharacterVoices: [],
        textCount: textInputs.length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function normalizePromptBlock(value: string) {
    return value.replace(/\s+/g, " ").trim();
}

function containsTextBlock(prompt: string, block: string) {
    const needle = normalizePromptBlock(block);
    if (!needle) return false;
    const haystack = normalizePromptBlock(prompt);
    if (haystack.includes(needle)) return true;
    // 角色卡常见形态：【角色卡：名】… 或 【角色参考：名】\n【角色卡：名】…
    const characterTitle = block.match(/【角色卡：([^\]]+)】/)?.[1]?.trim();
    if (characterTitle && haystack.includes(normalizePromptBlock(`【角色卡：${characterTitle}】`))) {
        const body = normalizePromptBlock(block.replace(/【角色卡：[^\]]+】/g, ""));
        if (!body || haystack.includes(body.slice(0, Math.min(body.length, 120)))) return true;
    }
    return false;
}

function removeContainedInputBlocks(prompt: string, inputs: NodeGenerationInput[]) {
    let next = prompt.trim();
    let removed = true;
    while (removed) {
        removed = false;
        for (const input of inputs) {
            const block = input.text?.trim();
            if (!block) continue;
            // 1) 旧逻辑：块贴在末尾
            if (next.endsWith(block)) {
                const prefix = next.slice(0, next.length - block.length);
                if (prefix.trim() && /\n\s*\n$/.test(prefix)) {
                    next = prefix.trimEnd();
                    removed = true;
                    break;
                }
            }
            // 2) 块出现在正文中（含「项目/设定参考」预写、重试叠层）：整段删掉
            const indexed = next.indexOf(block);
            if (indexed >= 0) {
                const before = next.slice(0, indexed).replace(/\n{3,}/g, "\n\n").trimEnd();
                const after = next.slice(indexed + block.length).replace(/^\s*\n+/, "").trimStart();
                const merged = [before, after].filter(Boolean).join("\n\n").trim();
                if (merged !== next) {
                    next = merged;
                    removed = true;
                    break;
                }
            }
        }
    }
    // 清掉动作板遗留的空「项目/设定参考：」标题
    next = next.replace(/(?:^|\n)项目\/设定参考：\s*(?=\n|$)/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return next;
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string, videoFrameNodeIds: string[] = []): NodeGenerationContext {
    const normalizedPrompt = normalizeLegacyNodeMentions(prompt, inputs);
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const selectedInputs: NodeGenerationInput[] = [];
    const labelByNodeId = new Map<string, string>();
    const textBlocks: string[] = [];
    const counts = { image: 0, drawing: 0, video: 0, audio: 0, text: 0, character: 0 };
    let hasToken = false;
    let lastIndex = 0;
    let nextPrompt = "";

    for (const match of normalizedPrompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        hasToken = true;
        nextPrompt += normalizedPrompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input) {
            let label = labelByNodeId.get(input.nodeId);
            if (!label) {
                const labelKind = input.sourceKind === "drawing" ? "drawing" : input.type;
                label = generationLabel(labelKind, counts[labelKind]++);
                labelByNodeId.set(input.nodeId, label);
                if (input.type === "text") textBlocks.push(`【${label}】\n${input.text || ""}`);
                else selectedInputs.push(input);
            }
            nextPrompt += input.type === "text" ? `【${label}】` : label;
        } else nextPrompt += match[0];
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += normalizedPrompt.slice(lastIndex);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    // 首尾帧是结构化生成参数，不受提示词中的 @ 引用筛选影响。
    const selectedNodeIds = new Set(selectedInputs.map((input) => input.nodeId));
    videoFrameNodeIds.forEach((nodeId) => {
        const input = inputByNodeId.get(nodeId);
        if (!input?.image || selectedNodeIds.has(nodeId)) return;
        selectedInputs.push(input);
        selectedNodeIds.add(nodeId);
    });
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));
    const characterReferences = selectedInputs.map((input) => input.character).filter((item): item is CharacterGenerationReference => Boolean(item));

    if (!hasToken && !textBlocks.length && !selectedInputs.length) {
        return {
            prompt,
            referenceImages: [],
            referenceVideos: [],
            referenceAudios: [],
            characterReferences: [],
            resolvedCharacterVersions: [],
            resolvedCharacterVoices: [],
            textCount: 0,
            imageCount: 0,
            videoCount: 0,
            audioCount: 0,
        };
    }

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        characterReferences,
        resolvedCharacterVersions: [],
        resolvedCharacterVoices: [],
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

// 旧画布保存的是 @角色1 等显示标签；生成时升级为稳定节点 Token，避免标题或排序变化后引用错位。
function normalizeLegacyNodeMentions(prompt: string, inputs: NodeGenerationInput[]) {
    const counts = { image: 0, drawing: 0, video: 0, audio: 0, text: 0, character: 0 };
    const labels = inputs.map((input) => {
        const kind = input.sourceKind === "drawing" ? "drawing" : input.type;
        return { label: generationLabel(kind, counts[kind]++), nodeId: input.nodeId };
    }).sort((a, b) => b.label.length - a.label.length);
    let next = prompt;
    labels.forEach(({ label, nodeId }) => {
        const token = `@${label}`;
        let cursor = 0;
        let result = "";
        while (cursor < next.length) {
            const found = next.indexOf(token, cursor);
            if (found < 0) {
                result += next.slice(cursor);
                break;
            }
            const end = found + token.length;
            result += next.slice(cursor, found);
            result += hasMentionBoundary(next, end) ? `@[node:${nodeId}]` : token;
            cursor = end;
        }
        next = result;
    });
    return next;
}

function hasMentionBoundary(value: string, index: number) {
    const char = value[index];
    return !char || /\s|[,.!?;:，。！？；：、)\]}】）]/.test(char);
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    const resourceNodes = getGenerationResourceNodes(nodeId, nodes, connections);
    return resourceNodes.flatMap((node): NodeGenerationInput[] => {
        const character = readCharacterReference(node);
        if (character) {
            // 角色卡本身不是 Image 节点：先带上封面/三视图封面，预览与未 hydrate 前也能当参考图；
            // hydrate 阶段再补齐多视角。
            const cover = readCharacterCoverImage(node);
            return [
                { nodeId: node.id, type: "character" as const, title: node.title, character },
                ...(cover ? [{ nodeId: node.id, type: "image" as const, title: node.title || "角色参考图", image: cover }] : []),
            ];
        }
        const image = readReferenceImage(node);
        if (image) return [{ nodeId: node.id, type: "image" as const, sourceKind: image.source?.kind, title: node.title, image }];
        const video = readReferenceVideo(node);
        if (video) return [{ nodeId: node.id, type: "video" as const, title: node.title, video }];
        const audio = readReferenceAudio(node);
        if (audio) return [{ nodeId: node.id, type: "audio" as const, title: node.title, audio }];
        const text = readNodeTextInput(node);
        if (text) return [{ nodeId: node.id, type: "text" as const, title: node.title, text }];
        return [];
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

export async function hydrateNodeGenerationContext(context: NodeGenerationContext, projectId: string, domainProjectId?: string, mode?: CanvasGenerationMode, includeCharacterVoiceSamples = false) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    let referenceImages = await Promise.all(
        context.referenceImages.map(async (image) => {
            if (image.source?.kind === "drawing") return resolveCanvasDrawingReference(projectId, image);
            return { ...image, dataUrl: await imageToDataUrl(image) };
        }),
    );
    if (!context.characterReferences.length) return { ...context, referenceImages };
    if (!domainProjectId) throw new Error("角色引用未关联短剧项目，无法解析角色版本");
    const { getProjectCharacter } = await import("@/services/api/projects");
    const { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey } = await import("@/services/api/resources");
    const details = await Promise.all(context.characterReferences.map((reference) => getProjectCharacter(domainProjectId, reference.assetId)));
    const remainingBudget = 9 - referenceImages.length;
    const primaryByAsset = details.flatMap((detail, index) => {
        const representation = preferredCharacterRepresentation(detail.character.representations);
        if (!representation) return [];
        return [{ representation, reference: context.characterReferences[index], detail }];
    });
    if (primaryByAsset.length > remainingBudget) throw new Error(`当前模型参考图容量不足：角色至少需要 ${primaryByAsset.length} 张主参考图`);
    const usedResourceIds = new Set(primaryByAsset.map((item) => item.representation.resourceId));
    // 封面先入 referenceImages 的也占位，避免同一角色封面+主视角重复发送。
    referenceImages.forEach((image) => {
        const resourceId = resourceIdFromStorageKey(image.storageKey) || resourceIdFromFileUrl(image.dataUrl) || resourceIdFromFileUrl(image.url);
        if (resourceId) usedResourceIds.add(resourceId);
    });
    const extras = details.flatMap((detail, index) => detail.character.representations.flatMap((item) => {
        if (!["front", "side", "back", "turnaround_sheet", "primary"].includes(item.role) || usedResourceIds.has(item.resourceId)) return [];
        usedResourceIds.add(item.resourceId);
        return [{ representation: item, reference: context.characterReferences[index], detail }];
    }));
    const primaryNodeIds = new Set<string>();
    const characterImages = [...primaryByAsset, ...extras].slice(0, Math.max(0, remainingBudget)).map((item) => {
        const nodeId = item.reference?.nodeId || item.detail.asset.id;
        // 每个角色主视角用角色节点 id（对齐发送清单）；补充视角加 role 后缀。
        const isPrimary = !primaryNodeIds.has(nodeId);
        if (isPrimary) primaryNodeIds.add(nodeId);
        return {
            id: isPrimary ? nodeId : `${nodeId}:${item.representation.role}`,
            name: `${item.detail.asset.title || "角色"}-${item.representation.role || "ref"}.png`,
            type: "image/png",
            dataUrl: "",
            storageKey: resourceStorageKey(item.representation.resourceId),
        } satisfies ReferenceImage;
    });
    const hydratedCharacterImages = await Promise.all(characterImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) })));
    const hydratedResourceIds = new Set(hydratedCharacterImages.map((image) => resourceIdFromStorageKey(image.storageKey)).filter(Boolean));
    referenceImages = [
        ...referenceImages.filter((image) => {
            const resourceId = resourceIdFromStorageKey(image.storageKey) || resourceIdFromFileUrl(image.dataUrl) || resourceIdFromFileUrl(image.url);
            return !resourceId || !hydratedResourceIds.has(resourceId);
        }),
        ...hydratedCharacterImages,
    ];
    const characterBlocks = details
        .map((detail) => compileCharacterReferencePrompt(detail.asset.title, detail.character.definition))
        // 角色卡若已在 prompt（动作板预写 / 上次展开稿 / 上游文本）中出现，不再二次追加。
        .filter((block) => block && !containsTextBlock(context.prompt, block));
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
    if (context.referenceAudios.length + voiceSamples.length > 3) throw new Error(`当前模型参考音频容量不足：已连接 ${context.referenceAudios.length} 个音频，角色声音样本还需要 ${voiceSamples.length} 个名额`);
    const characterVoiceAudios = voiceSamples.map((voice) => ({
        id: `character-voice-${voice.assetId}`,
        name: `${voice.characterName}-声音样本.mp3`,
        type: "audio/mpeg",
        url: resourceFileUrl(voice.sampleResourceId!),
        storageKey: resourceStorageKey(voice.sampleResourceId!),
    } satisfies ReferenceAudio));
    const referenceAudios = [...context.referenceAudios, ...characterVoiceAudios];
    const voiceBlocks = mode === "video"
        ? resolvedCharacterVoices.map(compileResolvedVoicePrompt).filter((block) => block && !containsTextBlock(context.prompt, block))
        : [];
    return {
        ...context,
        prompt: [context.prompt.trim(), ...characterBlocks, ...voiceBlocks].filter(Boolean).join("\n\n"),
        referenceImages,
        referenceAudios,
        resolvedCharacterVersions,
        resolvedCharacterVoices,
        audioCount: referenceAudios.length,
    };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    if (node.type === CanvasNodeType.Skill) return readSkillInput(node);
    return node.metadata?.prompt || "";
}

function readCharacterReference(node: CanvasNodeData): CharacterGenerationReference | null {
    const assetId = node.metadata?.workflowKind === "character" ? node.metadata.characterAssetId?.trim() : "";
    return assetId ? { nodeId: node.id, assetId, requestedVersionId: node.metadata?.characterVersionPolicy === "pinned" ? node.metadata.characterVersionId : undefined } : null;
}

function readCharacterCoverImage(node: CanvasNodeData): ReferenceImage | null {
    if (node.metadata?.workflowKind !== "character") return null;
    const coverUrl = String(node.metadata.characterCoverUrl || "").trim();
    if (!coverUrl) return null;
    const resourceId = resourceIdFromFileUrl(coverUrl);
    return {
        id: node.id,
        name: `${node.metadata.characterName || node.title || "角色"}-参考图.png`,
        type: "image/png",
        dataUrl: coverUrl,
        url: coverUrl,
        storageKey: resourceId ? `resource:${resourceId}` : undefined,
    };
}

function resourceIdFromFileUrl(url?: string) {
    if (!url) return "";
    const match = url.match(/\/resources\/([^/?#]+)\/file/);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function preferredCharacterRepresentation(representations: Array<{ id: string; resourceId: string; role: string }>) {
    return ["turnaround_sheet", "primary", "front", "side", "back"]
        .map((role) => representations.find((item) => item.role === role))
        .find(Boolean);
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

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
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
    return nodeReferenceImage(node);
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        durationMs: node.metadata.durationMs,
    };
}
