import type { VideoCapabilityConfig } from "@/lib/model-capabilities";

export type DreaminaVideoMode = "all_reference" | "first_last_frames" | "smart_multi_frame";

export type DreaminaVideoReferenceCounts = {
    image: number;
    video: number;
    audio: number;
};

export const dreaminaVideoModeOptions: Array<{
    value: DreaminaVideoMode;
    label: string;
    description: string;
}> = [
    { value: "all_reference", label: "全能参考", description: "图片、视频和音频共同参考" },
    { value: "first_last_frames", label: "首尾帧", description: "依次使用首帧和尾帧 2 张图片" },
    { value: "smart_multi_frame", label: "智能多帧", description: "按顺序衔接 2–20 张图片" },
];

export function isLocalDreaminaVideoModel(model: string) {
    return /^local:dreamina-cli:seedance[A-Za-z0-9._-]*$/i.test(model.trim());
}

export function dreaminaVideoOperation(mode: DreaminaVideoMode, counts: DreaminaVideoReferenceCounts) {
    if (mode === "smart_multi_frame") return "multi_frame_to_video";
    if (mode === "first_last_frames") return "image_to_video";
    return counts.image + counts.video + counts.audio > 0 ? "reference_to_video" : "text_to_video";
}

export function dreaminaVideoModeMaxReferences(mode: DreaminaVideoMode, model: string) {
    if (mode === "first_last_frames") return 2;
    if (mode === "smart_multi_frame") return 20;
    return model.endsWith(":seedance2.5") ? 50 : 12;
}

export function dreaminaVideoModeAcceptsKind(mode: DreaminaVideoMode, kind: "image" | "video" | "audio" | "file") {
    if (kind === "file") return false;
    return mode === "all_reference" || kind === "image";
}

export function dreaminaVideoModeError(mode: DreaminaVideoMode, model: string, counts: DreaminaVideoReferenceCounts) {
    const total = counts.image + counts.video + counts.audio;
    if (mode === "first_last_frames") {
        if (counts.video || counts.audio) return "首尾帧模式只接受图片";
        if (counts.image < 2) return "首尾帧模式需要添加首帧和尾帧共 2 张图片";
        if (counts.image > 2) return "首尾帧模式最多使用 2 张图片";
        return "";
    }
    if (mode === "smart_multi_frame") {
        if (counts.video || counts.audio) return "智能多帧模式只接受图片";
        if (counts.image < 2) return "智能多帧模式需要添加 2–20 张图片";
        if (counts.image > 20) return "智能多帧模式最多使用 20 张图片";
        return "";
    }
    if (!total) return "";
    const seedance25 = model.endsWith(":seedance2.5");
    if (!seedance25 && counts.image + counts.video === 0) return "当前模型的全能参考至少需要一张图片或一个视频";
    if (counts.image > (seedance25 ? 30 : 9)) return `当前模型的全能参考最多使用 ${seedance25 ? 30 : 9} 张图片`;
    if (counts.video > (seedance25 ? 10 : 3)) return `当前模型的全能参考最多使用 ${seedance25 ? 10 : 3} 个视频`;
    if (counts.audio > (seedance25 ? 10 : 3)) return `当前模型的全能参考最多使用 ${seedance25 ? 10 : 3} 个音频`;
    if (total > (seedance25 ? 50 : 12)) return `当前模型的全能参考最多使用 ${seedance25 ? 50 : 12} 个素材`;
    return "";
}

export function dreaminaVideoProfileForMode(profile: VideoCapabilityConfig, mode: DreaminaVideoMode, counts?: DreaminaVideoReferenceCounts): VideoCapabilityConfig {
    if (mode !== "smart_multi_frame") return profile;
    const minimumTransitionDuration = (counts?.image || 0) >= 3 ? 1 : 2;
    return {
        ...profile,
        references: {
            ...profile.references,
            minImages: 2,
            maxImages: 20,
            maxVideos: 0,
            maxAudios: 0,
        },
        duration: { selection: "range", min: minimumTransitionDuration, max: 8, step: 1, default: 3 },
        ratios: [],
        resolutions: ["720p", "1080p"],
        defaultRatio: "16:9",
        defaultResolution: "720p",
        operations: ["multi_frame_to_video"],
        defaultOperation: "multi_frame_to_video",
    };
}
