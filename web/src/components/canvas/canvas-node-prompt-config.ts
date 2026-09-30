// 节点生成配置的默认值与补丁：按节点类型推导生成模式，合并全局模型配置。纯函数。

import { type CanvasNodeData, CanvasNodeType } from "@/types/canvas";
import { Video } from "lucide-react";
import { type AiConfig, defaultConfig } from "@/stores/use-config-store";
import { type ModelRequirements, resolveCompatibleModel, resolveModelGenerationDefaults } from "@/lib/model-selection";
import { canonicalGenerationMetadata } from "@/lib/canvas/generation-contract";
import { resolveCanvasGenerationModel } from "@/lib/canvas/canvas-project-generation";
import { normalizeVideoDuration, normalizeVideoResolution } from "@/lib/video-generation-options";
import type { CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import type { CanvasNodeGenerationMode } from "./canvas-node-prompt-panel";

export function modeDisplayName(mode: CanvasNodeGenerationMode) {
    if (mode === "image") return "图片";
    if (mode === "video") return "视频";
    if (mode === "audio") return "音频";
    return "文本";
}

export function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text || type === CanvasNodeType.Skill ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

export function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode, requirements: ModelRequirements): AiConfig {
    node = { ...node, metadata: canonicalGenerationMetadata(node, mode) };
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const fallbackModel = mode === "image" ? defaultConfig.imageModel : mode === "video" ? defaultConfig.videoModel : mode === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    const preferredModel = resolveCanvasGenerationModel(globalConfig, node.metadata?.model, mode) || resolveCanvasGenerationModel(globalConfig, defaultModel, mode) || fallbackModel;
    const model = resolveCompatibleModel(globalConfig, preferredModel, mode === "image" ? { ...requirements, imageSize: node.metadata?.size || globalConfig.size || defaultConfig.size } : requirements) || preferredModel;
    const defaults = resolveModelGenerationDefaults(
        globalConfig,
        model,
        mode === "image" ? "image" : mode === "video" ? "video" : undefined,
        mode === "image"
            ? {
                  size: node.metadata?.size,
                  quality: node.metadata?.quality,
                  transparentBackground: node.metadata?.transparentBackground,
                  videoWatermark: node.metadata?.watermark,
                  count: String(node.metadata?.count || globalConfig.canvasImageCount || globalConfig.count || defaultConfig.count),
              }
            : {
                  size: node.metadata?.size,
                  videoSeconds: node.metadata?.seconds,
                  vquality: node.metadata?.vquality,
                  videoGenerateAudio: node.metadata?.generateAudio,
                  videoWatermark: node.metadata?.watermark,
              },
        {
            size: globalConfig.size || defaultConfig.size,
            quality: globalConfig.quality || defaultConfig.quality,
            transparentBackground: globalConfig.transparentBackground || defaultConfig.transparentBackground,
            count: String(globalConfig.canvasImageCount || globalConfig.count || defaultConfig.count),
            videoSeconds: globalConfig.videoSeconds || defaultConfig.videoSeconds,
            vquality: globalConfig.vquality || defaultConfig.vquality,
            videoGenerateAudio: globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
            videoWatermark: globalConfig.videoWatermark || defaultConfig.videoWatermark,
        },
    );
    return {
        ...globalConfig,
        model,
        quality: defaults.quality ?? globalConfig.quality ?? defaultConfig.quality,
        size: defaults.size ?? globalConfig.size ?? defaultConfig.size,
        transparentBackground: defaults.transparentBackground ?? "false",
        videoSeconds: defaults.videoSeconds ?? normalizeVideoDuration(globalConfig.videoSeconds ?? defaultConfig.videoSeconds),
        vquality: defaults.vquality ?? normalizeVideoResolution(globalConfig.vquality || defaultConfig.vquality),
        videoGenerateAudio: defaults.videoGenerateAudio ?? globalConfig.videoGenerateAudio ?? defaultConfig.videoGenerateAudio,
        videoWatermark: defaults.videoWatermark ?? globalConfig.videoWatermark ?? defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        audioEmotionControlMethod: node.metadata?.audioEmotionControlMethod || globalConfig.audioEmotionControlMethod || defaultConfig.audioEmotionControlMethod,
        audioEmotionRandom: node.metadata?.audioEmotionRandom || globalConfig.audioEmotionRandom || defaultConfig.audioEmotionRandom,
        audioEmotionHappy: node.metadata?.audioEmotionHappy || globalConfig.audioEmotionHappy || defaultConfig.audioEmotionHappy,
        audioEmotionAngry: node.metadata?.audioEmotionAngry || globalConfig.audioEmotionAngry || defaultConfig.audioEmotionAngry,
        audioEmotionSad: node.metadata?.audioEmotionSad || globalConfig.audioEmotionSad || defaultConfig.audioEmotionSad,
        audioEmotionAfraid: node.metadata?.audioEmotionAfraid || globalConfig.audioEmotionAfraid || defaultConfig.audioEmotionAfraid,
        audioEmotionDisgusted: node.metadata?.audioEmotionDisgusted || globalConfig.audioEmotionDisgusted || defaultConfig.audioEmotionDisgusted,
        audioEmotionMelancholic: node.metadata?.audioEmotionMelancholic || globalConfig.audioEmotionMelancholic || defaultConfig.audioEmotionMelancholic,
        audioEmotionSurprised: node.metadata?.audioEmotionSurprised || globalConfig.audioEmotionSurprised || defaultConfig.audioEmotionSurprised,
        audioEmotionCalm: node.metadata?.audioEmotionCalm || globalConfig.audioEmotionCalm || defaultConfig.audioEmotionCalm,
        count: defaults.count ?? String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

export function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "输入新提示词，重新生成当前图片" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

export function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoArkPrivateAssetUpload") return { arkPrivateAssetUpload: value };
    return { [key]: value };
}

export function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    if (key === "audioInstructions") return { audioInstructions: value };
    return { [key]: value };
}
