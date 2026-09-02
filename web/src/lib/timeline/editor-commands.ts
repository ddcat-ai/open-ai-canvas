// 编辑器命令协议（ADR-0002）：时间线唯一修改入口。
// 命令 = 可序列化 { op, payload }，handler 为纯函数（禁止依赖组件实例），
// 未知 op 或非法 payload 一律抛错（fail-closed），保证可回放、可撤销、可黄金文件测试。
// 插件可经宿主 API register 自定义 op，与内建命令共用同一注册表与校验纪律。

import type { SrtEntry, TimelineClip, TimelineProject, TimelineTrack, TimelineTrackKind } from "@/types/timeline";

export type EditCommand = { op: string; payload: unknown };
export type CommandHandler = (state: TimelineProject, payload: unknown) => TimelineProject;

export type EditorCommandRegistry = {
    /** 注册命令 handler（宿主与插件共用；同名 op 覆盖，插件的注册顺序即优先级）。 */
    register: (op: string, handler: CommandHandler) => void;
    /** 应用命令：未知 op 抛错（fail-closed）；返回新状态（不可变更新）。 */
    apply: (state: TimelineProject, cmd: EditCommand) => TimelineProject;
    knownOps: () => string[];
};

// ---------------------------------------------------------------------------
// 黄金命令集合 payload 类型（首版一期能力，对应 Runbook M2.1）
// ---------------------------------------------------------------------------

export type AddClipPayload = { clip: TimelineClip };
export type MoveClipPayload = { id: string; startMs: number; trackId?: string };
export type TrimClipPayload = { id: string; startMs?: number; durationMs?: number; sourceStartMs?: number };
export type SplitClipPayload = { id: string; splitAtMs: number };
export type RemoveClipPayload = { id: string };
export type SetClipPropertyPayload = {
    id: string;
    patch: Partial<Pick<TimelineClip, "title" | "text" | "volume" | "fadeInMs" | "fadeOutMs" | "subtitleEntryIndex">>;
};
export type AddSubtitlePayload = { clip: TimelineClip };
export type RemoveSubtitlePayload = { id: string };
/** 从节点权威 subtitleEntries 重建时间线条字幕 clip（§3.1 快照契约：单向显式同步，替换过期快照）。 */
/** 新增空轨道（addTrack）。id/order/label 由 handler 按当前状态确定，保证 undo/redo 重放确定性。 */
export type AddTrackPayload = { kind: TimelineTrackKind };

/** 移除整条轨道及其全部片段（removeTrack）。守卫：同 kind 至少保留一条轨道（防唯一字幕/视频轨被删光后编辑失锚）。 */
export type RemoveTrackPayload = { trackId: string };
export type RebuildSubtitleClipsPayload = {
    /** 画布节点 id（subtitleEntries 权威源）。 */
    nodeId: string;
    /** 权威字幕条目快照（按此重建，text 进入 clip 快照）。 */
    entries: SrtEntry[];
    /** 目标字幕轨道 id；缺省取第一个字幕轨道。 */
    trackId?: string;
};

export const EDITOR_COMMAND_OPS = [
    "addClip",
    "moveClip",
    "trimClip",
    "splitClip",
    "removeClip",
    "setClipProperty",
    "addSubtitle",
    "removeSubtitle",
    "rebuildSubtitleClips",
    "addTrack",
    "removeTrack",
] as const;

// ---------------------------------------------------------------------------
// 校验辅助
// ---------------------------------------------------------------------------

function fail(op: string, message: string): never {
    throw new Error(`edit command "${op}" rejected: ${message}`);
}

function assertClipShape(op: string, clip: unknown): asserts clip is TimelineClip {
    if (typeof clip !== "object" || clip === null) fail(op, "clip must be an object");
    const c = clip as TimelineClip;
    if (typeof c.id !== "string" || c.id.length === 0) fail(op, "clip.id must be a non-empty string");
    if (!["video", "audio", "subtitle", "text", "image"].includes(c.kind)) fail(op, `clip.kind must be a valid clip kind, got "${c.kind}"`);
    if (typeof c.trackId !== "string" || c.trackId.length === 0) fail(op, "clip.trackId must be a non-empty string");
    if (typeof c.nodeId !== "string" || c.nodeId.length === 0) fail(op, "clip.nodeId must be a non-empty string");
    if (typeof c.startMs !== "number" || !Number.isFinite(c.startMs) || c.startMs < 0) fail(op, "clip.startMs must be a non-negative finite number");
    if (typeof c.durationMs !== "number" || !Number.isFinite(c.durationMs) || c.durationMs <= 0) fail(op, "clip.durationMs must be a positive finite number");
}

function findTrackOrThrow(op: string, state: TimelineProject, trackId: string) {
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) fail(op, `track "${trackId}" does not exist`);
    return track;
}

function findClipOrThrow(op: string, state: TimelineProject, id: string): TimelineClip {
    const clip = state.clips.find((c) => c.id === id);
    if (!clip) fail(op, `clip "${id}" does not exist`);
    return clip;
}

/** 时间线总时长 = 所有片段末端最大值（与 normalizeTimelineProject 同源）。 */
function recomputeDurationMs(state: TimelineProject): number {
    return state.clips.reduce((max, clip) => Math.max(max, clip.startMs + clip.durationMs), 0);
}

function withClips(state: TimelineProject, clips: TimelineClip[]): TimelineProject {
    return { ...state, clips, durationMs: recomputeDurationMs({ ...state, clips }) };
}

// ---------------------------------------------------------------------------
// 黄金命令集合 handler
// ---------------------------------------------------------------------------

function handleAddClip(state: TimelineProject, payload: unknown): TimelineProject {
    const { clip } = payload as AddClipPayload;
    assertClipShape("addClip", clip);
    if (clip.kind === "subtitle") fail("addClip", 'subtitle clips must use op "addSubtitle"');
    findTrackOrThrow("addClip", state, clip.trackId);
    return withClips(state, [...state.clips, clip]);
}

function handleMoveClip(state: TimelineProject, payload: unknown): TimelineProject {
    const { id, startMs, trackId } = payload as MoveClipPayload;
    if (typeof startMs !== "number" || !Number.isFinite(startMs) || startMs < 0) fail("moveClip", "startMs must be a non-negative finite number");
    const clip = findClipOrThrow("moveClip", state, id);
    if (trackId !== undefined) findTrackOrThrow("moveClip", state, trackId);
    const moved = { ...clip, startMs, ...(trackId !== undefined ? { trackId } : {}) };
    return withClips(state, state.clips.map((c) => (c.id === id ? moved : c)));
}

function handleTrimClip(state: TimelineProject, payload: unknown): TimelineProject {
    const { id, startMs, durationMs, sourceStartMs } = payload as TrimClipPayload;
    const clip = findClipOrThrow("trimClip", state, id);

    const nextStartMs = startMs ?? clip.startMs;
    const nextDurationMs = durationMs ?? clip.durationMs;
    const nextSourceStartMs = sourceStartMs ?? clip.sourceStartMs ?? 0;

    if (!Number.isFinite(nextStartMs) || nextStartMs < 0) fail("trimClip", "startMs must be a non-negative finite number");
    if (!Number.isFinite(nextDurationMs) || nextDurationMs <= 0) fail("trimClip", "durationMs must be a positive finite number");
    if (!Number.isFinite(nextSourceStartMs) || nextSourceStartMs < 0) fail("trimClip", "sourceStartMs must be a non-negative finite number");

    // 源时长已知时限制裁剪上限（UI 与命令层同一条规则，防止导出越界）。
    const sourceDuration = clip.sourceDurationMs ?? 0;
    if (sourceDuration > 0) {
        if (nextDurationMs > sourceDuration) fail("trimClip", `durationMs ${nextDurationMs} exceeds sourceDurationMs ${sourceDuration}`);
        if (nextSourceStartMs + nextDurationMs > sourceDuration) fail("trimClip", "sourceStartMs + durationMs exceeds sourceDurationMs");
    }

    const trimmed: TimelineClip = {
        ...clip,
        startMs: nextStartMs,
        durationMs: nextDurationMs,
        sourceStartMs: nextSourceStartMs,
    };
    return withClips(state, state.clips.map((c) => (c.id === id ? trimmed : c)));
}

function handleSplitClip(state: TimelineProject, payload: unknown): TimelineProject {
    const { id, splitAtMs } = payload as SplitClipPayload;
    if (typeof splitAtMs !== "number" || !Number.isFinite(splitAtMs)) fail("splitClip", "splitAtMs must be a finite number");
    const clip = findClipOrThrow("splitClip", state, id);

    const clipEnd = clip.startMs + clip.durationMs;
    if (splitAtMs <= clip.startMs || splitAtMs >= clipEnd) {
        fail("splitClip", `splitAtMs ${splitAtMs} must be strictly inside clip [${clip.startMs}, ${clipEnd})`);
    }

    const leftDuration = splitAtMs - clip.startMs;
    const rightDuration = clipEnd - splitAtMs;
    const left: TimelineClip = { ...clip, durationMs: leftDuration };
    const right: TimelineClip = {
        ...clip,
        id: `${clip.id}:split:${splitAtMs}`,
        startMs: splitAtMs,
        durationMs: rightDuration,
        sourceStartMs: (clip.sourceStartMs ?? 0) + leftDuration,
    };

    const index = state.clips.findIndex((c) => c.id === id);
    const clips = [...state.clips.slice(0, index), left, right, ...state.clips.slice(index + 1)];
    return withClips(state, clips);
}

function handleRemoveClip(state: TimelineProject, payload: unknown): TimelineProject {
    const { id } = payload as RemoveClipPayload;
    if (typeof id !== "string" || id.length === 0) fail("removeClip", "id must be a non-empty string");
    findClipOrThrow("removeClip", state, id);
    return withClips(state, state.clips.filter((c) => c.id !== id));
}

/** setClipProperty 允许修改的属性白名单；结构字段（id/kind/nodeId/trackId/startMs/durationMs/...）由专门命令负责。 */
const CLIP_PROPERTY_WHITELIST = new Set(["title", "text", "volume", "fadeInMs", "fadeOutMs", "subtitleEntryIndex"]);

function handleSetClipProperty(state: TimelineProject, payload: unknown): TimelineProject {
    const { id, patch } = payload as SetClipPropertyPayload;
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) fail("setClipProperty", "patch must be an object");
    const keys = Object.keys(patch);
    if (keys.length === 0) fail("setClipProperty", "patch must not be empty");
    for (const key of keys) {
        if (!CLIP_PROPERTY_WHITELIST.has(key)) fail("setClipProperty", `property "${key}" is not editable via setClipProperty (use the dedicated op)`);
    }
    findClipOrThrow("setClipProperty", state, id);

    const updated = { ...findClipOrThrow("setClipProperty", state, id), ...patch };
    return withClips(state, state.clips.map((c) => (c.id === id ? updated : c)));
}

function handleAddSubtitle(state: TimelineProject, payload: unknown): TimelineProject {
    const { clip } = payload as AddSubtitlePayload;
    assertClipShape("addSubtitle", clip);
    if (clip.kind !== "subtitle") fail("addSubtitle", `clip.kind must be "subtitle", got "${clip.kind}"`);
    findTrackOrThrow("addSubtitle", state, clip.trackId);
    return withClips(state, [...state.clips, clip]);
}

function handleRemoveSubtitle(state: TimelineProject, payload: unknown): TimelineProject {
    const { id } = payload as RemoveSubtitlePayload;
    if (typeof id !== "string" || id.length === 0) fail("removeSubtitle", "id must be a non-empty string");
    const clip = findClipOrThrow("removeSubtitle", state, id);
    if (clip.kind !== "subtitle") fail("removeSubtitle", `clip "${id}" is not a subtitle clip`);
    return withClips(state, state.clips.filter((c) => c.id !== id));
}

/** 轨道种类的基础标签；新增轨道 label = 基础标签 + 同种类现有轨道数 + 1。 */
const TRACK_KIND_BASE_LABELS: Record<TimelineTrackKind, string> = {
    video: "视频",
    image: "图片",
    text: "文本",
    audio: "音频",
    subtitle: "字幕",
};

function handleAddTrack(state: TimelineProject, payload: unknown): TimelineProject {
    const { kind } = payload as AddTrackPayload;
    if (!(kind in TRACK_KIND_BASE_LABELS)) {
        fail("addTrack", `track kind must be one of "video" | "image" | "text" | "audio" | "subtitle", got "${String(kind)}"`);
    }
    // id/order/label 都由当前状态确定：同一撤销/重放路径永远得到同一结果（确定性）。
    let index = state.tracks.filter((t) => t.kind === kind).length + 1;
    let id = `${kind}-${index}`;
    while (state.tracks.some((t) => t.id === id)) {
        index += 1;
        id = `${kind}-${index}`;
    }
    const order = state.tracks.reduce((max, t) => Math.max(max, t.order), -1) + 1;
    const track: TimelineTrack = { id, kind, label: `${TRACK_KIND_BASE_LABELS[kind]} ${index}`, order };
    return { ...state, tracks: [...state.tracks, track] };
}

function handleRemoveTrack(state: TimelineProject, payload: unknown): TimelineProject {
    const { trackId } = payload as RemoveTrackPayload;
    if (typeof trackId !== "string" || trackId.length === 0) fail("removeTrack", "trackId must be a non-empty string");
    const track = findTrackOrThrow("removeTrack", state, trackId);
    // 每类轨道至少保留一条：删除最后一条会让吸附目标、字幕重建等编辑操作失锚。
    const lastOfKind = state.tracks.filter((t) => t.kind === track.kind).length <= 1;
    if (lastOfKind) fail("removeTrack", `cannot remove the last "${track.kind}" track`);
    // 轨道上片段随轨道一并移除（moveClip/trimClip/splitClip 均已按 trackId 归属，无悬挂引用）。
    return {
        ...state,
        tracks: state.tracks.filter((t) => t.id !== trackId),
        clips: state.clips.filter((c) => c.trackId !== trackId),
    };
}

/** 校验 SrtEntry 数组：形状、区间、重复 index（fail-closed）。 */
function assertSubtitleEntries(op: string, entries: unknown): asserts entries is SrtEntry[] {
    if (!Array.isArray(entries)) fail(op, "entries must be an array of SrtEntry");
    const seen = new Set<number>();
    for (const entry of entries) {
        if (typeof entry !== "object" || entry === null) fail(op, "entries must contain SrtEntry objects");
        const e = entry as SrtEntry;
        if (!Number.isInteger(e.index) || e.index < 0) fail(op, `entry index must be a non-negative integer, got ${e.index}`);
        if (seen.has(e.index)) fail(op, `duplicate entry index ${e.index}`);
        seen.add(e.index);
        if (!Number.isFinite(e.startMs) || e.startMs < 0) fail(op, `entry ${e.index} startMs must be a non-negative finite number`);
        if (!Number.isFinite(e.endMs) || e.endMs <= e.startMs) fail(op, `entry ${e.index} endMs must be greater than startMs`);
        if (typeof e.text !== "string") fail(op, `entry ${e.index} text must be a string`);
    }
}

/**
 * 从节点权威 subtitleEntries 重建字幕 clip（§3.1 快照契约：单向显式同步）。
 * 移除 nodeId 名下全部过期字幕快照，按 entries 重建；id 确定（nodeId:subtitle:index），
 * 重跑即原地替换，不产生漂移。缺省轨道取第一个字幕轨。
 */
function handleRebuildSubtitleClips(state: TimelineProject, payload: unknown): TimelineProject {
    const { nodeId, entries, trackId } = payload as RebuildSubtitleClipsPayload;
    if (typeof nodeId !== "string" || nodeId.length === 0) fail("rebuildSubtitleClips", "nodeId must be a non-empty string");
    assertSubtitleEntries("rebuildSubtitleClips", entries);

    const explicitTrack = trackId !== undefined ? findTrackOrThrow("rebuildSubtitleClips", state, trackId) : null;
    if (explicitTrack && explicitTrack.kind !== "subtitle") fail("rebuildSubtitleClips", `track "${trackId}" is not a subtitle track`);
    const subtitleTrack = explicitTrack ?? state.tracks.find((t) => t.kind === "subtitle");
    if (!subtitleTrack) fail("rebuildSubtitleClips", "no subtitle track available");

    const rebuilt: TimelineClip[] = entries.map((entry) => ({
        id: `${nodeId}:subtitle:${entry.index}`,
        kind: "subtitle" as const,
        nodeId,
        trackId: subtitleTrack.id,
        startMs: entry.startMs,
        durationMs: entry.endMs - entry.startMs,
        subtitleEntryIndex: entry.index,
        text: entry.text,
    }));
    const clips = [...state.clips.filter((c) => !(c.kind === "subtitle" && c.nodeId === nodeId)), ...rebuilt];
    return withClips(state, clips);
}

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

const BUILTIN_HANDLERS: ReadonlyArray<readonly [string, CommandHandler]> = [
    ["addClip", handleAddClip],
    ["moveClip", handleMoveClip],
    ["trimClip", handleTrimClip],
    ["splitClip", handleSplitClip],
    ["removeClip", handleRemoveClip],
    ["setClipProperty", handleSetClipProperty],
    ["addSubtitle", handleAddSubtitle],
    ["removeSubtitle", handleRemoveSubtitle],
    ["addTrack", handleAddTrack],
    ["removeTrack", handleRemoveTrack],
    ["rebuildSubtitleClips", handleRebuildSubtitleClips],
];

/** 创建隔离的命令注册表（测试/黄金文件比对用独立实例）。 */
export function createEditorCommandRegistry(): EditorCommandRegistry {
    const handlers = new Map<string, CommandHandler>(BUILTIN_HANDLERS);
    return {
        register: (op, handler) => {
            if (typeof op !== "string" || op.length === 0) throw new Error("edit command op must be a non-empty string");
            handlers.set(op, handler);
        },
        apply: (state, cmd) => {
            if (typeof cmd !== "object" || cmd === null || typeof cmd.op !== "string") {
                throw new Error("edit command must be { op, payload }");
            }
            const handler = handlers.get(cmd.op);
            if (!handler) throw new Error(`unknown edit command op "${cmd.op}"`);
            return handler(state, cmd.payload);
        },
        knownOps: () => [...handlers.keys()],
    };
}

// 宿主核心协议单例：编辑器 store、插件经宿主 API 均注册/消费此实例。
let sharedRegistry: EditorCommandRegistry | null = null;
export function getEditorCommandRegistry(): EditorCommandRegistry {
    sharedRegistry ??= createEditorCommandRegistry();
    return sharedRegistry;
}
