import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Popconfirm } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { Check, Copy, ImageOff, LoaderCircle, SquareArrowOutUpRight, Trash2, X } from "lucide-react";
import copyToClipboard from "copy-to-clipboard";
import { useTranslation } from "react-i18next";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { CanvasVideoPreviewImage } from "@/components/canvas/canvas-video-preview-image";
import { useVideoPlaybackUrl } from "@/components/canvas/canvas-node-media-content";
import { Kbd } from "@/components/ui/base/kbd";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal";
import { currentMediaVersion, listMediaVersions, MEDIA_VERSION_LIMIT, mediaVersionAdoptBlock, mediaVersionPreviewNode } from "@/lib/canvas/canvas-media-versions";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/relative-time";
import { resolveMediaUrl } from "@/services/file-storage";
import { currentLocale, translate } from "@/i18n";
import { CanvasNodeType, type CanvasMediaVersion, type CanvasNodeData } from "@/types/canvas";

type CanvasMediaVersionModalProps = {
    node: CanvasNodeData | null;
    onClose: () => void;
    onAdopt: (nodeId: string, versionId: string) => boolean;
    onDelete: (nodeId: string, versionId: string) => boolean;
    onExtract: (nodeId: string, versionId: string) => void;
};

type ViewMode = "single" | "compare";

const BLOCK_REASON = {
    locked: "canvasB.mediaVersion.blockLocked",
    loading: "canvasB.mediaVersion.blockLoading",
    missing: "canvasB.mediaVersion.blockMissing",
} as const;

/** 媒体版本面板：缩略图条悬停即预览，选中后再切换，避免误改节点。 */
export function CanvasMediaVersionModal({ node, onClose, onAdopt, onDelete, onExtract }: CanvasMediaVersionModalProps) {
    return (
        <AppModal flush open={Boolean(node)} centered title={null} closable={false} footer={null} width={940} onCancel={onClose}>
            {node ? <MediaVersionPanel node={node} onClose={onClose} onAdopt={onAdopt} onDelete={onDelete} onExtract={onExtract} /> : null}
        </AppModal>
    );
}

function MediaVersionPanel({ node, onClose, onAdopt, onDelete, onExtract }: Omit<CanvasMediaVersionModalProps, "node"> & { node: CanvasNodeData }) {
    const { t } = useTranslation();
    const versions = useMemo(() => listMediaVersions(node), [node]);
    const current = useMemo(() => currentMediaVersion(node), [node]);
    const [selectedId, setSelectedId] = useState(() => current?.id || versions[versions.length - 1]?.id || "");
    const [hoverId, setHoverId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>("single");
    const rootRef = useRef<HTMLDivElement>(null);
    const stripRef = useRef<HTMLDivElement>(null);

    const selected = versions.find((version) => version.id === selectedId) || current || versions[versions.length - 1];
    const previewed = versions.find((version) => version.id === hoverId) || selected;
    const isImage = node.type === CanvasNodeType.Image;
    const generating = node.metadata?.status === "loading";
    const adoptBlock = mediaVersionAdoptBlock(node);
    const selectedIsCurrent = Boolean(selected && selected.id === current?.id);
    const canCompare = isImage && Boolean(current) && !selectedIsCurrent;
    const comparing = viewMode === "compare" && canCompare && previewed?.id !== current?.id;

    useEffect(() => {
        const frame = requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));
        return () => cancelAnimationFrame(frame);
    }, []);

    useEffect(() => {
        if (!selectedId) return;
        stripRef.current?.querySelector<HTMLElement>(`[data-version-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [selectedId]);

    const adopt = useCallback(() => {
        if (!selected || selectedIsCurrent || adoptBlock) return;
        if (onAdopt(node.id, selected.id)) onClose();
    }, [adoptBlock, node.id, onAdopt, onClose, selected, selectedIsCurrent]);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        // 面板快捷键不能透传给画布，否则方向键会移动选中的节点。
        if ((event.target as HTMLElement).closest("input, textarea, [role='slider']")) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            const index = versions.findIndex((version) => version.id === selected?.id);
            const next = versions[Math.min(versions.length - 1, Math.max(0, index + (event.key === "ArrowRight" ? 1 : -1)))];
            if (next) {
                setHoverId(null);
                setSelectedId(next.id);
                // 焦点在缩略图上时跟随移动，屏幕阅读器能读到新选中的版本。
                if ((event.target as HTMLElement).closest("[role='option']")) stripRef.current?.querySelector<HTMLElement>(`[data-version-id="${next.id}"]`)?.focus({ preventScroll: true });
            }
            return;
        }
        const onOtherButton = (event.target as HTMLElement).closest("button:not([role='option'])");
        if (event.key === "Enter" && !onOtherButton) {
            event.preventDefault();
            event.stopPropagation();
            adopt();
        }
    };

    if (!selected || !previewed) {
        return (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <ImageOff className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t("canvasB.mediaVersion.noVersions")}</p>
                <Button onClick={onClose}>{t("common.close")}</Button>
            </div>
        );
    }

    return (
        <div ref={rootRef} tabIndex={-1} className="flex max-h-[calc(100vh-48px)] flex-col outline-none" onKeyDown={handleKeyDown}>
            <header className="flex items-center gap-3 px-6 pb-4 pt-5">
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <h2 className="m-0 shrink-0 text-[length:var(--fs-heading)] font-semibold text-foreground">{t("canvasB.mediaVersion.title")}</h2>
                    <span className="truncate text-sm text-muted-foreground" title={node.title}>
                        {node.title}
                    </span>
                </div>
                {isImage ? (
                    <Tooltip title={canCompare ? undefined : t("canvasB.mediaVersion.compareHint")}>
                        <span>
                            <SegmentedControl<ViewMode>
                                size="sm"
                                value={canCompare ? viewMode : "single"}
                                disabled={!canCompare}
                                onChange={setViewMode}
                                options={[
                                    { value: "single", label: t("canvasB.mediaVersion.single") },
                                    { value: "compare", label: t("canvasB.mediaVersion.compareCurrent") },
                                ]}
                            />
                        </span>
                    </Tooltip>
                ) : null}
                <button
                    type="button"
                    aria-label={t("common.close")}
                    className="grid size-8 shrink-0 place-items-center rounded-[var(--r-md)] text-muted-foreground outline-none transition-colors hover:bg-[var(--control-selected-bg)] hover:text-foreground focus-visible:ring-2"
                    onClick={onClose}
                >
                    <X className="size-4" />
                </button>
            </header>

            <div className="grid min-h-0 grid-cols-1 gap-5 overflow-y-auto px-6 md:grid-cols-[minmax(0,1fr)_256px]">
                <VersionStage node={node} version={previewed} current={current} comparing={comparing} />
                <VersionDetails node={node} version={previewed} current={current} />
            </div>

            <section className="px-6 pt-5" aria-label={t("canvasB.mediaVersion.allVersions")}>
                <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">
                        {t("canvasB.mediaVersion.allVersions")} <span className="ml-1 text-muted-foreground">{versions.length}</span>
                    </span>
                    <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                        {t("canvasB.mediaVersion.hoverPreview")}
                        <span aria-hidden>·</span>
                        <Kbd>←</Kbd>
                        <Kbd>→</Kbd> {t("canvasB.mediaVersion.browse")}
                        <span aria-hidden>·</span>
                        <Kbd>Enter</Kbd> {t("canvasB.mediaVersion.switch")}
                    </span>
                </div>
                <div ref={stripRef} role="listbox" aria-label={t("canvasB.mediaVersion.versionList")} aria-orientation="horizontal" className="thin-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-2 pt-1" onPointerLeave={() => setHoverId(null)}>
                    {versions.map((version) => (
                        <VersionThumb
                            key={version.id}
                            node={node}
                            version={version}
                            selected={version.id === selected.id}
                            current={version.id === current?.id}
                            onHover={() => setHoverId(version.id)}
                            onSelect={() => {
                                setHoverId(null);
                                setSelectedId(version.id);
                            }}
                            onAdopt={() => {
                                if (version.id === current?.id || adoptBlock) return;
                                if (onAdopt(node.id, version.id)) onClose();
                            }}
                        />
                    ))}
                    {generating ? <PendingThumb progress={node.metadata?.taskProgress} number={(versions[versions.length - 1]?.number || 0) + 1} /> : null}
                </div>
            </section>

            <footer className="mt-3 flex flex-wrap items-center gap-3 border-t border-[color:var(--workspace-border)] px-6 py-4">
                <div className="flex items-center gap-1">
                    <Button type="text" size="small" icon={<SquareArrowOutUpRight className="size-3.5" />} onClick={() => onExtract(node.id, selected.id)}>
                        {t("canvasB.mediaVersion.saveAsNode")}
                    </Button>
                    <Popconfirm
                        title={t("canvasB.mediaVersion.deleteConfirm", { number: selected.number })}
                        description={t("canvasB.mediaVersion.deleteDescription")}
                        okText={t("common.delete")}
                        okButtonProps={{ danger: true }}
                        cancelText={t("common.cancel")}
                        disabled={selectedIsCurrent || Boolean(adoptBlock)}
                        onConfirm={() => {
                            if (onDelete(node.id, selected.id)) setSelectedId(current?.id || "");
                        }}
                    >
                        <Tooltip title={selectedIsCurrent ? t("canvasB.mediaVersion.currentCannotDelete") : adoptBlock ? t(BLOCK_REASON[adoptBlock]) : undefined}>
                            <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} disabled={selectedIsCurrent || Boolean(adoptBlock)}>
                                {t("canvasB.mediaVersion.deleteVersion")}
                            </Button>
                        </Tooltip>
                    </Popconfirm>
                </div>
                <span className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground">{adoptBlock ? t(BLOCK_REASON[adoptBlock]) : t("canvasB.mediaVersion.footerHint", { limit: MEDIA_VERSION_LIMIT })}</span>
                <div className="flex items-center gap-2">
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" disabled={selectedIsCurrent || Boolean(adoptBlock)} onClick={adopt}>
                        {selectedIsCurrent ? t("canvasB.mediaVersion.alreadyCurrent") : t("canvasB.mediaVersion.switchTo", { number: selected.number })}
                    </Button>
                </div>
            </footer>
        </div>
    );
}

function VersionStage({ node, version, current, comparing }: { node: CanvasNodeData; version: CanvasMediaVersion; current?: CanvasMediaVersion; comparing: boolean }) {
    const { t } = useTranslation();
    const isCurrent = version.id === current?.id;
    return (
        <div className="relative h-[clamp(240px,46vh,400px)] overflow-hidden rounded-[var(--r-xl)] bg-[var(--media-surface)]">
            {comparing && current ? (
                <CompareStage node={node} version={version} current={current} />
            ) : (
                <>
                    <StageMedia node={node} version={version} />
                    <StageBadge className="left-3 top-3">
                        {isCurrent ? <Check className="size-3" /> : null}V{version.number}
                        {isCurrent ? t("canvasB.mediaVersion.currentSuffix") : t("canvasB.mediaVersion.previewSuffix")}
                    </StageBadge>
                </>
            )}
        </div>
    );
}

function StageMedia({ node, version }: { node: CanvasNodeData; version: CanvasMediaVersion }) {
    const preview = useMemo(() => mediaVersionPreviewNode(node, version), [node, version]);
    if (node.type === CanvasNodeType.Video) return <StageVideo node={preview} />;
    if (node.type === CanvasNodeType.Audio) return <StageAudio node={preview} />;
    return (
        <CachedResourceImage
            key={version.id}
            storageKey={version.media.storageKey}
            src={version.media.content || version.media.previewContent}
            eager
            alt={`V${version.number}`}
            draggable={false}
            className="block size-full select-none object-contain"
            fallback={<MediaUnavailable />}
            loadingFallback={<LoaderCircle className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none" />}
        />
    );
}

function StageVideo({ node }: { node: CanvasNodeData }) {
    const { url, loading, onError } = useVideoPlaybackUrl(node, true);
    if (!url) return loading ? <LoaderCircle className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none" /> : <MediaUnavailable />;
    return <video key={url} src={url} controls playsInline preload="metadata" className="block size-full object-contain" onError={onError} />;
}

function StageAudio({ node }: { node: CanvasNodeData }) {
    const url = useResolvedMediaUrl(node.metadata?.storageKey, node.metadata?.content || "");
    return (
        <div className="flex size-full flex-col items-center justify-center gap-6 px-10">
            <Waveform peaks={node.metadata?.waveform} seed={node.id} className="h-24 w-full" />
            {url ? <audio key={url} src={url} controls preload="metadata" className="w-full max-w-md" /> : <MediaUnavailable />}
        </div>
    );
}

function useResolvedMediaUrl(storageKey: string | undefined, fallback: string) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        let cancelled = false;
        void resolveMediaUrl(storageKey, fallback)
            .then((resolved) => {
                if (!cancelled) setUrl(resolved);
            })
            .catch(() => {
                if (!cancelled) setUrl(fallback);
            });
        return () => {
            cancelled = true;
        };
    }, [fallback, storageKey]);
    return url;
}

/** 左侧为预览版本、右侧为当前版本，拖动分隔线比较同一位置的差异。 */
function CompareStage({ node, version, current }: { node: CanvasNodeData; version: CanvasMediaVersion; current: CanvasMediaVersion }) {
    const { t } = useTranslation();
    const [split, setSplit] = useState(50);
    const stageRef = useRef<HTMLDivElement>(null);
    const updateFromPointer = (event: ReactPointerEvent) => {
        const rect = stageRef.current?.getBoundingClientRect();
        if (!rect?.width) return;
        setSplit(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)));
    };
    return (
        <div
            ref={stageRef}
            className="relative size-full cursor-ew-resize touch-none select-none"
            onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                updateFromPointer(event);
            }}
            onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
            }}
        >
            <div className="absolute inset-0">
                <StageMedia node={node} version={current} />
            </div>
            <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
                <StageMedia node={node} version={version} />
            </div>
            <div
                role="slider"
                tabIndex={0}
                aria-label={t("canvasB.mediaVersion.compareDivider")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(split)}
                className="absolute inset-y-0 z-[1] w-0.5 -translate-x-1/2 bg-[var(--btn-solid-bg)] outline-none focus-visible:ring-2"
                style={{ left: `${split}%` }}
                onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    event.stopPropagation();
                    setSplit((value) => Math.min(100, Math.max(0, value + (event.key === "ArrowRight" ? 5 : -5))));
                }}
            >
                <span className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--btn-solid-bg)] text-[var(--btn-solid-fg)] shadow-[var(--elevation-card)]">
                    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M6 4 2 8l4 4M10 4l4 4-4 4" />
                    </svg>
                </span>
            </div>
            <StageBadge className="bottom-3 left-3">{t("canvasB.mediaVersion.badgePreview", { number: version.number })}</StageBadge>
            <StageBadge className="bottom-3 right-3">
                <Check className="size-3" />
                {t("canvasB.mediaVersion.badgeCurrent", { number: current.number })}
            </StageBadge>
        </div>
    );
}

function StageBadge({ className, children }: { className: string; children: ReactNode }) {
    return <span className={`pointer-events-none absolute z-[2] inline-flex h-6 items-center gap-1 rounded-[var(--r-sm)] bg-black/55 px-2 text-xs font-medium text-white backdrop-blur-md ${className}`}>{children}</span>;
}

function MediaUnavailable() {
    const { t } = useTranslation();
    return (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <ImageOff className="size-5" />
            {t("canvasB.mediaVersion.mediaUnavailable")}
        </span>
    );
}

function VersionDetails({ node, version, current }: { node: CanvasNodeData; version: CanvasMediaVersion; current?: CanvasMediaVersion }) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    const prompt = version.generation?.prompt?.trim() || "";
    const promptDiffers = Boolean(current && version.id !== current.id && prompt && prompt !== (current.generation?.prompt?.trim() || ""));
    const { media, generation } = version;
    const rows: Array<[string, string]> = [];
    const model = generation?.producedModel || generation?.model;
    if (model) rows.push([t("canvasB.mediaVersion.rowModel"), model]);
    const resolution = media.naturalWidth && media.naturalHeight ? `${media.naturalWidth}×${media.naturalHeight}` : "";
    const ratio = generation?.size && generation.size !== "auto" ? generation.size : "";
    if (ratio || resolution) rows.push([t("canvasB.mediaVersion.rowRatio"), [ratio, resolution].filter(Boolean).join(" · ")]);
    if (media.durationMs && node.type !== CanvasNodeType.Image) rows.push([t("canvasB.mediaVersion.rowDuration"), formatSeconds(media.durationMs)]);
    if (generation?.taskDurationMs) rows.push([t("canvasB.mediaVersion.rowTaskDuration"), formatSeconds(generation.taskDurationMs)]);
    if (generation?.references?.length) rows.push([t("canvasB.mediaVersion.rowReferences"), t("canvasB.mediaVersion.referenceCount", { count: generation.references.length })]);
    if (media.bytes) rows.push([t("canvasB.mediaVersion.rowFileSize"), formatBytes(media.bytes)]);

    useEffect(() => {
        setExpanded(false);
        setCopied(false);
    }, [version.id]);

    return (
        <aside className="flex min-w-0 flex-col" aria-label={t("canvasB.mediaVersion.versionInfo", { number: version.number })}>
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[length:var(--fs-title)] font-semibold leading-none text-foreground">V{version.number}</span>
                <span className="text-xs text-muted-foreground">{formatRelativeTime(version.createdAt)}</span>
            </div>
            <span className="mt-2 text-xs text-muted-foreground">
                {formatAbsoluteDateTime(version.createdAt)} · {version.source === "upload" ? t("canvasB.mediaVersion.sourceUpload") : t("canvasB.mediaVersion.sourceGenerate")}
                {version.id === current?.id ? t("canvasB.mediaVersion.currentSuffix") : ""}
            </span>
            {rows.length ? (
                <dl className="m-0 mt-4 flex flex-col gap-2 border-t border-[color:var(--workspace-border)] pt-4 text-[var(--fs-ui)]">
                    {rows.map(([label, value]) => (
                        <div key={label} className="flex items-baseline justify-between gap-3">
                            <dt className="shrink-0 text-muted-foreground">{label}</dt>
                            <dd className="m-0 min-w-0 truncate text-right text-foreground" title={value}>
                                {value}
                            </dd>
                        </div>
                    ))}
                </dl>
            ) : null}
            <div className="mt-4 flex min-h-0 flex-col border-t border-[color:var(--workspace-border)] pt-4">
                <div className="mb-2 flex items-center gap-2 text-[var(--fs-ui)]">
                    <span className="text-muted-foreground">{t("canvasB.mediaVersion.prompt")}</span>
                    {promptDiffers ? <span className="rounded-[var(--r-xs)] bg-[var(--control-selected-bg)] px-2 py-0.5 text-[length:var(--fs-tiny)] text-foreground/75">{t("canvasB.mediaVersion.differsFromCurrent")}</span> : null}
                </div>
                {prompt ? (
                    <>
                        <p className={`m-0 whitespace-pre-wrap break-words text-[var(--fs-ui)] leading-relaxed text-foreground/80 ${expanded ? "max-h-48 overflow-y-auto thin-scrollbar" : "line-clamp-5"}`}>{prompt}</p>
                        <div className="mt-2 flex items-center gap-3 text-xs">
                            <button
                                type="button"
                                className="inline-flex items-center gap-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:underline"
                                onClick={() => {
                                    copyToClipboard(prompt);
                                    setCopied(true);
                                }}
                            >
                                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                                {copied ? t("canvasB.common.copied") : t("canvasB.mediaVersion.copyPrompt")}
                            </button>
                            {prompt.length > 90 ? (
                                <button type="button" className="text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:underline" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
                                    {expanded ? t("canvasB.mediaVersion.collapse") : t("canvasB.mediaVersion.expandAll")}
                                </button>
                            ) : null}
                        </div>
                    </>
                ) : (
                    <p className="m-0 text-[var(--fs-ui)] text-muted-foreground">{version.source === "upload" ? t("canvasB.mediaVersion.uploadNoPrompt") : t("canvasB.mediaVersion.noPrompt")}</p>
                )}
            </div>
        </aside>
    );
}

function VersionThumb({ node, version, selected, current, onHover, onSelect, onAdopt }: { node: CanvasNodeData; version: CanvasMediaVersion; selected: boolean; current: boolean; onHover: () => void; onSelect: () => void; onAdopt: () => void }) {
    const { t } = useTranslation();
    const preview = useMemo(() => mediaVersionPreviewNode(node, version), [node, version]);
    return (
        <button
            type="button"
            role="option"
            aria-selected={selected}
            data-version-id={version.id}
            title={current ? t("canvasB.mediaVersion.thumbCurrent", { number: version.number }) : t("canvasB.mediaVersion.thumbDoubleClick", { number: version.number })}
            className="group flex w-32 shrink-0 flex-col gap-2 text-left outline-none"
            onPointerEnter={onHover}
            onFocus={onSelect}
            onClick={onSelect}
            onDoubleClick={onAdopt}
        >
            <span
                className={`relative block h-[72px] w-full overflow-hidden rounded-[var(--r-md)] bg-[var(--media-surface)] ring-offset-2 ring-offset-[var(--card-surface)] transition-shadow duration-[var(--motion-state)] group-focus-visible:ring-2 ${selected ? "ring-2 ring-[var(--foreground)]" : "ring-1 ring-[var(--workspace-border)] group-hover:ring-[var(--workspace-border-strong)]"}`}
            >
                {node.type === CanvasNodeType.Image ? (
                    <CachedResourceImage
                        storageKey={version.media.storageKey}
                        src={version.media.previewContent || version.media.content}
                        variant="thumbnail"
                        alt=""
                        loading="lazy"
                        draggable={false}
                        className="block size-full object-cover"
                        fallback={<ThumbFallback />}
                    />
                ) : node.type === CanvasNodeType.Video ? (
                    <CanvasVideoPreviewImage node={preview} alt="" loading="lazy" draggable={false} className="block size-full object-cover" fallback={<ThumbFallback />} />
                ) : (
                    <Waveform peaks={version.media.waveform} seed={version.id} className="absolute inset-x-3 inset-y-4" />
                )}
                {current ? (
                    <span className="absolute left-1.5 top-1.5 inline-flex h-5 items-center gap-0.5 rounded-[var(--r-xs)] bg-black/60 px-2 text-[length:var(--fs-tiny)] font-medium text-white backdrop-blur-md">
                        <Check className="size-2.5" />
                        {t("canvasB.mediaVersion.current")}
                    </span>
                ) : null}
            </span>
            <span className="flex items-baseline justify-between gap-2 px-0.5 text-xs">
                <span className={`font-semibold ${selected ? "text-foreground" : "text-foreground/75"}`}>V{version.number}</span>
                <span className="truncate text-muted-foreground">{formatThumbTime(version.createdAt)}</span>
            </span>
        </button>
    );
}

function PendingThumb({ progress, number }: { progress?: number; number: number }) {
    const { t } = useTranslation();
    const percent = typeof progress === "number" && progress > 0 ? Math.min(99, Math.round(progress)) : undefined;
    return (
        <div className="flex w-32 shrink-0 flex-col gap-2" aria-label={t("canvasB.mediaVersion.pendingLabel", { number })}>
            <span className="flex h-[72px] w-full flex-col items-center justify-center gap-2 rounded-[var(--r-md)] border border-dashed border-[color:var(--workspace-border-strong)] text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                    <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
                    {percent !== undefined ? t("canvasB.mediaVersion.generatingPercent", { percent }) : t("canvasB.mediaVersion.generating")}
                </span>
                {percent !== undefined ? (
                    <span className="h-0.5 w-20 overflow-hidden rounded-full bg-[var(--control-selected-bg)]">
                        <span className="block h-full rounded-full bg-[var(--foreground)] opacity-60" style={{ width: `${percent}%` }} />
                    </span>
                ) : null}
            </span>
            <span className="flex items-baseline justify-between px-0.5 text-xs text-muted-foreground">
                <span className="font-semibold">V{number}</span>
                <span>{t("canvasB.mediaVersion.inProgress")}</span>
            </span>
        </div>
    );
}

function ThumbFallback() {
    return (
        <span className="absolute inset-0 grid place-items-center text-muted-foreground">
            <ImageOff className="size-4" />
        </span>
    );
}

function Waveform({ peaks, seed, className }: { peaks?: number[]; seed: string; className: string }) {
    const bars = useMemo(() => normalizePeaks(peaks, seed, 48), [peaks, seed]);
    return (
        <span className={`flex items-center gap-[2px] text-foreground/45 ${className}`} aria-hidden>
            {bars.map((value, index) => (
                <span key={index} className="min-w-[2px] flex-1 rounded-full bg-current" style={{ height: `${Math.max(8, value * 100)}%` }} />
            ))}
        </span>
    );
}

function normalizePeaks(peaks: number[] | undefined, seed: string, count: number) {
    if (peaks?.length) {
        const step = peaks.length / count;
        return Array.from({ length: count }, (_, index) => Math.min(1, Math.max(0, peaks[Math.floor(index * step)] || 0)));
    }
    // 旧音频没有波形采样时用稳定的伪波形占位，避免每次渲染跳动。
    let hash = 0;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return Array.from({ length: count }, (_, index) => {
        hash = (hash * 1103515245 + 12345) >>> 0;
        return 0.25 + (((hash >>> 16) % 1000) / 1000) * 0.6 * Math.abs(Math.sin(index / 5));
    });
}

function formatThumbTime(value: string) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "";
    const date = new Date(timestamp);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay ? date.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString(currentLocale(), { month: "numeric", day: "numeric" });
}

function formatSeconds(ms: number) {
    const seconds = ms / 1000;
    return seconds >= 60 ? translate("canvasB.mediaVersion.minutesSeconds", { minutes: Math.floor(seconds / 60), seconds: Math.round(seconds % 60) }) : `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1).replace(/\.0$/, "")}s`;
}

function formatBytes(bytes: number) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}
