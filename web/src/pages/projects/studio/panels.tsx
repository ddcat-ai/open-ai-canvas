import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Checkbox, Input, InputNumber, Select, Switch } from "antd";
import { AlertCircle, ArrowRight, Brush, CheckCheck, Clapperboard, Film, Gem, Inbox, Lock, MapPinned, Maximize2, PauseCircle, RefreshCw, RotateCcw, ScrollText, Upload, UserRound, UsersRound, Cpu, PackageCheck, Play } from "lucide-react";

import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { dramaChoiceKey, dramaVideoRatioIssue } from "@/lib/drama/model-choice";
import { dramaKeys } from "@/lib/drama/drama-query-keys";
import {
    getDramaCastImpact,
    regenerateDramaCast,
    regenerateDramaCasts,
    setDramaCastImage,
    updateDramaCast,
    updateDramaSettings,
    type DramaCapability,
    type DramaCast,
    type DramaCastKind,
    type DramaEpisodeMode,
    type DramaSettings,
    type DramaInboxItem,
    type DramaMediaMode,
    type DramaReviewMode,
    type DramaSummary,
    type DramaVideoContinuity,
} from "@/services/api/drama";

import { aspectRatioValue, CAST_KIND_LABEL, EpisodeGroupField, formatCredits, MEDIA_MODE_LABEL, mediaBusy, MediaThumb, parseList, VIDEO_CONTINUITY_LABEL } from "../drama-shared";
import { AssetSchemePicker } from "../asset-scheme";
import { DramaModelPicker, useDramaModelCatalog } from "../drama-model-picker";
import { PromptSkillField } from "../prompt-skill";
import { StoryboardRules } from "../storyboard-rules";
import { progressFillStyle } from "@/lib/progress-fill";
import { uploadResourceFile } from "@/services/api/resources";
import { DramaTakeList } from "./take-list";

// 制作台的三个整页视图：设定（角色 / 道具 / 场景）、待处理、制作设置。都在主区域内展示，不使用抽屉遮挡。

// ===== 设定 =====

const CAST_KIND_ICON: Record<DramaCastKind, ReactNode> = { character: <UserRound className="size-6 opacity-30" />, prop: <Gem className="size-6 opacity-30" />, scene: <MapPinned className="size-6 opacity-30" /> };
const CAST_KINDS: DramaCastKind[] = ["character", "prop", "scene"];

type CastFilter = "all" | "failed" | "busy" | "locked";

/** 资产参考图统一横版 16:9；角色按参考图方案的画幅（内置方案均为 16:9）。图片完整显示不裁切，占位与成图同尺寸。 */
const ASSET_IMAGE_RATIO = "16:9";

function castRatio(kind: DramaCastKind, ratios: CastRatios) {
    const ratio = (kind === "character" && ratios.character) || ASSET_IMAGE_RATIO;
    const [width, height] = ratio.split(":").map(Number);
    const orientation = width && height ? (width > height ? "is-wide" : width < height ? "is-tall" : "is-square") : "is-tall";
    return { style: { "--drama-cast-ratio": aspectRatioValue(ratio) } as CSSProperties, orientation };
}

export type CastRatios = { character: string };

const castImageLoading = <span className="drama-cast-media-state is-loading" role="status" aria-label="参考图加载中" />;
const castImageFailed = (
    <span className="drama-cast-media-state">
        <AlertCircle className="size-3.5" />
        图片加载失败
    </span>
);

export function CastPanel({
    projectId,
    cast,
    ratios,
    focusId,
    retrying,
    assetsPending,
    releasing,
    onFocus,
    onRetry,
    onChanged,
    onReleaseAssets,
    onOpenCanvas,
    canvasOpening,
}: {
    projectId: string;
    cast: DramaCast[];
    ratios: CastRatios;
    focusId: string;
    retrying: boolean;
    assetsPending: boolean;
    releasing: boolean;
    onFocus: (id: string) => void;
    onRetry: () => void;
    onChanged: () => void;
    onReleaseAssets: () => void;
    /** 把设定投送到精修画布（已投送则定位）。 */
    onOpenCanvas: (castId: string) => void;
    /** 正在打开画布的设定 ID。 */
    canvasOpening?: string;
}) {
    const [kind, setKind] = useState<DramaCastKind>("character");
    const [filter, setFilter] = useState<CastFilter>("all");
    const focused = cast.find((item) => item.id === focusId);
    useEffect(() => {
        if (focused) setKind(focused.kind);
    }, [focused]);
    const ofKind = cast.filter((item) => item.kind === kind);
    const failed = cast.filter((item) => item.imageStatus === "failed").length;
    const count = (predicate: (item: DramaCast) => boolean) => ofKind.filter(predicate).length;
    const filters: Array<[CastFilter, string, number]> = [
        ["all", "全部", ofKind.length],
        ["failed", "失败", count((item) => item.imageStatus === "failed")],
        ["busy", "生成中", count((item) => mediaBusy(item.imageStatus))],
        ["locked", "已锁定", count((item) => item.locked)],
    ];
    const list = ofKind.filter((item) => {
        if (filter === "failed") return item.imageStatus === "failed";
        if (filter === "busy") return mediaBusy(item.imageStatus);
        if (filter === "locked") return item.locked;
        return true;
    });
    const active = focused && focused.kind === kind ? focused : list[0];
    const kindRatio = castRatio(kind, ratios);
    return (
        <div className="drama-view drama-cast-layout">
            <section className="drama-view-main">
                <div className="drama-view-head">
                    <div className="drama-tabs" role="tablist" aria-label="设定类型">
                        {CAST_KINDS.map((value) => (
                            <button key={value} type="button" role="tab" className="drama-tab" aria-selected={kind === value} onClick={() => setKind(value)}>
                                {CAST_KIND_LABEL[value]}
                                <span className="drama-tab-count">{cast.filter((item) => item.kind === value).length}</span>
                            </button>
                        ))}
                    </div>
                    <div className="drama-filters" role="group" aria-label="筛选">
                        {filters.map(([key, label, value]) => (
                            <button key={key} type="button" className={`drama-filter ${key === "failed" && value ? "is-alert" : ""}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                                {label}
                                <b>{value}</b>
                            </button>
                        ))}
                    </div>
                    {failed ? (
                        <Button className="!ml-auto" icon={<RotateCcw className="size-4" />} loading={retrying} onClick={onRetry}>
                            重试失败的 {failed} 个
                        </Button>
                    ) : null}
                </div>
                <div className="drama-view-scroll thin-scrollbar">
                    {assetsPending && cast.some((item) => item.imageStatus === "") ? (
                        <div className="drama-banner is-ready is-flush">
                            <Clapperboard className="size-5 shrink-0 text-[var(--workspace-accent)]" />
                            <div className="drama-banner-text">
                                <strong>参考图还没有生成</strong>
                                <span>先核对角色、道具与场景的名称和外观描述，满意后再生成参考图；也可以在右侧单独生成某一个。参考图会随剧情段视频请求一起发送，保持人物和道具一致。</span>
                            </div>
                            <Button type="primary" icon={<Play className="size-4" />} loading={releasing} onClick={onReleaseAssets}>
                                生成全部参考图
                            </Button>
                        </div>
                    ) : null}
                    <div className={`drama-cast-grid ${kindRatio.orientation}`}>
                        {list.map((item) => (
                            <button key={item.id} type="button" className="drama-cast-card" aria-current={item.id === active?.id} onClick={() => onFocus(item.id)}>
                                <div className="drama-cast-card-media" style={kindRatio.style}>
                                    {item.imageResourceId ? <MediaThumb resourceId={item.imageResourceId} alt={item.name} loading={castImageLoading} failed={castImageFailed} /> : null}
                                    {!item.imageResourceId || mediaBusy(item.imageStatus) || item.imageStatus === "failed" || item.imageStatus === "" ? (
                                        <div className={`drama-shot-placeholder ${mediaBusy(item.imageStatus) ? "is-busy" : ""}`}>
                                            {item.imageStatus === "failed" ? (
                                                <span className="drama-cast-card-failed">
                                                    <AlertCircle className="size-3.5" />
                                                    生成失败
                                                </span>
                                            ) : item.imageResourceId ? (
                                                "更新中…"
                                            ) : (
                                                CAST_KIND_ICON[item.kind]
                                            )}
                                        </div>
                                    ) : null}
                                    {item.locked ? (
                                        <span className="drama-shot-flags">
                                            <span className="drama-flag is-lock">
                                                <Lock className="size-3" />
                                            </span>
                                        </span>
                                    ) : null}
                                </div>
                                <div className="drama-cast-card-body">
                                    <strong>{item.name}</strong>
                                    <span>{item.role || parseList(item.aliasesJson).join("、") || item.description || "—"}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                    {!list.length ? (
                        <div className="drama-empty">
                            <UserRound className="size-7" />
                            <span>{ofKind.length ? "没有符合筛选的设定" : `作品圣经建立后，${CAST_KIND_LABEL[kind]}会出现在这里`}</span>
                        </div>
                    ) : null}
                </div>
            </section>
            <aside className="drama-view-side thin-scrollbar">
                {active ? (
                    <CastEditor key={active.id} projectId={projectId} cast={active} ratios={ratios} onChanged={onChanged} onOpenCanvas={() => onOpenCanvas(active.id)} canvasOpening={canvasOpening === active.id} />
                ) : (
                    <div className="drama-empty is-compact">
                        <span>选择一个设定查看详情</span>
                    </div>
                )}
            </aside>
        </div>
    );
}

function CastEditor({ projectId, cast, ratios, onChanged, onOpenCanvas, canvasOpening }: { projectId: string; cast: DramaCast; ratios: CastRatios; onChanged: () => void; onOpenCanvas: () => void; canvasOpening: boolean }) {
    const { message } = App.useApp();
    const [previewing, setPreviewing] = useState(false);
    const [name, setName] = useState(cast.name);
    const [aliases, setAliases] = useState(parseList(cast.aliasesJson));
    const [appearance, setAppearance] = useState(cast.appearance);
    const [voiceInstructions, setVoiceInstructions] = useState(cast.voiceInstructions);
    const [restyle, setRestyle] = useState(true);
    const impactQuery = useQuery({ queryKey: dramaKeys.castImpact(projectId, cast.id), queryFn: ({ signal }) => getDramaCastImpact(projectId, cast.id, signal) });
    const dirty = name !== cast.name || appearance !== cast.appearance || voiceInstructions !== cast.voiceInstructions || aliases.join("|") !== parseList(cast.aliasesJson).join("|");
    const fields = { name, aliases, appearance, voiceInstructions };
    const save = useMutation({
        mutationFn: () => updateDramaCast(projectId, cast.id, fields),
        onSuccess: () => {
            message.success("设定已保存");
            onChanged();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存失败"),
    });
    const lock = useMutation({ mutationFn: (locked: boolean) => updateDramaCast(projectId, cast.id, { locked }), onSuccess: onChanged });
    const regenerate = useMutation({
        mutationFn: async () => {
            if (dirty) await updateDramaCast(projectId, cast.id, fields);
            return regenerateDramaCast(projectId, cast.id, restyle);
        },
        onSuccess: (result) => {
            message.success(result.affectedSegments ? `正在重新生成参考图；${result.affectedSegments} 个剧情段的视频需重新生成` : "正在重新生成参考图");
            onChanged();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "操作失败"),
    });
    // 上传的形象图直接成为参考图并锁定：不会被重新生成覆盖，剧情段视频按这张图生成。
    const fileRef = useRef<HTMLInputElement>(null);
    const upload = useMutation({
        mutationFn: async (file: File) => {
            const resource = await uploadResourceFile(file, "image", { fileName: file.name });
            return setDramaCastImage(projectId, cast.id, resource.id, restyle);
        },
        onSuccess: (result) => {
            message.success(result.affectedSegments ? `已替换并锁定形象；${result.affectedSegments} 个剧情段的视频需重新生成` : "已替换并锁定形象，之后的剧情段视频按这张图生成");
            onChanged();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "上传失败"),
    });
    const impact = impactQuery.data;
    const isCharacter = cast.kind === "character";
    const kindLabel = CAST_KIND_LABEL[cast.kind];
    return (
        <div className="drama-editor">
            <div className="drama-cast-hero" style={castRatio(cast.kind, ratios).style}>
                {cast.imageResourceId ? <MediaThumb resourceId={cast.imageResourceId} alt={cast.name} loading={castImageLoading} failed={castImageFailed} /> : null}
                {cast.imageResourceId ? (
                    <button type="button" className="drama-cast-hero-zoom" aria-label={`放大查看${cast.name}的参考图`} title="点击放大查看" onClick={() => setPreviewing(true)}>
                        <span className="drama-cast-hero-zoom-hint" aria-hidden="true">
                            <Maximize2 className="size-3.5" />
                        </span>
                    </button>
                ) : null}
                {!cast.imageResourceId || mediaBusy(cast.imageStatus) || cast.imageStatus === "failed" ? (
                    <div className={`drama-shot-placeholder ${mediaBusy(cast.imageStatus) ? "is-busy" : ""}`}>
                        {cast.imageStatus === "failed" ? (
                            <span className="drama-cast-card-failed">
                                <AlertCircle className="size-4" />
                                参考图生成失败
                            </span>
                        ) : mediaBusy(cast.imageStatus) ? (
                            "参考图生成中…"
                        ) : (
                            "尚未生成参考图：确认描述后点下方生成，或上传已有的形象图"
                        )}
                    </div>
                ) : null}
            </div>
            <div className="drama-editor-row">
                <span className="drama-eyebrow">{kindLabel}设定</span>
                <label className="drama-switch-label">
                    <Lock className="size-3.5" />
                    锁定形象
                    <Switch size="small" checked={cast.locked} loading={lock.isPending} onChange={(checked) => lock.mutate(checked)} />
                </label>
            </div>
            <Field label="名称">
                <Input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} aria-label="名称" />
            </Field>
            {isCharacter ? (
                <Field label="别名与称呼" hint="剧本里这些称呼都会归到此角色">
                    <Select mode="tags" className="w-full" value={aliases} onChange={setAliases} tokenSeparators={[",", "，", "、"]} placeholder="输入后回车" open={false} suffixIcon={null} aria-label="别名与称呼" />
                </Field>
            ) : null}
            <Field label={APPEARANCE_LABEL[cast.kind]} hint="用于参考图与剧情段视频提示词">
                <Input.TextArea value={appearance} autoSize={{ minRows: 4, maxRows: 10 }} onChange={(event) => setAppearance(event.target.value)} aria-label={APPEARANCE_LABEL[cast.kind]} />
            </Field>
            {isCharacter ? (
                <Field label="声线" hint="写进视频提示词，由视频模型生成对白">
                    <Input value={voiceInstructions} placeholder="少年音，坚毅，语速偏快" onChange={(event) => setVoiceInstructions(event.target.value)} aria-label="声线" />
                </Field>
            ) : null}
            <div className="drama-editor-impact">
                <Checkbox checked={restyle} onChange={(event) => setRestyle(event.target.checked)}>
                    让引用它的剧情段视频重新生成
                </Checkbox>
                {impact ? (
                    <span>
                        {impact.episodes} 集 · {impact.segments} 段
                    </span>
                ) : null}
            </div>
            <div className="drama-editor-actions">
                <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                    保存设定
                </Button>
                <Button icon={<Upload className="size-4" />} loading={upload.isPending} onClick={() => fileRef.current?.click()}>
                    上传形象图
                </Button>
                <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    aria-label={`上传${cast.name}的形象图`}
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        if (!file.type.startsWith("image/")) {
                            message.warning("请选择 PNG、JPG 或 WebP 图片");
                            return;
                        }
                        if (file.size > 20 * 1024 * 1024) {
                            message.warning("图片不超过 20MB");
                            return;
                        }
                        upload.mutate(file);
                    }}
                />
                <Button type="primary" className="drama-editor-wide" icon={<RefreshCw className="size-4" />} disabled={cast.locked || mediaBusy(cast.imageStatus)} loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
                    {cast.imageResourceId ? (dirty ? "保存并重新生成" : "重新生成") : dirty ? "保存并生成参考图" : "生成参考图"}
                </Button>
                <Button className="drama-editor-wide" icon={<Brush className="size-4" />} loading={canvasOpening} onClick={onOpenCanvas}>
                    在画布中精修
                </Button>
            </div>
            <p className="drama-editor-note">旧版本保留在版本记录中；锁定后参考图不会被重新生成。上传或从画布采用的形象图会自动锁定，生成剧情段视频时随请求发送，并要求外貌、发型与服装以它为准。</p>
            <DramaTakeList projectId={projectId} ownerId={cast.id} kind="cast" />
            {previewing && cast.imageResourceId ? <CanvasImagePreview storageKey={`resource:${cast.imageResourceId}`} alt={`${cast.name} · ${kindLabel}参考图`} onClose={() => setPreviewing(false)} /> : null}
        </div>
    );
}

const APPEARANCE_LABEL: Record<DramaCastKind, string> = { character: "外貌描述", prop: "外形描述", scene: "环境描述" };

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <div className="drama-field">
            <div className="drama-field-label">
                <span>{label}</span>
                {hint ? <small>{hint}</small> : null}
            </div>
            {children}
        </div>
    );
}

// ===== 待处理 =====

type InboxGroup = {
    key: string;
    kind: DramaInboxItem["kind"];
    severity: DramaInboxItem["severity"];
    title: string;
    reason: string;
    items: DramaInboxItem[];
};

const KIND_ORDER: DramaInboxItem["kind"][] = ["paused", "media_ready", "review", "episode_error", "cast_failed", "segment_failed"];
const MEDIA_LABEL: Record<NonNullable<DramaInboxItem["media"]>, string> = { prompt: "提示词", video: "视频" };

/** 同类、同原因的问题折叠成一组：12 个角色同样的失败只占一张卡。 */
function groupInbox(items: DramaInboxItem[]): InboxGroup[] {
    const groups = new Map<string, InboxGroup>();
    for (const item of items) {
        const reason = item.kind === "review" ? "" : item.detail;
        const key = [item.kind, item.castKind || "", item.media || "", reason].join("|");
        const group = groups.get(key);
        if (group) group.items.push(item);
        else groups.set(key, { key, kind: item.kind, severity: item.severity, title: "", reason, items: [item] });
    }
    for (const group of groups.values()) {
        const count = group.items.length;
        const first = group.items[0];
        if (group.kind === "paused") group.title = "制作已暂停";
        else if (group.kind === "media_ready") group.title = first.title;
        else if (group.kind === "review") group.title = count > 1 ? `${count} 集视频提示词等待审阅` : first.title;
        else if (group.kind === "episode_error") group.title = count > 1 ? `${count} 集改编遇到问题` : first.title;
        else if (group.kind === "cast_failed") group.title = `${count} 个${CAST_KIND_LABEL[first.castKind || "character"]}参考图生成失败`;
        else group.title = `${count} 个剧情段${MEDIA_LABEL[first.media || "video"]}生成失败`;
    }
    return [...groups.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.items.length - a.items.length);
}

const GROUP_ICON: Record<DramaInboxItem["kind"], ReactNode> = {
    paused: <PauseCircle className="size-[18px]" />,
    media_ready: <PackageCheck className="size-[18px]" />,
    review: <CheckCheck className="size-[18px]" />,
    episode_error: <ScrollText className="size-[18px]" />,
    cast_failed: <UserRound className="size-[18px]" />,
    segment_failed: <Film className="size-[18px]" />,
};

const MEDIA_ICON: Record<NonNullable<DramaInboxItem["media"]>, ReactNode> = {
    prompt: <ScrollText className="size-3" />,
    video: <Film className="size-3" />,
};

const CHIP_LIMIT = 24;

export function InboxPanel({
    items,
    castById,
    retrying,
    retryingGroup,
    releasing,
    onRetryAll,
    onRetryGroup,
    onOpen,
    onOpenSettings,
    onReleaseAll,
}: {
    items: DramaInboxItem[];
    castById: Map<string, DramaCast>;
    retrying: boolean;
    retryingGroup: string;
    onRetryAll: () => void;
    onRetryGroup: (key: string, items: DramaInboxItem[]) => void;
    onOpen: (item: DramaInboxItem) => void;
    onOpenSettings: () => void;
    releasing: boolean;
    onReleaseAll: () => void;
}) {
    const groups = useMemo(() => groupInbox(items), [items]);
    const failures = items.filter((item) => item.severity === "error").length;
    const reviews = items.filter((item) => item.kind === "review").length;
    return (
        <div className="drama-view">
            <section className="drama-view-main">
                <div className="drama-view-head">
                    <h2 className="drama-view-title">待处理</h2>
                    {items.length ? (
                        <div className="drama-inbox-summary">
                            {failures ? (
                                <span className="is-err">
                                    <AlertCircle className="size-3.5" />
                                    {failures} 项失败
                                </span>
                            ) : null}
                            {reviews ? (
                                <span className="is-info">
                                    <CheckCheck className="size-3.5" />
                                    {reviews} 集待审阅
                                </span>
                            ) : null}
                            <span>共 {groups.length} 类</span>
                        </div>
                    ) : null}
                    {failures ? (
                        <Button className="!ml-auto" icon={<RotateCcw className="size-4" />} loading={retrying} onClick={onRetryAll}>
                            全部重试
                        </Button>
                    ) : null}
                </div>
                <div className="drama-view-scroll thin-scrollbar">
                    {groups.length ? (
                        <div className="drama-inbox">
                            {groups.map((group) => {
                                const retryable = group.kind === "cast_failed" || group.kind === "segment_failed";
                                return (
                                    <article key={group.key} className={`drama-inbox-card is-${group.severity}`}>
                                        <header className="drama-inbox-card-head">
                                            <span className={`drama-inbox-icon is-${group.severity}`}>{GROUP_ICON[group.kind]}</span>
                                            <div className="min-w-0 flex-1">
                                                <h3>{group.title}</h3>
                                                {group.kind === "review" ? (
                                                    <p>核对各段视频提示词与参考图后继续生成视频</p>
                                                ) : group.kind === "cast_failed" ? (
                                                    <p>可修改外观描述后重新生成，或直接重试</p>
                                                ) : group.kind === "media_ready" ? (
                                                    <p>{group.items[0].detail}</p>
                                                ) : null}
                                            </div>
                                            <div className="drama-inbox-card-actions">
                                                {group.kind === "paused" ? (
                                                    <Button size="small" onClick={onOpenSettings}>
                                                        去设置
                                                    </Button>
                                                ) : null}
                                                {group.kind === "media_ready" ? (
                                                    <Button size="small" type="primary" icon={<Play className="size-3.5" />} loading={releasing} onClick={onReleaseAll}>
                                                        全部开始生成
                                                    </Button>
                                                ) : null}
                                                {retryable ? (
                                                    <Button size="small" icon={<RotateCcw className="size-3.5" />} loading={retryingGroup === group.key} onClick={() => onRetryGroup(group.key, group.items)}>
                                                        重试{group.items.length > 1 ? ` ${group.items.length} 项` : ""}
                                                    </Button>
                                                ) : null}
                                                {group.items.length === 1 && group.kind !== "paused" && group.kind !== "media_ready" ? (
                                                    <Button size="small" type={group.kind === "review" ? "primary" : "default"} onClick={() => onOpen(group.items[0])}>
                                                        {group.kind === "review" ? "去审阅" : "查看"}
                                                        <ArrowRight className="size-3.5" />
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </header>
                                        {group.reason && group.kind !== "media_ready" ? (
                                            <div className="drama-inbox-reason" title={group.reason}>
                                                <span>原因</span>
                                                <code>{group.reason}</code>
                                            </div>
                                        ) : null}
                                        {group.items.length > 1 || group.kind === "cast_failed" ? (
                                            <div className="drama-inbox-chips">
                                                {group.items.slice(0, CHIP_LIMIT).map((item) => (
                                                    <InboxChip key={item.id} item={item} cast={item.castId ? castById.get(item.castId) : undefined} onOpen={onOpen} />
                                                ))}
                                                {group.items.length > CHIP_LIMIT ? <span className="drama-inbox-more">另有 {group.items.length - CHIP_LIMIT} 项</span> : null}
                                            </div>
                                        ) : null}
                                    </article>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="drama-empty is-tall">
                            <Inbox className="size-8" />
                            <strong>一切顺利</strong>
                            <span>没有需要你处理的事项，流水线会在需要确认或出错时提醒你。</span>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}

function InboxChip({ item, cast, onOpen }: { item: DramaInboxItem; cast?: DramaCast; onOpen: (item: DramaInboxItem) => void }) {
    let content: ReactNode;
    if (item.kind === "cast_failed") {
        content = (
            <>
                <span className="drama-avatar">{cast?.imageResourceId ? <MediaThumb resourceId={cast.imageResourceId} alt="" /> : item.title.slice(0, 1)}</span>
                {item.title}
            </>
        );
    } else if (item.kind === "segment_failed") {
        content = (
            <>
                {item.media ? MEDIA_ICON[item.media] : null}第 {item.episodeNumber} 集 · 第 {item.segmentIndex + 1} 段
            </>
        );
    } else if (item.kind === "review") {
        content = (
            <>
                <Clapperboard className="size-3" />
                {item.title}
            </>
        );
    } else {
        content = item.title;
    }
    return (
        <button type="button" className={`drama-inbox-chip ${item.kind === "cast_failed" ? "has-avatar" : ""}`} title={item.detail} onClick={() => onOpen(item)}>
            {content}
        </button>
    );
}

// ===== 制作设置 =====

const CAPABILITY_META: Record<DramaCapability, { label: string; hint: string }> = {
    text: { label: "改编与分镜", hint: "改编剧本、拆分剧情段与镜头" },
    image: { label: "参考图", hint: "角色、道具与场景参考图" },
    video: { label: "剧情段视频", hint: "每段一个带对白与音效的视频，可按段换模型" },
};
const REVIEW_LABEL: Record<DramaReviewMode, { title: string; detail: string }> = {
    sample: { title: "先看样片", detail: "第 1 集成片确认后继续其余集" },
    every: { title: "每集确认", detail: "每集生成视频前停下来审阅段视频提示词" },
    auto: { title: "全自动", detail: "不打断，直接跑到成片" },
};
const CONCURRENCY = [2, 4, 6, 8, 12, 16];

export function SettingsPanel({ projectId, summary, cast, onChanged }: { projectId: string; summary: DramaSummary; cast: DramaCast[]; onChanged: () => void }) {
    const { message, modal } = App.useApp();
    const current = summary.production.settings;
    const [settings, setSettings] = useState(current);
    const [budget, setBudget] = useState(summary.production.budgetMicrocredits / 1_000_000);
    useEffect(() => {
        setSettings(summary.production.settings);
        setBudget(summary.production.budgetMicrocredits / 1_000_000);
    }, [summary.production.settings, summary.production.budgetMicrocredits]);
    const dirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(current) || Math.round(budget * 1_000_000) !== summary.production.budgetMicrocredits, [budget, current, settings, summary.production.budgetMicrocredits]);
    const save = useMutation({
        mutationFn: () => updateDramaSettings(projectId, { settings, budgetMicrocredits: Math.max(0, Math.round((budget || 0) * 1_000_000)) }),
        onSuccess: () => {
            message.success("设置已保存，新任务会使用新配置");
            onChanged();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存失败"),
    });
    const [restyleSegments, setRestyleSegments] = useState(true);
    const regenerateAll = useMutation({
        mutationFn: (kind: DramaCastKind) => regenerateDramaCasts(projectId, kind, restyleSegments),
        onSuccess: (result, kind) => {
            message.success(`已按当前方案重做 ${result.queued} 个${CAST_KIND_LABEL[kind]}参考图${result.skipped ? `，${result.skipped} 个已锁定或正在生成` : ""}${result.affectedSegments ? `，${result.affectedSegments} 个剧情段需重新生成` : ""}`);
            onChanged();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "操作失败"),
    });
    const catalogQuery = useDramaModelCatalog();
    const videoOption = catalogQuery.data?.options.video?.find((option) => dramaChoiceKey(option.choice) === dramaChoiceKey(settings.models.video));
    const imageOption = catalogQuery.data?.options.image?.find((option) => dramaChoiceKey(option.choice) === dramaChoiceKey(settings.models.image));
    const videoRatioProblem = dramaVideoRatioIssue(videoOption, current.aspectRatio);
    const continuity: DramaVideoContinuity = settings.videoContinuity || "tail_frame";
    const sampleCharacter = cast.find((item) => item.kind === "character" && item.appearance);
    const sampleScene = cast.find((item) => item.kind === "scene" && item.appearance);
    const countOf = (kind: DramaCastKind) => cast.filter((item) => item.kind === kind).length;
    const spent = summary.production.spentMicrocredits;
    const budgetMicro = Math.round((budget || 0) * 1_000_000);
    const usage = budgetMicro > 0 ? Math.min(1, spent / budgetMicro) : 0;
    return (
        <div className="drama-view">
            <section className="drama-view-main">
                <div className="drama-view-head">
                    <h2 className="drama-view-title">制作设置</h2>
                    <span className="drama-view-sub">{dirty ? "有未保存的修改" : "修改只影响之后新开始的任务"}</span>
                    <div className="ml-auto flex gap-2">
                        <Button
                            disabled={!dirty}
                            onClick={() => {
                                setSettings(current);
                                setBudget(summary.production.budgetMicrocredits / 1_000_000);
                            }}
                        >
                            还原
                        </Button>
                        <Button type="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                            保存设置
                        </Button>
                    </div>
                </div>
                <div className="drama-view-scroll thin-scrollbar">
                    <div className="drama-cfg">
                        <div className="drama-cfg-main">
                            <EpisodeModeCard summary={summary} settings={settings} onChange={(patch) => setSettings({ ...settings, ...patch })} />
                            <section className="drama-cfg-card">
                                <SettingsTitle title="分镜规则" detail="对之后改编的集生效；已改编的集可在剧本页“重新改编”" icon={<Clapperboard className="size-4" />} />
                                <StoryboardRules
                                    value={settings.storyboard}
                                    onChange={(storyboard) => setSettings({ ...settings, storyboard })}
                                    episodeSeconds={settings.episodeSeconds}
                                    onEpisodeSecondsChange={(episodeSeconds) => setSettings({ ...settings, episodeSeconds })}
                                    maxVideoSeconds={videoOption?.maxVideoSeconds}
                                    videoModelLabel={settings.models.video?.label}
                                    bare
                                />
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title="视频提示词技能" detail="撰写剧情段视频提示词时遵循的写作方法；对之后撰写的段生效" icon={<ScrollText className="size-4" />} />
                                <PromptSkillField value={settings.promptSkill} onChange={(promptSkill) => setSettings({ ...settings, promptSkill })} />
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title="参考图方案" detail="参考图随剧情段视频请求一起发送，是人物与道具保持一致的锚点；修改只影响之后生成的参考图" icon={<UsersRound className="size-4" />} />
                                <AssetSchemePicker
                                    value={settings.assets}
                                    onChange={(assets) => setSettings({ ...settings, assets })}
                                    sample={{ style: settings.stylePrompt, characterName: sampleCharacter?.name, characterAppearance: sampleCharacter?.appearance, sceneName: sampleScene?.name, sceneAppearance: sampleScene?.appearance }}
                                    imageModel={imageOption}
                                />
                                <div className="drama-settings-regen">
                                    <div>
                                        <strong>按当前方案重做已有参考图</strong>
                                        <span>
                                            {CAST_KINDS.map((kind) => `${countOf(kind)} 个${CAST_KIND_LABEL[kind]}`).join(" · ")}；锁定的设定不会变。{dirty ? "请先保存设置。" : ""}
                                        </span>
                                    </div>
                                    <Checkbox checked={restyleSegments} onChange={(event) => setRestyleSegments(event.target.checked)}>
                                        同时让引用它们的剧情段视频重新生成
                                    </Checkbox>
                                    {CAST_KINDS.map((kind) => (
                                        <Button
                                            key={kind}
                                            disabled={dirty || !countOf(kind)}
                                            loading={regenerateAll.isPending && regenerateAll.variables === kind}
                                            onClick={() =>
                                                modal.confirm({
                                                    title: `按当前方案重做 ${countOf(kind)} 个${CAST_KIND_LABEL[kind]}参考图？`,
                                                    content: `每张参考图都会重新生成并计费${restyleSegments ? "，引用它们且已生成的剧情段视频需要重新生成" : ""}。旧版本保留在版本记录中。`,
                                                    okText: "开始重做",
                                                    cancelText: "取消",
                                                    centered: true,
                                                    onOk: () => regenerateAll.mutateAsync(kind),
                                                })
                                            }
                                        >
                                            重做{CAST_KIND_LABEL[kind]}
                                        </Button>
                                    ))}
                                </div>
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title="制作模型" detail="只列出平台可无人值守执行的模型" icon={<Cpu className="size-4" />} />
                                <div className="drama-cfg-models">
                                    {(Object.keys(CAPABILITY_META) as DramaCapability[]).map((capability) => (
                                        <div key={capability} className="drama-cfg-model">
                                            <div className="drama-cfg-model-label">
                                                <strong>{CAPABILITY_META[capability].label}</strong>
                                                <small>{CAPABILITY_META[capability].hint}</small>
                                            </div>
                                            <DramaModelPicker
                                                capability={capability}
                                                value={settings.models[capability]}
                                                aspectRatio={current.aspectRatio}
                                                placeholder={`选择${CAPABILITY_META[capability].label}模型`}
                                                onChange={(choice) => setSettings({ ...settings, models: { ...settings.models, [capability]: choice } })}
                                            />
                                        </div>
                                    ))}
                                </div>
                                {videoRatioProblem ? <p className="drama-cfg-note">当前视频模型{videoRatioProblem}，剧情段视频无法提交，请换模型。</p> : null}
                                {videoOption?.generateAudio === false ? <p className="drama-cfg-note">当前视频模型不同步生成声音，剧情段视频没有对白与音效。</p> : null}
                            </section>
                        </div>
                        <aside className="drama-cfg-side">
                            <section className="drama-cfg-card">
                                <SettingsTitle title="作品" detail="开工时确定" />
                                <dl className="drama-cfg-kv">
                                    <div>
                                        <dt>画幅</dt>
                                        <dd>{current.aspectRatio}</dd>
                                    </div>
                                    <div>
                                        <dt>视觉风格</dt>
                                        <dd title={current.styleName}>{current.styleName || "—"}</dd>
                                    </div>
                                    <div>
                                        <dt>对白语言</dt>
                                        <dd>{current.language}</dd>
                                    </div>
                                </dl>
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title="审阅方式" detail="只在关键点打断你" />
                                <CompactRadios
                                    label="审阅方式"
                                    value={settings.reviewMode}
                                    options={(Object.keys(REVIEW_LABEL) as DramaReviewMode[]).map((mode) => ({ value: mode, ...REVIEW_LABEL[mode] }))}
                                    onChange={(reviewMode) => setSettings({ ...settings, reviewMode })}
                                />
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title="生成节奏" detail={settings.mediaMode === "manual" ? `${summary.episodes.filter((episode) => episode.awaitingMedia).length} 集等待生成视频` : undefined} />
                                <CompactRadios
                                    label="生成节奏"
                                    value={settings.mediaMode}
                                    options={(Object.keys(MEDIA_MODE_LABEL) as DramaMediaMode[]).map((mode) => ({ value: mode, ...MEDIA_MODE_LABEL[mode] }))}
                                    onChange={(mediaMode) => setSettings({ ...settings, mediaMode })}
                                />
                                {settings.mediaMode !== current.mediaMode && settings.mediaMode === "manual" ? <p className="drama-cfg-note">改为手动后，未放行的集停在当前阶段，已提交的任务会做完。</p> : null}
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title="段落衔接" detail="决定同一集的剧情段能否同时生成" />
                                <CompactRadios
                                    label="段落衔接"
                                    value={continuity}
                                    options={(Object.keys(VIDEO_CONTINUITY_LABEL) as DramaVideoContinuity[]).map((mode) => ({ value: mode, ...VIDEO_CONTINUITY_LABEL[mode] }))}
                                    onChange={(videoContinuity) => setSettings({ ...settings, videoContinuity })}
                                />
                                {continuity === "tail_frame" && videoOption && !videoOption.tailFrameChain ? <p className="drama-cfg-note">当前视频模型不支持图生视频，无法尾帧续接，请改用并行出片或换模型。</p> : null}
                                {continuity !== (current.videoContinuity || "tail_frame") ? <p className="drama-cfg-note">已写好的段视频提示词按原方式撰写，切换后可在剧情段里重新撰写；已提交的视频会做完。</p> : null}
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title="同时生成数" detail="受账号并发上限约束" />
                                <div className="drama-tabs drama-cfg-seg" role="radiogroup" aria-label="同时生成数">
                                    {CONCURRENCY.map((value) => (
                                        <button key={value} type="button" role="radio" className="drama-tab" aria-checked={settings.concurrency === value} onClick={() => setSettings({ ...settings, concurrency: value })}>
                                            {value}
                                        </button>
                                    ))}
                                </div>
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title="每段最多参考图" detail="自动取参考图时的上限，人物优先；0 为按视频模型上限" />
                                <InputNumber className="!w-full" min={0} max={20} precision={0} value={settings.referenceLimit || 0} onChange={(value) => setSettings({ ...settings, referenceLimit: value || 0 })} suffix="张" aria-label="每段最多参考图" />
                                <p className="drama-cfg-note">超出的设定按文字描述生成，不附图。个别段需要更多参考图时，在剧情段弹窗里手动指定，只受模型上限约束。</p>
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title="预算上限" detail="0 表示不限，含精修画布花费；达到后暂停，画布上也不能再生成" />
                                <InputNumber className="!w-full" min={0} precision={0} value={budget} onChange={(value) => setBudget(value || 0)} suffix="积分" aria-label="预算上限" />
                                <div className="drama-budget-meter">
                                    <div className="drama-budget-track">
                                        <span className={usage >= 0.9 ? "is-warn" : ""} style={progressFillStyle(budgetMicro ? Math.max(usage * 100, spent ? 2 : 0) : 0)} />
                                    </div>
                                    <span>
                                        已花费 <b>{formatCredits(spent)}</b>
                                        {budgetMicro ? ` / ${formatCredits(budgetMicro)}` : " · 不限预算"}
                                    </span>
                                </div>
                                {summary.production.canvasSpentMicrocredits > 0 ? (
                                    <p className="drama-cfg-note">
                                        其中流水线 {formatCredits(Math.max(0, spent - summary.production.canvasSpentMicrocredits))}，精修画布 {formatCredits(summary.production.canvasSpentMicrocredits)}。
                                    </p>
                                ) : null}
                            </section>
                        </aside>
                    </div>
                </div>
            </section>
        </div>
    );
}

const EPISODE_MODE_OPTIONS: Array<{ value: DramaEpisodeMode; title: string; detail: string }> = [
    { value: "chapter", title: "按章分集", detail: "按章节顺序固定分集，每 N 章一集" },
    { value: "auto", title: "模型自动分集", detail: "按剧情把章节规划成集，可合并或拆分章节" },
];

/**
 * 分集方式：只影响还没分集的章节。分集完成后已有的集可能写好了剧本，不再重新分组，
 * 之后用“逐集追加”继续；剧本与分镜作品总是每章一集。
 */
function EpisodeModeCard({ summary, settings, onChange }: { summary: DramaSummary; settings: DramaSettings; onChange: (patch: Pick<DramaSettings, "episodeMode" | "chaptersPerEpisode">) => void }) {
    const { production, episodes } = summary;
    const novel = (summary.project.sourceType || "novel") === "novel";
    const editable = novel && !production.planDone;
    const mode = settings.episodeMode || (production.planDone ? undefined : "auto");
    const perEpisode = settings.chaptersPerEpisode || 1;
    const current = !novel ? "每章一集（剧本与分镜按标题分集）" : settings.episodeMode === "chapter" ? (perEpisode > 1 ? `按章分集 · 每 ${perEpisode} 章一集` : "按章分集 · 每章一集") : settings.episodeMode === "auto" ? "模型自动分集" : "已分集";
    return (
        <section className="drama-cfg-card">
            <SettingsTitle title="分集方式" detail={editable ? "只影响还没分集的章节，保存后下一轮调度生效" : "分集已完成，不能再调整；之后可在制作台逐集追加新的一集"} icon={<Film className="size-4" />} />
            {editable ? (
                <div className="grid gap-3">
                    <CompactRadios label="分集方式" value={mode || "auto"} options={EPISODE_MODE_OPTIONS} onChange={(value) => onChange({ episodeMode: value, chaptersPerEpisode: value === "chapter" ? perEpisode : undefined })} />
                    {mode === "chapter" ? <EpisodeGroupField value={perEpisode} onChange={(value) => onChange({ episodeMode: "chapter", chaptersPerEpisode: value })} chapterCount={Math.max(0, production.chapterCount - production.planCursor)} /> : null}
                    {production.planCursor > 0 ? (
                        <p className="drama-cfg-note">
                            前 {production.planCursor} 章已分成 {episodes.length} 集，保持不变。
                        </p>
                    ) : null}
                </div>
            ) : (
                <p className="drama-cfg-note">
                    {current} · 共 {production.chapterCount} 章 {episodes.length} 集
                </p>
            )}
        </section>
    );
}

/** 侧栏里的紧凑单选列表：一行标题，说明作为次要文字，选中态只改边框和底色。 */
function CompactRadios<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: Array<{ value: V; title: string; detail: string }>; onChange: (value: V) => void }) {
    return (
        <div className="drama-cfg-radios" role="radiogroup" aria-label={label}>
            {options.map((option) => (
                <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className="drama-cfg-radio" onClick={() => onChange(option.value)}>
                    <span className="drama-radio" aria-hidden />
                    <span className="min-w-0">
                        <strong>{option.title}</strong>
                        <small>{option.detail}</small>
                    </span>
                </button>
            ))}
        </div>
    );
}

function SettingsTitle({ title, detail, icon }: { title: string; detail?: string; icon?: ReactNode }) {
    return (
        <div className="drama-settings-title">
            <h3>
                {icon}
                {title}
            </h3>
            {detail ? <span>{detail}</span> : null}
        </div>
    );
}
