// 时间线与字幕的共享数据模型。第一期落字幕数据；第二期起时间线轨道/片段在此持久化。

export type SrtEntry = {
    index: number;
    startMs: number;
    endMs: number;
    text: string;
};

export type SubtitleHighlight = {
    entryIndex: number;
    start: number;
    end: number;
    highlightText: string;
    sourceText: string;
};

export type SubtitlePosition = "top" | "bottom" | "center";
export type SubtitleHighlightAnimation = "pop" | "wipe" | "none";

export type SubtitleStyle = {
    fontSize: number;
    color: string;
    position: SubtitlePosition;
    highlightEnabled: boolean;
    highlightBackgroundColor: string;
    highlightTextColor: string;
    highlightPaddingX: number;
    highlightPaddingY: number;
    highlightRadius: number;
    highlightAnimation: SubtitleHighlightAnimation;
    /** 单条字幕最多字符数，超过则自动切分。默认 35，范围 20~60 */
    maxCharsPerEntry: number;
    /** 是否启用自动切分。默认 true */
    autoResegment: boolean;
};

export function createDefaultSubtitleStyle(): SubtitleStyle {
    return {
        fontSize: 18,
        color: "#ffffff",
        position: "bottom",
        highlightEnabled: true,
        highlightBackgroundColor: "#111111",
        highlightTextColor: "#ffd54a",
        highlightPaddingX: 6,
        highlightPaddingY: 2,
        highlightRadius: 4,
        highlightAnimation: "pop",
        maxCharsPerEntry: 35,
        autoResegment: true,
    };
}

export type TimelineTrackKind = "video" | "audio" | "subtitle" | "text" | "image";

export type TimelineTrack = {
    id: string;
    kind: TimelineTrackKind;
    label: string;
    order: number;
    locked?: boolean;
};

export type TimelineClipKind = "video" | "audio" | "subtitle" | "text" | "image";

/** 仅时间线作用域的直连媒体（不落画布）：素材库/项目资产/本地上传在时间线内直接入轨时使用。 */
export type TimelineDirectMedia = {
    /** 源素材 id（本地资产 id / 上传文件 id），用于生成时间线内唯一 nodeId 前缀 */
    id: string;
    kind: "video" | "audio" | "image" | "text";
    title: string;
    storageKey?: string;
    url?: string;
    dataUrl?: string;
    content?: string;
    durationMs?: number;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
};

export type TimelineClip = {
    id: string;
    kind: TimelineClipKind;
    nodeId: string;
    trackId: string;
    startMs: number;
    durationMs: number;
    title?: string;
    /** 源素材内裁剪起点（毫秒），用于导出阶段定位源文件片段 */
    sourceStartMs?: number;
    /** 源素材总时长（毫秒），用于 UI 限制裁剪上限 */
    sourceDurationMs?: number;
    volume?: number;
    fadeInMs?: number;
    fadeOutMs?: number;
    /** 字幕片段：对应源视频节点 subtitleEntries 的下标（-1 表示未关联） */
    subtitleEntryIndex?: number;
    /** 字幕片段文本快照，时间线内直接展示，不与节点双向同步 */
    text?: string;
    /** 仅时间线作用域的直连媒体；存在时预览/导出优先从该字段解析，不再回画布查节点 */
    directMedia?: TimelineDirectMedia;
};

export type TimelineProject = {
    version: 2;
    tracks: TimelineTrack[];
    clips: TimelineClip[];
    /** 时间线总时长（毫秒），取所有片段末端最大值 */
    durationMs: number;
    updatedAt?: string;
};
