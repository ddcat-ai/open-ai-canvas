import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Input, InputNumber, Select } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { AlertTriangle, ArrowLeft, Brush, Check, ChevronLeft, ChevronRight, Copy, Info, Loader2, Pencil, Play, Plus, RotateCcw, Trash2, X, PenLine } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { TRANSITION_LABEL } from "@/lib/drama/storyboard";
import type { DramaCast, DramaEpisodeDetail, DramaModelChoice, DramaSegment, DramaShot, DramaShotPatch, DramaTransition } from "@/services/api/drama";
import { dramaChoiceKey } from "@/lib/drama/model-choice";

import { DramaModelPicker } from "../drama-model-picker";

import { CAST_KIND_LABEL, formatCredits, mediaBusy, MediaThumb, parseList } from "../drama-shared";
import { promptReady, referenceMissingReason, secondsLabel, SegmentStatus, SegmentVideo, videoWaitLabel } from "./segment-parts";
import { DramaTakeList } from "./take-list";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

const SHOT_SIZES = ["特写", "近景", "中景", "全景", "远景"];
const CAMERAS = ["固定", "推", "拉", "摇", "跟", "环绕", "升降", "手持"];

const PROMPT_NOTICE: Record<DramaSegment["promptStatus"], string> = {
    none: "还没有撰写本段视频提示词",
    queued: "排队撰写中…",
    running: "正在撰写本段视频提示词…",
    ready: "",
    stale: "本段镜头或设定改过，提示词已过期，请重新撰写",
    failed: "撰写失败",
};

const OPERATION_LABEL: Record<DramaSegment["request"]["operation"], string> = {
    image_to_video: "图生视频（上一段尾帧作首帧）",
    reference_to_video: "参考图生视频",
    text_to_video: "文生视频",
    "": "未确定",
};

type Props = {
    detail?: DramaEpisodeDetail;
    segmentIndex?: number;
    shotId?: string;
    castById: Map<string, DramaCast>;
    aspectRatio: string;
    busy: boolean;
    writing: boolean;
    onClose: () => void;
    onNavigate: (segmentIndex: number, shotId?: string) => void;
    onPatchShot: (shot: DramaShot, patch: DramaShotPatch) => void;
    /** 在镜头前后插入空镜头；不传时不显示插入入口。 */
    onInsertShot?: (shot: DramaShot, position: "before" | "after") => void;
    /** 删除镜头；剧情段唯一的镜头不能删。 */
    onDeleteShot?: (shot: DramaShot) => void;
    onSavePrompt: (segment: DramaSegment, override: string) => void;
    /** 指定本段参考图；null 恢复按镜头自动取。 */
    onSaveReferences: (segment: DramaSegment, castIds: string[] | null) => void;
    onWritePrompt: (segment: DramaSegment) => void;
    onGenerate: (segment: DramaSegment, model?: DramaModelChoice) => void;
    reprocessing: boolean;
    onReprocess: (segment: DramaSegment) => void;
    defaultVideoModel: DramaModelChoice;
    onOpenCast: (castId: string) => void;
    /** 把本段投送到精修画布（已投送则定位），在画布上换首尾帧、延长或重新生成后采用回来。 */
    onOpenCanvas: (segment: DramaSegment) => void;
    canvasOpening: boolean;
};

/**
 * 剧情段弹窗（生成节点）：上方是本段的生成控制（视频模型、时长、画幅与操作），
 * 接着是本段使用的参考资产（可逐个勾选）、生成依据回执与按时间排开的镜头脚本，最后是提交时发送的完整提示词；
 * 右侧固定本段视频、处理状态与版本记录。
 */
export function SegmentDialog({
    detail,
    segmentIndex,
    shotId,
    castById,
    aspectRatio,
    busy,
    writing,
    reprocessing,
    defaultVideoModel,
    onClose,
    onNavigate,
    onPatchShot,
    onInsertShot,
    onDeleteShot,
    onSavePrompt,
    onSaveReferences,
    onWritePrompt,
    onGenerate,
    onReprocess,
    onOpenCast,
    onOpenCanvas,
    canvasOpening,
}: Props) {
    const segments = detail?.segments || [];
    const position = segments.findIndex((item) => item.index === segmentIndex);
    const segment = position >= 0 ? segments[position] : undefined;
    const shots = segment ? (detail?.shots || []).filter((shot) => shot.segmentIndex === segment.index) : [];
    return (
        <AppModal
            open={Boolean(segment)}
            onCancel={onClose}
            footer={null}
            title={null}
            closable={false}
            flush
            centered
            width="min(1360px, calc(100vw - 48px))"
            rootClassName="drama-root drama-sd-root"
            aria-label={segment ? `第 ${segment.index + 1} 段` : "剧情段"}
        >
            {segment && detail ? (
                <div className="drama-sd">
                    <header className="drama-sd-head">
                        <div className="min-w-0">
                            <div className="drama-eyebrow">
                                第 {detail.episode.number} 集 · 第 {segment.index + 1} / {segments.length} 段 · 镜头 {shots.length ? `${shots[0].position + 1}–${shots[shots.length - 1].position + 1}` : "—"}
                            </div>
                            <div className="drama-sd-title">
                                <h2>{segment.title}</h2>
                                <span className="drama-sdx-total">总时长 {secondsLabel(segment.durationMs)}</span>
                                <SegmentStatus segment={segment} />
                            </div>
                        </div>
                        <div className="drama-sd-nav">
                            <Button icon={<Brush className="size-4" />} loading={canvasOpening} onClick={() => onOpenCanvas(segment)}>
                                在画布中精修
                            </Button>
                            <Tooltip title="上一段">
                                <Button icon={<ChevronLeft className="size-4" />} aria-label="上一段" disabled={position <= 0} onClick={() => onNavigate(segments[position - 1].index)} />
                            </Tooltip>
                            <Tooltip title="下一段">
                                <Button icon={<ChevronRight className="size-4" />} aria-label="下一段" disabled={position >= segments.length - 1} onClick={() => onNavigate(segments[position + 1].index)} />
                            </Tooltip>
                            <Button type="text" icon={<X className="size-4" />} aria-label="关闭" onClick={onClose} />
                        </div>
                    </header>
                    <div className="drama-sdx-body">
                        <main className="drama-sdx-main thin-scrollbar">
                            <SegmentToolbar
                                key={segment.id}
                                segment={segment}
                                aspectRatio={aspectRatio}
                                busy={busy}
                                writing={writing}
                                defaultVideoModel={defaultVideoModel}
                                onGenerate={(model) => onGenerate(segment, model)}
                                onWritePrompt={() => onWritePrompt(segment)}
                            />
                            <SegmentPrompt segment={segment} castById={castById} writing={writing} onSave={(override) => onSavePrompt(segment, override)} onWrite={() => onWritePrompt(segment)} />
                            <ReferenceBoard segment={segment} shots={shots} castById={castById} busy={busy} onChange={(ids) => onSaveReferences(segment, ids)} onOpenCast={onOpenCast} />
                            <SegmentReceipt segment={segment} />
                            <section className="drama-sdx-section" aria-label="本段镜头">
                                <div className="drama-sdx-section-head">
                                    <strong>本段镜头</strong>
                                    <small>改动镜头后本段提示词与视频需要重新生成</small>
                                </div>
                                <ol className="drama-sdx-shots">
                                    {shots.map((item, index) => (
                                        <ShotCard
                                            key={item.id}
                                            shot={item}
                                            number={index + 1}
                                            startMs={shots.slice(0, index).reduce((sum, previous) => sum + previous.durationMs, 0)}
                                            castById={castById}
                                            editing={item.id === shotId}
                                            busy={busy}
                                            deletable={shots.length > 1}
                                            onEdit={() => onNavigate(segment.index, item.id === shotId ? undefined : item.id)}
                                            onPatch={(patch) => onPatchShot(item, patch)}
                                            onInsert={onInsertShot ? (where) => onInsertShot(item, where) : undefined}
                                            onDelete={onDeleteShot ? () => onDeleteShot(item) : undefined}
                                        />
                                    ))}
                                </ol>
                            </section>
                        </main>
                        <aside className="drama-sdx-side thin-scrollbar" aria-label="本段视频">
                            <div className="drama-sdx-side-head">
                                <strong>第 {segment.index + 1} 段视频</strong>
                                <SegmentStatus segment={segment} />
                            </div>
                            <SegmentVideo segment={segment} aspectRatio={aspectRatio} />
                            {segment.videoStatus === "failed" && segment.videoError ? (
                                <div className="drama-sd-error">
                                    <strong>{segment.videoReprocessable ? "视频已生成，后处理失败" : "视频生成失败"}</strong>
                                    <span>{segment.videoError}</span>
                                    {segment.videoReprocessable ? (
                                        <>
                                            <span>重新处理只针对这条已生成的视频，不会重新生成或扣费。</span>
                                            <div className="drama-sd-error-actions">
                                                <Button size="small" icon={<RotateCcw className="size-3.5" />} loading={reprocessing} disabled={busy} onClick={() => onReprocess(segment)}>
                                                    重新处理视频
                                                </Button>
                                            </div>
                                        </>
                                    ) : null}
                                </div>
                            ) : null}
                            {segment.videoStatus === "queued" && segment.videoWait ? (
                                <div className="drama-sd-error is-wait" role="status">
                                    <strong>视频尚未提交</strong>
                                    <span>{segment.videoWait}</span>
                                </div>
                            ) : null}
                            <dl className="drama-sdx-facts">
                                <div>
                                    <dt>进入成片</dt>
                                    <dd>{segment.videoSeconds ? `${segment.videoSeconds} 秒` : "—"}</dd>
                                </div>
                                <div>
                                    <dt>本段花费</dt>
                                    <dd>{segment.videoJob ? `${formatCredits(segment.videoJob.costMicrocredits)} 积分` : "—"}</dd>
                                </div>
                            </dl>
                            <DramaTakeList projectId={detail.episode.projectId} ownerId={segment.id} kind="video" />
                        </aside>
                    </div>
                </div>
            ) : null}
        </AppModal>
    );
}

/** 生成控制条：本段视频模型（只对本段生效）、时长与画幅，以及撰写提示词、复制全文与生成视频。 */
function SegmentToolbar({
    segment,
    aspectRatio,
    busy,
    writing,
    defaultVideoModel,
    onGenerate,
    onWritePrompt,
}: {
    segment: DramaSegment;
    aspectRatio: string;
    busy: boolean;
    writing: boolean;
    defaultVideoModel: DramaModelChoice;
    onGenerate: (model?: DramaModelChoice) => void;
    onWritePrompt: () => void;
}) {
    const { message } = App.useApp();
    const baseline = segment.videoModel?.logicalModelId || segment.videoModel?.modelKey ? segment.videoModel : defaultVideoModel;
    const [choice, setChoice] = useState<DramaModelChoice>(baseline);
    const changed = dramaChoiceKey(choice) !== dramaChoiceKey(baseline);
    const running = mediaBusy(segment.videoStatus);
    const writingNow = segment.promptStatus === "queued" || segment.promptStatus === "running";
    const sent = [segment.request.header, segment.videoPrompt.trim()].filter(Boolean).join("\n\n");
    const generateLabel = running
        ? segment.videoStatus === "queued" && segment.videoWait
            ? videoWaitLabel(segment.videoWait)
            : segment.request.firstFramePending
              ? `排队中 · 等第 ${segment.index} 段`
              : "视频生成中"
        : segment.videoResourceId && segment.videoStatus !== ""
          ? "重新生成视频"
          : "生成本段视频";
    return (
        <section className="drama-sdx-toolbar" aria-label="生成设置">
            <div className="drama-sdx-toolbar-row">
                <DramaModelPicker capability="video" size="sm" value={choice} onChange={setChoice} placeholder="视频模型" className="drama-sdx-model" aspectRatio={aspectRatio} />
                <Tooltip title={segment.request.maxVideoSeconds ? `按本段镜头时长生成；模型单次最长 ${segment.request.maxVideoSeconds} 秒` : "按本段镜头时长生成"}>
                    <span className="drama-sdx-chip">{segment.request.seconds ? `${segment.request.seconds}s` : secondsLabel(segment.durationMs)}</span>
                </Tooltip>
                <Tooltip title="画幅随作品设置，开工后不能修改">
                    <span className="drama-sdx-chip">{aspectRatio}</span>
                </Tooltip>
                {changed ? <span className="drama-sdx-chip is-accent">本段换模型</span> : null}
            </div>
            <div className="drama-sdx-toolbar-row">
                <Button size="small" icon={<PenLine className="size-3.5" />} loading={writing} disabled={busy || writingNow} onClick={onWritePrompt}>
                    {segment.promptStatus === "none" ? "撰写提示词" : "重新撰写提示词"}
                </Button>
                <Button
                    size="small"
                    icon={<Copy className="size-3.5" />}
                    disabled={!segment.videoPrompt}
                    onClick={() =>
                        void navigator.clipboard.writeText(sent).then(
                            () => message.success("已复制发送全文"),
                            () => message.error("复制失败"),
                        )
                    }
                >
                    复制发送全文
                </Button>
                <span className="drama-sdx-spacer" />
                <Button
                    type="primary"
                    size="small"
                    icon={running ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Play className="size-3.5" />}
                    disabled={busy || !promptReady(segment) || running || Boolean(segment.request.unknownReferences?.length)}
                    onClick={() => onGenerate(changed ? choice : undefined)}
                >
                    {generateLabel}
                </Button>
            </div>
            {!promptReady(segment) && !running ? <p className="drama-sdx-hint">提示词就绪后才能生成视频</p> : null}
            {segment.request.unknownReferences?.length ? <p className="drama-sdx-hint is-error">提示词里的 {segment.request.unknownReferences.join("、")} 不是本段的参考图，改正编号后才能生成视频</p> : null}
        </section>
    );
}

const CAST_KIND_ORDER: DramaCast["kind"][] = ["character", "prop", "scene"];

function moveItem(ids: string[], from: number, to: number) {
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}

/**
 * 本段参考资产：已选的设定按“参考图N”编号排在前面（排在前面的优先随请求发送），
 * 本段镜头里出现、但没选上的设定作为候选排在后面；勾选即加入，取消即移除。
 * 改动后参考图编号变化，模型撰写的提示词标记过期，需要重新撰写。
 */
function ReferenceBoard({ segment, shots, castById, busy, onChange, onOpenCast }: { segment: DramaSegment; shots: DramaShot[]; castById: Map<string, DramaCast>; busy: boolean; onChange: (ids: string[] | null) => void; onOpenCast: (id: string) => void }) {
    const { request } = segment;
    const ids = request.references.map((ref) => ref.castId);
    const sent = request.references.filter((ref) => ref.sent).length;
    const custom = segment.referenceMode === "custom";
    const candidates = useMemo(() => {
        const used = new Set(ids);
        const seen = new Set<string>();
        const result: DramaCast[] = [];
        for (const shot of shots) {
            for (const id of [...parseList(shot.castIdsJson), ...parseList(shot.propIdsJson), shot.sceneCastId || ""]) {
                const cast = id ? castById.get(id) : undefined;
                if (cast && !used.has(id) && !seen.has(id)) {
                    seen.add(id);
                    result.push(cast);
                }
            }
        }
        return result.sort((left, right) => CAST_KIND_ORDER.indexOf(left.kind) - CAST_KIND_ORDER.indexOf(right.kind));
        // ids 每次渲染都是新数组，按内容比较即可。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [castById, ids.join("|"), shots]);
    const options = useMemo(() => {
        const listed = new Set([...ids, ...candidates.map((cast) => cast.id)]);
        return CAST_KIND_ORDER.map((kind) => ({
            label: CAST_KIND_LABEL[kind],
            options: [...castById.values()].filter((cast) => cast.kind === kind && !listed.has(cast.id)).map((cast) => ({ value: cast.id, label: cast.imageStatus === "ready" && cast.imageResourceId ? cast.name : `${cast.name}（暂无参考图）` })),
        })).filter((group) => group.options.length);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [castById, candidates, ids.join("|")]);
    const first = segment.index === 0 && !request.firstFrameResourceId && !request.firstFramePending;
    return (
        <section className="drama-sdx-section" aria-label="本段参考资产">
            <div className="drama-sdx-section-head">
                <span className="drama-sdx-count">
                    本段参考 {sent}/{request.references.length}
                </span>
                <small>
                    {custom ? "手动指定" : "按镜头自动取"} · 本段最多发送 {request.referenceCapacity} 张{request.modelMaxImages ? ` · 模型上限 ${request.modelMaxImages} 张（含首帧）` : ""}；勾选决定本段生成时用哪些参考图
                </small>
                {custom ? (
                    <Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} disabled={busy} onClick={() => onChange(null)}>
                        恢复自动
                    </Button>
                ) : null}
            </div>
            <div className="drama-sdx-assets">
                <Tooltip title={first ? "开场段：按提示词与参考图生成，没有首帧" : request.firstFrameResourceId ? `首帧：第 ${segment.index} 段视频最后一帧` : `首帧：等第 ${segment.index} 段视频生成后取最后一帧`}>
                    <div className="drama-sdx-asset is-frame">
                        <span className="drama-sdx-asset-thumb">{request.firstFrameResourceId ? <MediaThumb resourceId={request.firstFrameResourceId} alt="上一段最后一帧" /> : <span>{first ? "开场" : "等待"}</span>}</span>
                        <span className="drama-sdx-asset-text">
                            <b>首帧</b>
                            <small>{first ? "开场段" : request.firstFrameResourceId ? `第 ${segment.index} 段尾帧` : "等待上一段"}</small>
                        </span>
                    </div>
                </Tooltip>
                {request.references.map((ref, index) => {
                    const cast = castById.get(ref.castId);
                    const reason = ref.sent ? "" : referenceMissingReason(segment, cast);
                    return (
                        <AssetChip
                            key={ref.castId}
                            cast={cast}
                            name={ref.name}
                            kindLabel={CAST_KIND_LABEL[ref.kind]}
                            badge={ref.label.replace("参考图", "图")}
                            checked
                            note={ref.sent ? "随请求发送" : `未附图：${reason}`}
                            missing={!ref.sent}
                            disabled={busy}
                            onToggle={() => onChange(ids.filter((id) => id !== ref.castId))}
                            onOpen={() => onOpenCast(ref.castId)}
                            onRaise={index > 0 ? () => onChange(moveItem(ids, index, index - 1)) : undefined}
                        />
                    );
                })}
                {candidates.map((cast) => (
                    <AssetChip
                        key={cast.id}
                        cast={cast}
                        name={cast.name}
                        kindLabel={CAST_KIND_LABEL[cast.kind]}
                        checked={false}
                        note="本段镜头中出现，未选用"
                        disabled={busy}
                        onToggle={() => onChange([...ids, cast.id])}
                        onOpen={() => onOpenCast(cast.id)}
                    />
                ))}
            </div>
            <div className="drama-sdx-assets-foot">
                <Select
                    className="drama-sdx-add"
                    size="small"
                    showSearch
                    value={null}
                    placeholder="添加其他设定作参考图"
                    optionFilterProp="label"
                    options={options}
                    disabled={busy || !options.length}
                    aria-label="添加参考图"
                    suffixIcon={<Plus className="size-3.5" />}
                    onChange={(id: string | null) => {
                        if (id) onChange([...ids, id]);
                    }}
                />
                <small>参考图编号会随勾选与顺序变化，模型撰写的提示词需要重新撰写；手写的提示词请自行核对编号。</small>
            </div>
        </section>
    );
}

/** 单个参考资产：勾选决定是否随本段请求发送，悬停放大查看参考图，点名称打开设定。 */
function AssetChip({
    cast,
    name,
    kindLabel,
    badge,
    checked,
    note,
    missing = false,
    disabled,
    onToggle,
    onOpen,
    onRaise,
}: {
    cast?: DramaCast;
    name: string;
    kindLabel: string;
    badge?: string;
    checked: boolean;
    note: string;
    missing?: boolean;
    disabled: boolean;
    onToggle: () => void;
    onOpen: () => void;
    onRaise?: () => void;
}) {
    const preview = cast?.imageResourceId ? (
        <span className="drama-sdx-preview">
            <MediaThumb resourceId={cast.imageResourceId} alt={name} />
        </span>
    ) : (
        `${kindLabel} · ${name}：暂无参考图`
    );
    return (
        <div className={`drama-sdx-asset ${checked ? "is-checked" : ""} ${missing ? "is-missing" : ""}`}>
            <input type="checkbox" className="drama-sdx-asset-check" checked={checked} disabled={disabled} aria-label={checked ? `不再把${name}作为本段参考图` : `把${name}作为本段参考图`} onChange={onToggle} />
            <Tooltip title={preview} placement="right" mouseEnterDelay={0.25} styles={{ root: { maxWidth: 360 } }}>
                <span className="drama-sdx-asset-thumb">
                    {cast?.imageResourceId ? <MediaThumb resourceId={cast.imageResourceId} alt={name} /> : <span>{kindLabel}</span>}
                    {badge ? <em>{badge}</em> : null}
                </span>
            </Tooltip>
            <button type="button" className="drama-sdx-asset-text" onClick={onOpen} title={`查看${name}设定`}>
                <b>{name}</b>
                <small>
                    {kindLabel} · {note}
                </small>
            </button>
            {onRaise ? (
                <Tooltip title="提前（优先发送）">
                    <button type="button" className="drama-sdx-asset-raise" aria-label={`提前${name}`} disabled={disabled} onClick={onRaise}>
                        <ArrowLeft className="size-3" />
                    </button>
                </Tooltip>
            ) : null}
        </div>
    );
}

type ReceiptRow = { tone: "ok" | "warn" | "info"; label: string; value: ReactNode };

/** 生成依据回执：本段实际会发送什么、按什么方式生成；与提交时同一函数计算。 */
function SegmentReceipt({ segment }: { segment: DramaSegment }) {
    const { request } = segment;
    const references = request.references.length;
    const sent = request.references.filter((ref) => ref.sent).length;
    const first = segment.index === 0 && !request.firstFrameResourceId && !request.firstFramePending;
    const promptText = segment.custom ? "已手动改写" : { none: "未撰写", queued: "排队撰写", running: "撰写中", ready: "已就绪", stale: "已过期，需要重新撰写", failed: "撰写失败" }[segment.promptStatus];
    // 读到视频模型能力时才有画面与声音参数（aspectRatio 与它们一起填写）。
    const outputRows: ReceiptRow[] = request.aspectRatio
        ? [
              { tone: request.size || request.resolution ? "ok" : "warn", label: "画面", value: request.resolution ? `${request.aspectRatio}（按 ${request.resolution} 出片）` : request.size ? request.aspectRatio : `${request.aspectRatio}（所选模型给不出这个画幅）` },
              { tone: request.generateAudio ? "ok" : "warn", label: "声音", value: request.generateAudio ? "模型同步生成对白与音效" : "所选模型不出声，本段视频没有对白与音效" },
          ]
        : [];
    const rows: ReceiptRow[] = [
        { tone: sent === references ? "ok" : "warn", label: "参考图实发", value: `${sent}/${references} 张${references > sent ? "（未附图的按文字设定生成）" : ""}` },
        { tone: first || request.firstFrameResourceId ? "ok" : "warn", label: "首帧", value: first ? "开场段，无首帧" : request.firstFrameResourceId ? `第 ${segment.index} 段视频最后一帧` : `等第 ${segment.index} 段视频生成` },
        { tone: "info", label: "生成方式", value: OPERATION_LABEL[request.operation] },
        { tone: "info", label: "时长", value: `${request.seconds || Math.round(segment.durationMs / 1000)} 秒${request.maxVideoSeconds ? `（模型单次最长 ${request.maxVideoSeconds} 秒）` : ""}` },
        ...outputRows,
        { tone: "info", label: "视频模型", value: segment.videoModel?.label || "作品默认" },
        { tone: promptReady(segment) ? "ok" : "warn", label: "提示词", value: promptText },
    ];
    return (
        <section className="drama-sdx-receipt" aria-label="生成依据回执">
            <strong>生成依据回执</strong>
            <ul>
                {rows.map((row) => (
                    <li key={row.label} className={`is-${row.tone}`}>
                        {row.tone === "ok" ? <Check className="size-3.5" aria-hidden /> : row.tone === "warn" ? <AlertTriangle className="size-3.5" aria-hidden /> : <Info className="size-3.5" aria-hidden />}
                        <span>{row.label}：</span>
                        <b>{row.value}</b>
                    </li>
                ))}
                {request.warning ? (
                    <li className="is-warn">
                        <AlertTriangle className="size-3.5" aria-hidden />
                        <b>{request.warning}</b>
                    </li>
                ) : null}
            </ul>
        </section>
    );
}

/** 文本里出现的设定名高亮显示，方便核对镜头里的人物、道具与场景。 */
function HighlightCast({ text, names }: { text: string; names: string[] }) {
    if (!text || !names.length) return <>{text}</>;
    const pattern = new RegExp(`(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
    return (
        <>
            {text.split(pattern).map((part, index) =>
                names.includes(part) ? (
                    <mark key={index} className="drama-sdx-mention">
                        {part}
                    </mark>
                ) : (
                    part
                ),
            )}
        </>
    );
}

/** 一个镜头：类型、时间段与操作，下面直接列出景别、运镜、画面、动作与台词；编辑时展开表单。 */
function ShotCard({
    shot,
    number,
    startMs,
    castById,
    editing,
    busy,
    deletable,
    onEdit,
    onPatch,
    onInsert,
    onDelete,
}: {
    shot: DramaShot;
    number: number;
    startMs: number;
    castById: Map<string, DramaCast>;
    editing: boolean;
    busy: boolean;
    deletable: boolean;
    onEdit: () => void;
    onPatch: (patch: DramaShotPatch) => void;
    onInsert?: (where: "before" | "after") => void;
    onDelete?: () => void;
}) {
    const { modal } = App.useApp();
    const names = useMemo(
        () =>
            [...castById.values()]
                .map((cast) => cast.name)
                .filter((name) => name.length >= 2)
                .sort((left, right) => right.length - left.length),
        [castById],
    );
    const rows: Array<[string, string]> = [
        ["景别", [shot.shotSize, shot.camera ? `运镜 ${shot.camera}` : "", shot.transition && shot.transition !== "cut" && shot.position > 0 ? `转场 ${TRANSITION_LABEL[shot.transition]}` : ""].filter(Boolean).join(" · ")],
        ["场景", shot.scene],
        ["画面", shot.imagePrompt],
        ["动作", shot.action],
        ["运动", shot.videoPrompt],
        ["对白", shot.dialogue ? `${shot.speaker || "旁白"}：${shot.dialogue}` : "无"],
    ];
    return (
        <li className={`drama-sdx-shot ${editing ? "is-editing" : ""}`}>
            <div className="drama-sdx-shot-head">
                <b className="drama-sdx-shot-index">{number}</b>
                <span className="drama-sdx-chip">{shot.dialogue ? "对话镜头" : "动作镜头"}</span>
                <span className="drama-sdx-shot-time">
                    {secondsLabel(startMs)}–{secondsLabel(startMs + shot.durationMs)}
                </span>
                <span className="drama-sdx-shot-duration">{secondsLabel(shot.durationMs)}</span>
                <span className="drama-sdx-spacer" />
                {onInsert ? (
                    <Tooltip title="在后面插入空镜头">
                        <Button size="small" icon={<Plus className="size-3.5" />} disabled={busy} onClick={() => onInsert("after")}>
                            镜
                        </Button>
                    </Tooltip>
                ) : null}
                {onDelete ? (
                    <Tooltip title={deletable ? "删除镜头" : "剧情段唯一的镜头不能删"}>
                        <Button
                            size="small"
                            icon={<Trash2 className="size-3.5" />}
                            aria-label="删除镜头"
                            disabled={busy || !deletable}
                            onClick={() =>
                                modal.confirm({
                                    title: `删除镜头 ${number}？`,
                                    content: "删除后本段提示词与视频需要重新生成。",
                                    okText: "删除",
                                    okButtonProps: { danger: true },
                                    cancelText: "取消",
                                    centered: true,
                                    onOk: onDelete,
                                })
                            }
                        />
                    </Tooltip>
                ) : null}
                <Button size="small" type={editing ? "primary" : "default"} icon={<Pencil className="size-3.5" />} aria-pressed={editing} onClick={onEdit}>
                    {editing ? "完成" : "编辑"}
                </Button>
            </div>
            {editing ? (
                <ShotEditor key={shot.id} shot={shot} onPatch={onPatch} />
            ) : (
                <dl className="drama-sdx-shot-body">
                    {rows
                        .filter(([, value]) => value)
                        .map(([label, value]) => (
                            <div key={label}>
                                <dt>{label}</dt>
                                <dd>
                                    <HighlightCast text={value} names={names} />
                                </dd>
                            </div>
                        ))}
                </dl>
            )}
        </li>
    );
}

// 与服务端 production.referenceTokenPattern 一致：“@参考图1”“参考图 1”保存时都会归一成“参考图1”。
const REFERENCE_TOKEN = /@?参考图\s*(\d+)/g;

/** 正文里引用到的参考图编号，以及不属于本段的编号（超出参考图数量）。 */
function referenceUsage(text: string, count: number) {
    const used = new Set<number>();
    const unknown: string[] = [];
    for (const match of text.matchAll(REFERENCE_TOKEN)) {
        const number = Number(match[1]);
        if (number >= 1 && number <= count) used.add(number);
        else if (!unknown.includes(`参考图${match[1]}`)) unknown.push(`参考图${match[1]}`);
    }
    return { used, unknown };
}

const PROMPT_EDITOR_MIN = 260;
const PROMPT_EDITOR_MAX = 560;

/**
 * 完整视频提示词：与画布视频节点的提示词面板一致，正文里的“参考图N”显示为带缩略图的引用，输入 @ 可插入本段参考图。
 * 提交时系统在正文前追加参考图对应说明（上方列出），视频模型靠同一个“参考图N”把名称与图片对上。
 */
function SegmentPrompt({ segment, castById, writing, onSave, onWrite }: { segment: DramaSegment; castById: Map<string, DramaCast>; writing: boolean; onSave: (override: string) => void; onWrite: () => void }) {
    const [draft, setDraft] = useState(segment.videoPrompt);
    const [editorHeight, setEditorHeight] = useState(PROMPT_EDITOR_MIN);
    const [showHeader, setShowHeader] = useState(false);
    useEffect(() => setDraft(segment.videoPrompt), [segment.videoPrompt]);
    const busy = segment.promptStatus === "queued" || segment.promptStatus === "running";
    const notice = segment.custom && segment.promptStatus === "stale" ? "" : PROMPT_NOTICE[segment.promptStatus];
    const dirty = draft.trim() !== segment.videoPrompt.trim();
    const { request } = segment;
    const references = useMemo<CanvasResourceReference[]>(
        () =>
            request.references.map((ref) => {
                const resourceId = ref.resourceId || castById.get(ref.castId)?.imageResourceId;
                return {
                    id: `drama-ref:${ref.castId}`,
                    nodeId: "",
                    kind: "image",
                    label: ref.label,
                    title: `${ref.name} · ${CAST_KIND_LABEL[ref.kind]}${ref.sent ? "" : "（未附图）"}`,
                    storageKey: resourceId ? `resource:${resourceId}` : undefined,
                    mentionToken: ref.label,
                    active: true,
                };
            }),
        [castById, request.references],
    );
    const usage = useMemo(() => referenceUsage(draft, request.references.length), [draft, request.references.length]);
    const unmentioned = request.references.filter((_, index) => !usage.used.has(index + 1));
    const commit = () => {
        const next = draft.trim();
        if (!dirty) return;
        if (!next) {
            setDraft(segment.videoPrompt);
            return;
        }
        onSave(next === segment.generated.trim() ? "" : next);
    };
    return (
        <section className="drama-sdx-section drama-sdx-prompt" aria-label="完整视频提示词">
            <div className="drama-sdx-section-head">
                <strong>完整视频提示词</strong>
                {segment.custom ? <span className="drama-sdx-chip is-accent">已手动改写</span> : null}
                <small>正文里的“参考图N”对应本段参考图；输入 @ 插入参考图，双击引用放大查看</small>
                {segment.custom ? (
                    <Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} onClick={() => onSave("")}>
                        恢复模型版本
                    </Button>
                ) : null}
            </div>
            {notice && segment.videoPrompt ? <PromptNotice segment={segment} text={notice} /> : null}
            {request.header ? (
                <div className="drama-sdx-prefix" aria-label="提交时加在开头的参考图说明">
                    <div className="drama-sdx-prefix-head">
                        <span>提交时自动加在开头</span>
                        <button type="button" className="drama-sdx-link" aria-expanded={showHeader} onClick={() => setShowHeader((value) => !value)}>
                            {showHeader ? "收起原文" : "查看原文"}
                        </button>
                    </div>
                    <div className="drama-sdx-prefix-refs">
                        {segment.index > 0 ? <span className="drama-sdx-prefix-ref is-frame">首帧 · 上一段最后一帧（不占编号）</span> : null}
                        {request.references.map((ref, index) => {
                            const resourceId = ref.resourceId || castById.get(ref.castId)?.imageResourceId;
                            return (
                                <span
                                    key={ref.castId}
                                    className={`drama-sdx-prefix-ref ${ref.sent ? "" : "is-missing"} ${usage.used.has(index + 1) ? "" : "is-unused"}`}
                                    title={ref.sent ? `${ref.label}：${ref.name}` : `${ref.label}（${ref.name}）未附图，按文字设定生成`}
                                >
                                    <span className="drama-sdx-prefix-thumb">{resourceId ? <MediaThumb resourceId={resourceId} alt="" /> : null}</span>
                                    <b>{ref.label}</b>
                                    {ref.name}
                                </span>
                            );
                        })}
                    </div>
                    {showHeader ? <pre>{request.header}</pre> : null}
                </div>
            ) : null}
            {!segment.videoPrompt && !draft && !busy ? (
                <div className="drama-sd-write">
                    <span>
                        {notice}
                        {segment.promptStatus === "failed" && segment.promptError ? `：${segment.promptError}` : ""}
                    </span>
                    <Button size="small" type="primary" icon={<PenLine className="size-3.5" />} loading={writing} onClick={onWrite}>
                        {segment.promptStatus === "none" ? "让模型撰写" : "重新撰写"}
                    </Button>
                </div>
            ) : null}
            {segment.videoPrompt || draft || !busy ? (
                <div className="drama-sdx-editor" style={{ height: Math.min(PROMPT_EDITOR_MAX, Math.max(PROMPT_EDITOR_MIN, editorHeight + 4)) }}>
                    <CanvasResourceMentionTextarea
                        value={draft}
                        references={references}
                        onChange={(next) => {
                            setDraft(next);
                        }}
                        onSubmit={commit}
                        sendOnEnter={false}
                        onContentSizeChange={setEditorHeight}
                        mentionMenuLabels={{ connected: "本段参考图" }}
                        className="drama-sdx-editor-input thin-scrollbar"
                        style={{ color: "var(--foreground)" }}
                        aria-label="完整视频提示词"
                        placeholder="也可以直接在这里手写本段完整视频提示词；输入 @ 引用参考图，失焦保存。开头的参考图说明由系统自动追加。"
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === "Escape" && dirty) {
                                event.stopPropagation();
                                setDraft(segment.videoPrompt);
                            }
                        }}
                    />
                </div>
            ) : (
                <div className="drama-sd-empty">
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                    <span>{notice}</span>
                    <small>写好后自动显示</small>
                </div>
            )}
            {usage.unknown.length ? (
                <p className="drama-sg-note is-error" role="alert">
                    正文里的 {usage.unknown.join("、")} 不是本段的参考图（本段共 {request.references.length} 张），生成视频前请改成正确的编号或用 @ 重新插入。
                </p>
            ) : draft && unmentioned.length ? (
                <p className="drama-sg-note">正文还没有引用 {unmentioned.map((ref) => `${ref.label}（${ref.name}）`).join("、")}；参考图仍会随请求发送，在正文里写明谁是谁，视频模型才不会认错。</p>
            ) : null}
            <div className="drama-sd-pane-foot">
                {dirty ? <span className="is-dirty">未保存 · 失焦或 ⌘↵ 保存，Esc 放弃</span> : <span>直接修改正文，失焦自动保存</span>}
                <span>{draft.length} 字</span>
            </div>
        </section>
    );
}

function PromptNotice({ segment, text }: { segment: DramaSegment; text: ReactNode }) {
    const busy = segment.promptStatus === "queued" || segment.promptStatus === "running";
    return (
        <div className={`drama-sd-notice is-${segment.promptStatus}`}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            <span>
                {text}
                {segment.promptStatus === "failed" && segment.promptError ? `：${segment.promptError}` : ""}
            </span>
        </div>
    );
}

/** 单个镜头的剧本内容；镜头是撰写段提示词的素材，不再单独生成媒体。 */
export function ShotEditor({ shot, onPatch }: { shot: DramaShot; onPatch: (patch: DramaShotPatch) => void }) {
    return (
        <div className="drama-sd-form">
            <FieldText label="台词" value={shot.dialogue} placeholder="无台词" onSave={(value) => onPatch({ dialogue: value })} />
            <div className="drama-sd-row">
                <label className="drama-sd-field">
                    <span className="drama-sd-label">
                        <span>说话人</span>
                    </span>
                    <Input
                        defaultValue={shot.speaker}
                        key={`${shot.id}-speaker-${shot.speaker}`}
                        placeholder="旁白"
                        aria-label="说话人"
                        onBlur={(event) => {
                            if (event.target.value.trim() !== shot.speaker) onPatch({ speaker: event.target.value });
                        }}
                    />
                </label>
                <label className="drama-sd-field">
                    <span className="drama-sd-label">
                        <span>时长</span>
                    </span>
                    <InputNumber
                        key={`${shot.id}-${shot.durationMs}`}
                        className="!w-full"
                        min={1}
                        max={60}
                        step={0.5}
                        precision={1}
                        defaultValue={shot.durationMs / 1000}
                        suffix="秒"
                        aria-label="镜头时长"
                        onBlur={(event) => {
                            const seconds = Number(event.target.value);
                            if (Number.isFinite(seconds) && Math.abs(seconds * 1000 - shot.durationMs) >= 50) onPatch({ durationSeconds: seconds });
                        }}
                        onPressEnter={(event) => (event.target as HTMLInputElement).blur()}
                    />
                </label>
            </div>
            <div className="drama-sd-row is-three">
                <label className="drama-sd-field">
                    <span className="drama-sd-label">
                        <span>景别</span>
                    </span>
                    <Select className="w-full" value={shot.shotSize || undefined} placeholder="自动" aria-label="景别" options={SHOT_SIZES.map((value) => ({ value, label: value }))} onChange={(value) => onPatch({ shotSize: value })} />
                </label>
                <label className="drama-sd-field">
                    <span className="drama-sd-label">
                        <span>运镜</span>
                    </span>
                    <Select className="w-full" value={shot.camera || undefined} placeholder="自动" aria-label="运镜" options={CAMERAS.map((value) => ({ value, label: value }))} onChange={(value) => onPatch({ camera: value })} />
                </label>
                <label className="drama-sd-field">
                    <span className="drama-sd-label">
                        <span>转场</span>
                    </span>
                    <Select
                        className="w-full"
                        value={(shot.transition || "cut") as DramaTransition}
                        aria-label="转场"
                        options={(Object.keys(TRANSITION_LABEL) as DramaTransition[]).map((value) => ({ value, label: TRANSITION_LABEL[value] }))}
                        disabled={shot.position === 0}
                        onChange={(value) => onPatch({ transition: value })}
                    />
                </label>
            </div>
            <FieldText label="动作" value={shot.action} rows={2} onSave={(value) => onPatch({ action: value })} />
            <FieldText label="起幅画面" value={shot.imagePrompt} rows={2} onSave={(value) => onPatch({ imagePrompt: value })} />
            {shot.sourceQuote ? (
                <div className="drama-sd-quote">
                    <span className="drama-sd-label">
                        <span>原文</span>
                    </span>
                    <p>「{shot.sourceQuote}」</p>
                </div>
            ) : null}
        </div>
    );
}

function FieldText({ label, value, placeholder, rows = 1, onSave }: { label: string; value: string; placeholder?: string; rows?: number; onSave: (value: string) => void }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    return (
        <label className="drama-sd-field">
            <span className="drama-sd-label">
                <span>{label}</span>
                {draft !== value ? <small className="is-dirty">未保存</small> : null}
            </span>
            <Input.TextArea
                value={draft}
                placeholder={placeholder}
                autoSize={{ minRows: rows, maxRows: 5 }}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                    if (draft.trim() !== value.trim()) onSave(draft);
                }}
            />
        </label>
    );
}
