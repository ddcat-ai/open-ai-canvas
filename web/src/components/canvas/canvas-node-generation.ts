import type { AiTextMessage } from "@/services/api/image";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { getGenerationResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { nodeReferenceImage } from "@/lib/canvas/canvas-project-generation";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    alwaysIncludeText?: boolean;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    const storyboardInputs = getConnectedStoryboardRows(nodeId, nodes, connections);
    if (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) {
        return buildComposerGenerationContext(inputs, prompt);
    }

    const isStoryboardMedia = sourceNode?.type === CanvasNodeType.Image || sourceNode?.type === CanvasNodeType.Video;
    const basePrompt = isStoryboardMedia && storyboardInputs.length ? removeTrailingInputBlocks(prompt, storyboardInputs) : prompt;
    const textInputs = inputs.filter((input) => input.type === "text");
    const upstreamText = textInputs
        .map((input) => input.text)
        .filter(Boolean)
        .join("\n\n");
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? `${basePrompt}\n\n${upstreamText}` : basePrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: textInputs.length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
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

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const selectedInputs: NodeGenerationInput[] = [];
    const labelByNodeId = new Map<string, string>();
    const textBlocks: string[] = [];
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    let hasToken = false;
    let lastIndex = 0;
    let nextPrompt = "";

    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        hasToken = true;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input) {
            let label = labelByNodeId.get(input.nodeId);
            if (!label) {
                label = generationLabel(input.type, counts[input.type]++);
                labelByNodeId.set(input.nodeId, label);
                if (input.type === "text") textBlocks.push(`【${label}】\n${input.text || ""}`);
                else selectedInputs.push(input);
            }
            nextPrompt += input.type === "text" ? `【${label}】` : label;
        } else nextPrompt += match[0];
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += prompt.slice(lastIndex);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    if (!hasToken && !textBlocks.length) {
        return {
            prompt,
            referenceImages: [],
            referenceVideos: [],
            referenceAudios: [],
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
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    const resourceNodes = getGenerationResourceNodes(nodeId, nodes, connections);
    return resourceNodes.flatMap((node): NodeGenerationInput[] => {
        const image = readReferenceImage(node);
        if (image) return [{ nodeId: node.id, type: "image" as const, title: node.title, image }];
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

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    return { ...context, referenceImages: await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))) };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    if (node.type === CanvasNodeType.Skill) return readSkillInput(node);
    return node.metadata?.prompt || "";
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

function generationLabel(type: NodeGenerationInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return seedanceReferenceLabel("video", index);
    if (type === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
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
