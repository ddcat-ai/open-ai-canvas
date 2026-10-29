import { memo, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Button, Checkbox } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { AlertCircle, Film, Play, RotateCcw, TriangleAlert, X, PenLine } from "lucide-react";

import type { DramaCast, DramaModelChoice, DramaSegment, DramaShot } from "@/services/api/drama";

import { DramaModelPicker } from "../drama-model-picker";
import { aspectRatioValue, formatClock, mediaBusy, MediaThumb, useResourceMediaUrl } from "../drama-shared";
import { promptReady, secondsLabel, SegmentInputs, SegmentStatus, segmentState } from "./segment-parts";
import { isTypingTarget } from "./use-studio";
import { progressFillStyle } from "@/lib/progress-fill";

type Props = {
    shots: DramaShot[];
    segments: DramaSegment[];
    aspectRatio: string;
    castById: Map<string, DramaCast>;
    defaultVideoModel: DramaModelChoice;
    busy: boolean;
    /** 剧情段弹窗打开时暂停分镜页快捷键，避免和弹窗内的输入冲突。 */
    keyboardEnabled: boolean;
    /** 打开剧情段弹窗；shotId 有值时定位到该镜头。 */
    onOpen: (segmentIndex: number, shotId?: string) => void;
    onGenerate: (indexes: number[], model?: DramaModelChoice) => void;
    /** 重新处理已生成但后处理失败的段视频；reprocessing 是正在提交的段序号。 */
    onReprocess: (index: number) => void;
    reprocessing?: number;
    onWritePrompts: (indexes: number[]) => void;
    /** 本集还没有镜头时的说明：正在写、排队、已暂停或失败，由页面按真实状态给出。 */
    empty: EpisodeEmpty;
};

export type EpisodeEmpty = { title: string; text: string; active: boolean; action?: ReactNode };

const SHOT_PREVIEW = 3;

/** 可以提交视频的段：提示词已就绪且不在生成中。批量操作只提交这些段，其余跳过并说明。 */
function generatable(segment: DramaSegment) {
    return promptReady(segment) && !mediaBusy(segment.videoStatus);
}

/** 本段已有生成好的视频（含过期或后处理失败的），不论能否直接用于下一段。 */
function hasVideo(segment: DramaSegment) {
    return Boolean(segment.videoResourceId) && (segment.videoStatus === "ready" || segment.videoStatus === "stale" || segment.videoStatus === "failed");
}

/** 还没有尾帧缩略图时，用视频本身的开头画面作封面。 */
function CoverVideo({ resourceId }: { resourceId: string }) {
    const url = useResourceMediaUrl(resourceId, "playback");
    if (!url) return <span className="drama-sg-cover-empty is-busy" aria-hidden />;
    return <video className="drama-sg-cover-media" src={`${url}#t=0.1`} muted playsInline preload="metadata" aria-hidden tabIndex={-1} />;
}

function writable(segment: DramaSegment) {
    return segment.promptStatus !== "queued" && segment.promptStatus !== "running";
}

const NO_SHOTS: DramaShot[] = [];

type CardActions = {
    anchor?: number;
    handleCardClick: (event: MouseEvent, index: number) => void;
    toggle: (index: number) => void;
    selectRange: (from: number, to: number, additive: boolean) => void;
    onOpen: (segmentIndex: number, shotId?: string) => void;
    onGenerate: (indexes: number[], model?: DramaModelChoice) => void;
    onReprocess: (index: number) => void;
};

type CardProps = {
    segment: DramaSegment;
    segmentShots: DramaShot[];
    aspectRatio: string;
    castById: Map<string, DramaCast>;
    isSelected: boolean;
    focused: boolean;
    busy: boolean;
    reprocessing: boolean;
    defaultModelLabel?: string;
    actions: RefObject<CardActions>;
};

/**
 * 单个剧情段卡片。轮询刷新时 React Query 保留未变化段的对象引用，memo 让这些卡片跳过渲染，
 * 低配电脑上打开弹窗或轮询时不再整页重绘全部卡片。回调经 actions 引用读取，props 保持稳定。
 */
const SegmentCard = memo(function SegmentCard({ segment, segmentShots, aspectRatio, castById, isSelected, focused, busy, reprocessing, defaultModelLabel, actions }: CardProps) {
    const state = segmentState(segment);
    const error = segment.promptStatus === "failed" ? segment.promptError : segment.videoStatus === "failed" ? segment.videoError : "";
    const act = () => actions.current;
    return (
        <article
            data-segment={segment.index}
            role="option"
            aria-selected={isSelected}
            aria-current={focused}
            aria-label={`第 ${segment.index + 1} 段 ${segment.title}，${state.label}`}
            className={`drama-sg is-${state.tone} ${isSelected ? "is-selected" : ""} ${focused ? "is-focused" : ""}`}
            onClick={(event) => act().handleCardClick(event, segment.index)}
            onDoubleClick={(event) => {
                if (!(event.target as HTMLElement).closest("button, .ant-select")) act().onOpen(segment.index);
            }}
        >
            <header className="drama-sg-head">
                <Checkbox
                    checked={isSelected}
                    onChange={() => act().toggle(segment.index)}
                    onClick={(event) => {
                        const anchor = act().anchor;
                        if (event.shiftKey && anchor !== undefined) {
                            event.preventDefault();
                            act().selectRange(anchor, segment.index, true);
                        }
                    }}
                    aria-label={`选择第 ${segment.index + 1} 段`}
                />
                <span className="drama-seg-num">{segment.index + 1}</span>
                <button type="button" className="drama-sg-title" title={segment.title} onClick={() => act().onOpen(segment.index)}>
                    {segment.title}
                </button>
                {error ? (
                    <Tooltip title={error}>
                        <AlertCircle className="size-3.5 flex-none text-[var(--drama-err)]" aria-label="失败原因" />
                    </Tooltip>
                ) : segment.request.warning ? (
                    <Tooltip title={segment.request.warning}>
                        <TriangleAlert className="size-3.5 flex-none text-[var(--drama-warn)]" aria-label="提示" />
                    </Tooltip>
                ) : null}
            </header>
            <div className="drama-sg-body">
                <button type="button" className="drama-sg-cover" style={{ aspectRatio: aspectRatioValue(aspectRatio) }} onClick={() => act().onOpen(segment.index)} aria-label={`打开第 ${segment.index + 1} 段`}>
                    {segment.tailFrameResourceId && segment.videoResourceId ? (
                        <MediaThumb resourceId={segment.tailFrameResourceId} alt="" />
                    ) : segment.videoResourceId && hasVideo(segment) ? (
                        <CoverVideo resourceId={segment.videoResourceId} />
                    ) : (
                        <span className={`drama-sg-cover-empty ${state.tone === "busy" ? "is-busy" : ""}`}>
                            <Film className="size-4" aria-hidden />
                        </span>
                    )}
                    <span className="drama-sg-cover-dur">{secondsLabel(segment.durationMs)}</span>
                    {segment.videoResourceId ? (
                        <span className="drama-sg-cover-play">
                            <Play className="size-3" aria-hidden />
                        </span>
                    ) : null}
                </button>
                <div className="drama-sg-main">
                    <div className="drama-sg-meta">
                        <SegmentStatus segment={segment} />
                        <span>
                            {segmentShots.length} 镜{segment.request.maxVideoSeconds ? ` · 上限 ${segment.request.maxVideoSeconds}s` : ""}
                        </span>
                    </div>
                    <SegmentInputs segment={segment} castById={castById} compact />
                    {segmentShots.length === 1 ? (
                        <button type="button" className="drama-sg-single" onClick={() => act().onOpen(segment.index, segmentShots[0].id)}>
                            <span className="drama-sg-single-action">{segmentShots[0].action || segmentShots[0].imagePrompt || "未描述画面"}</span>
                            {segmentShots[0].dialogue ? (
                                <span className="drama-sg-single-line">
                                    <em>{segmentShots[0].speaker || "旁白"}</em>
                                    {segmentShots[0].dialogue}
                                </span>
                            ) : null}
                        </button>
                    ) : (
                        <ol className="drama-sg-shots">
                            {segmentShots.slice(0, SHOT_PREVIEW).map((shot) => (
                                <li key={shot.id}>
                                    <button type="button" onClick={() => act().onOpen(segment.index, shot.id)} title={shot.dialogue ? `${shot.speaker || "旁白"}：${shot.dialogue}` : shot.action}>
                                        <b>{shot.position + 1}</b>
                                        <span>
                                            {shot.dialogue ? (
                                                <>
                                                    <em>{shot.speaker || "旁白"}</em>
                                                    {shot.dialogue}
                                                </>
                                            ) : (
                                                shot.action || shot.imagePrompt || "未描述画面"
                                            )}
                                        </span>
                                    </button>
                                </li>
                            ))}
                            {segmentShots.length > SHOT_PREVIEW ? <li className="drama-sg-more">还有 {segmentShots.length - SHOT_PREVIEW} 镜</li> : null}
                        </ol>
                    )}
                </div>
            </div>
            <footer className="drama-sg-foot">
                <span className="drama-sg-model" title={segment.videoModel?.label}>
                    {segment.videoModel?.label || defaultModelLabel || "默认视频模型"}
                </span>
                <span className="drama-sg-actions">
                    {segment.videoReprocessable ? (
                        <Button size="small" type="primary" icon={<RotateCcw className="size-3" />} disabled={busy} loading={reprocessing} title="只重新处理已生成的视频，不重新生成、不扣费" onClick={() => act().onReprocess(segment.index)}>
                            重新处理
                        </Button>
                    ) : null}
                    <Button
                        size="small"
                        type={generatable(segment) && !hasVideo(segment) ? "primary" : "default"}
                        icon={<Play className="size-3" />}
                        disabled={busy || !generatable(segment)}
                        title={!promptReady(segment) ? "先撰写或确认本段视频提示词" : hasVideo(segment) ? "重新调用视频模型生成本段，会产生新的费用" : undefined}
                        onClick={() => act().onGenerate([segment.index])}
                    >
                        {mediaBusy(segment.videoStatus) ? (segment.videoStatus === "queued" && segment.videoWait ? "等待中" : segment.request.firstFramePending ? "等上一段" : "生成中") : hasVideo(segment) ? "重新生成" : "生成"}
                    </Button>
                </span>
            </footer>
        </article>
    );
});

/**
 * 分镜页：剧情段卡片网格。一段一次调用视频模型，卡片只放判断所需的信息：状态、预览、生成依据缩略图和前几个镜头；
 * 完整内容在剧情段弹窗里。
 * 选择：单击聚焦，⌘/Ctrl 单击切换选择，Shift 单击连选；快捷键见底部提示。
 */
export function Storyboard({ shots, segments, aspectRatio, castById, defaultVideoModel, busy, keyboardEnabled, onOpen, onGenerate, onReprocess, reprocessing, onWritePrompts, empty }: Props) {
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [focused, setFocused] = useState<number>();
    const [anchor, setAnchor] = useState<number>();
    const [batchModel, setBatchModel] = useState<DramaModelChoice>();
    const gridRef = useRef<HTMLDivElement>(null);
    const episodeId = shots[0]?.episodeId;
    useEffect(() => {
        setSelected(new Set());
        setFocused(undefined);
        setAnchor(undefined);
        setBatchModel(undefined);
    }, [episodeId]);
    const shotsBySegment = useMemo(() => {
        const map = new Map<number, DramaShot[]>();
        for (const shot of shots) map.set(shot.segmentIndex, [...(map.get(shot.segmentIndex) || []), shot]);
        return map;
    }, [shots]);
    const order = useMemo(() => segments.map((segment) => segment.index), [segments]);
    const totals = useMemo(
        () => ({
            durationMs: segments.reduce((sum, segment) => sum + segment.durationMs, 0),
            prompts: segments.filter(promptReady).length,
            videos: segments.filter((segment) => segment.videoStatus === "ready").length,
        }),
        [segments],
    );
    const chosen = segments.filter((segment) => selected.has(segment.index));
    const toGenerate = chosen.filter(generatable).map((segment) => segment.index);
    const toWrite = chosen.filter(writable).map((segment) => segment.index);

    const selectRange = (from: number, to: number, additive: boolean) => {
        const a = order.indexOf(from);
        const b = order.indexOf(to);
        const [start, end] = a < b ? [a, b] : [b, a];
        setSelected((current) => new Set([...(additive ? current : []), ...order.slice(start, end + 1)]));
    };
    const toggle = (index: number) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
        setAnchor(index);
        setFocused(index);
    };
    const handleCardClick = (event: MouseEvent, index: number) => {
        if ((event.target as HTMLElement).closest("button, a, input, .ant-select, .ant-checkbox-wrapper")) return;
        if (event.shiftKey && anchor !== undefined) {
            selectRange(anchor, index, event.metaKey || event.ctrlKey);
            setFocused(index);
            return;
        }
        if (event.metaKey || event.ctrlKey) {
            toggle(index);
            return;
        }
        setFocused(index);
        setAnchor(index);
    };
    // 卡片 memo 后通过引用读取最新回调与连选锚点，避免每次渲染传入新函数让 memo 失效。
    const actions = useRef<CardActions>({ anchor, handleCardClick, toggle, selectRange, onOpen, onGenerate, onReprocess });
    actions.current = { anchor, handleCardClick, toggle, selectRange, onOpen, onGenerate, onReprocess };

    // 分镜页快捷键：⌘/Ctrl+A 全选，Esc 清空，J/K 或方向键切换聚焦，Shift+方向键连选，X 或空格切换选择，Enter 打开。
    useEffect(() => {
        if (!keyboardEnabled) return;
        const columns = () => {
            const grid = gridRef.current;
            if (!grid) return 1;
            return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length);
        };
        const onKey = (event: KeyboardEvent) => {
            if (isTypingTarget(event.target) || event.altKey || !order.length) return;
            const key = event.key.toLowerCase();
            if ((event.metaKey || event.ctrlKey) && key === "a") {
                event.preventDefault();
                setSelected(new Set(order));
                return;
            }
            if (event.metaKey || event.ctrlKey) return;
            const position = focused === undefined ? -1 : order.indexOf(focused);
            const move = (delta: number) => {
                event.preventDefault();
                const next = order[Math.min(order.length - 1, Math.max(0, position < 0 ? 0 : position + delta))];
                if (event.shiftKey) {
                    const from = anchor ?? focused ?? next;
                    setAnchor(from);
                    selectRange(from, next, false);
                } else {
                    setAnchor(next);
                }
                setFocused(next);
            };
            if (key === "j" || event.key === "ArrowRight") move(1);
            else if (key === "k" || event.key === "ArrowLeft") move(-1);
            else if (event.key === "ArrowDown") move(columns());
            else if (event.key === "ArrowUp") move(-columns());
            else if (event.key === "Home") move(-order.length);
            else if (event.key === "End") move(order.length);
            else if (event.key === "Escape") {
                setSelected(new Set());
            } else if ((key === "x" || event.key === " ") && focused !== undefined) {
                event.preventDefault();
                toggle(focused);
            } else if (event.key === "Enter" && focused !== undefined) {
                event.preventDefault();
                onOpen(focused);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    useEffect(() => {
        if (focused === undefined) return;
        gridRef.current?.querySelector<HTMLElement>(`[data-segment="${focused}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [focused]);

    if (!shots.length) {
        return (
            <div className="drama-genesis">
                <div className="drama-genesis-card">
                    <div className={`drama-genesis-orb ${empty.active ? "" : "is-idle"}`} aria-hidden />
                    <h2>{empty.title}</h2>
                    <p>{empty.text}</p>
                    {empty.action ? <div className="drama-genesis-action">{empty.action}</div> : null}
                </div>
            </div>
        );
    }

    return (
        <div className="pb-4">
            <div className={`drama-board-toolbar ${selected.size ? "is-selecting" : ""}`}>
                {selected.size ? (
                    <>
                        <b className="text-[var(--fs-label)]">已选 {selected.size} 段</b>
                        <div className="drama-board-model">
                            <DramaModelPicker capability="video" size="sm" value={batchModel || defaultVideoModel} onChange={setBatchModel} placeholder="视频模型" />
                        </div>
                        <Tooltip title={toGenerate.length < selected.size ? `${selected.size - toGenerate.length} 段提示词未就绪或正在生成，会跳过` : undefined}>
                            <Button
                                size="small"
                                type="primary"
                                icon={<Play className="size-3.5" />}
                                disabled={busy || !toGenerate.length}
                                onClick={() => {
                                    onGenerate(toGenerate, batchModel);
                                    setSelected(new Set());
                                }}
                            >
                                生成视频 · {toGenerate.length} 段
                            </Button>
                        </Tooltip>
                        <Button
                            size="small"
                            icon={<PenLine className="size-3.5" />}
                            disabled={busy || !toWrite.length}
                            onClick={() => {
                                onWritePrompts(toWrite);
                                setSelected(new Set());
                            }}
                        >
                            重新撰写提示词 · {toWrite.length} 段
                        </Button>
                        <Button size="small" type="text" onClick={() => setSelected(new Set(order))}>
                            全选
                        </Button>
                        <Button size="small" type="text" icon={<X className="size-3.5" />} className="!ml-auto" onClick={() => setSelected(new Set())}>
                            取消选择
                        </Button>
                    </>
                ) : (
                    <>
                        <span className="drama-board-stat">
                            <b>{segments.length}</b>段
                        </span>
                        <span className="drama-board-stat">
                            <b>{shots.length}</b>镜
                        </span>
                        <span className="drama-board-stat">
                            <b>{formatClock(totals.durationMs)}</b>时长
                        </span>
                        <span className="drama-board-meter" aria-label={`提示词 ${totals.prompts}/${segments.length}`}>
                            提示词
                            <i>
                                <em style={progressFillStyle((totals.prompts / Math.max(segments.length, 1)) * 100)} />
                            </i>
                            <b>
                                {totals.prompts}/{segments.length}
                            </b>
                        </span>
                        <span className="drama-board-meter is-video" aria-label={`视频 ${totals.videos}/${segments.length}`}>
                            视频
                            <i>
                                <em style={progressFillStyle((totals.videos / Math.max(segments.length, 1)) * 100)} />
                            </i>
                            <b>
                                {totals.videos}/{segments.length}
                            </b>
                        </span>
                        <span className="ml-auto drama-board-hint">段按顺序生成，第 2 段起以上一段最后一帧为首帧</span>
                    </>
                )}
            </div>
            <div ref={gridRef} className={`drama-sg-grid ${aspectRatio === "16:9" || aspectRatio === "4:3" ? "is-landscape" : ""}`} role="listbox" aria-multiselectable aria-label="剧情段">
                {segments.map((segment) => (
                    <SegmentCard
                        key={segment.id || segment.index}
                        segment={segment}
                        segmentShots={shotsBySegment.get(segment.index) || NO_SHOTS}
                        aspectRatio={aspectRatio}
                        castById={castById}
                        isSelected={selected.has(segment.index)}
                        focused={focused === segment.index}
                        busy={busy}
                        reprocessing={reprocessing === segment.index}
                        defaultModelLabel={defaultVideoModel?.label}
                        actions={actions}
                    />
                ))}
            </div>
            <div className="drama-kbd-hint" aria-label="键盘快捷键">
                <span>
                    <kbd>⌘</kbd>
                    <kbd>A</kbd>全选
                </span>
                <span>
                    <kbd>⌘</kbd>单击 多选
                </span>
                <span>
                    <kbd>⇧</kbd>单击 / <kbd>⇧</kbd>
                    <kbd>←</kbd>
                    <kbd>→</kbd> 连选
                </span>
                <span>
                    <kbd>X</kbd>/<kbd>空格</kbd>选中当前
                </span>
                <span>
                    <kbd>J</kbd>
                    <kbd>K</kbd>/方向键 切换
                </span>
                <span>
                    <kbd>Enter</kbd>打开
                </span>
                <span>
                    <kbd>Esc</kbd>取消选择
                </span>
            </div>
        </div>
    );
}
