import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Input } from "antd";
import { Crosshair, Download, Pencil, Search, Star, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { buildCanvasAssetCatalog, CANVAS_ASSET_KIND_LABELS, type CanvasAssetEntry, type CanvasAssetGroup, type CanvasAssetKind, type CanvasAssetVersion } from "@/lib/canvas/canvas-asset-catalog";
import { mediaVersionPreviewNode } from "@/lib/canvas/canvas-media-versions";
import { currentLocale, translate } from "@/i18n";
import { formatBytes } from "@/lib/image-utils";
import type { CanvasNodeData } from "@/types/canvas";

import { canvasAssetKindIcon, canvasAssetText, CanvasAssetPreview, CanvasAssetThumbnail } from "./canvas-asset-preview";
import { ASSET_TREE_ASSET_PREFIX as ASSET_PREFIX, ASSET_TREE_KIND_PREFIX as KIND_PREFIX, ASSET_TREE_VERSION_PREFIX as VERSION_PREFIX, CanvasAssetTree } from "./canvas-asset-tree";

type CanvasAssetViewProps = {
    nodes: CanvasNodeData[];
    onLocate: (nodeId: string) => void;
    onRename: (updates: Array<{ nodeId: string; title: string }>) => void;
    onPromoteVersion: (version: CanvasAssetVersion) => void;
    onDownloadMedia: (node: CanvasNodeData) => void | Promise<void>;
    onUpload: () => void;
};

type Selection = { type: "kind"; kind: CanvasAssetKind } | { type: "asset"; entryKey: string } | { type: "version"; entryKey: string; versionKey: string };

function selectionKey(selection: Selection) {
    if (selection.type === "kind") return `${KIND_PREFIX}${selection.kind}`;
    if (selection.type === "asset") return `${ASSET_PREFIX}${selection.entryKey}`;
    return `${VERSION_PREFIX}${selection.entryKey}|${selection.versionKey}`;
}

function parseSelectionKey(key: string): Selection | null {
    if (key.startsWith(KIND_PREFIX)) return { type: "kind", kind: key.slice(KIND_PREFIX.length) as CanvasAssetKind };
    if (key.startsWith(ASSET_PREFIX)) return { type: "asset", entryKey: key.slice(ASSET_PREFIX.length) };
    if (key.startsWith(VERSION_PREFIX)) {
        const [entryKey, versionKey] = key.slice(VERSION_PREFIX.length).split("|");
        return entryKey && versionKey ? { type: "version", entryKey, versionKey } : null;
    }
    return null;
}

function matchesQuery(entry: CanvasAssetEntry, query: string) {
    return !query || entry.title.toLowerCase().includes(query) || entry.versions.some((version) => version.label.toLowerCase().includes(query));
}

/**
 * 画布的结构化资产视图：左侧按类型 → 资产 → 版本的目录，右侧是分类网格或资产详情。
 * 数据完全由当前画布节点派生；所有写操作（重命名、设为主版本）都回到画布的现有写路径。
 */
export function CanvasAssetView({ nodes, onLocate, onRename, onPromoteVersion, onDownloadMedia, onUpload }: CanvasAssetViewProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const groups = useMemo(() => buildCanvasAssetCatalog(nodes), [nodes]);
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const entryByKey = useMemo(() => new Map(groups.flatMap((group) => group.entries.map((entry) => [entry.key, entry] as const))), [groups]);
    const [queryInput, setQueryInput] = useState("");
    const query = queryInput.trim().toLowerCase();
    const [selection, setSelection] = useState<Selection>(() => ({ type: "kind", kind: groups.find((group) => group.entries.length)?.kind || "image" }));
    const [expandedKeys, setExpandedKeys] = useState<string[]>(() => groups.filter((group) => group.entries.length).map((group) => `${KIND_PREFIX}${group.kind}`));

    const visibleGroups = useMemo(() => groups.map((group) => ({ ...group, entries: group.entries.filter((entry) => matchesQuery(entry, query)) })), [groups, query]);
    const totalCount = groups.reduce((count, group) => count + group.entries.length, 0);

    // 节点被删除或归并方式变化后，选中的资产可能消失；回到它所属的分类而不是显示空详情。
    const selectedEntry = selection.type === "kind" ? undefined : entryByKey.get(selection.entryKey);
    useEffect(() => {
        if (selection.type !== "kind" && !selectedEntry) setSelection({ type: "kind", kind: "image" });
    }, [selectedEntry, selection.type]);

    // 搜索时自动展开有命中的分类，清空搜索后回到用户自己的展开状态。
    const effectiveExpandedKeys = useMemo(
        () =>
            new Set(
                query
                    ? visibleGroups
                          .filter((group) => group.entries.length)
                          .map((group) => `${KIND_PREFIX}${group.kind}`)
                          .concat(expandedKeys)
                    : expandedKeys,
            ),
        [expandedKeys, query, visibleGroups],
    );

    const select = (next: Selection) => {
        setSelection(next);
        if (next.type !== "kind") {
            const entry = entryByKey.get(next.entryKey);
            if (entry) setExpandedKeys((current) => (current.includes(`${KIND_PREFIX}${entry.kind}`) ? current : [...current, `${KIND_PREFIX}${entry.kind}`]));
        }
    };

    const download = async (node: CanvasNodeData, kind: CanvasAssetKind) => {
        try {
            if (kind === "txt" || kind === "markdown") downloadCanvasText(node, kind);
            else await onDownloadMedia(node);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvasA.assetView.downloadFailed"));
        }
    };

    return (
        <div className="canvas-asset-view flex size-full min-h-0 bg-background text-foreground" data-canvas-no-zoom data-canvas-wheel-scroll>
            <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-foreground/[.02] max-md:w-52" aria-label={t("canvasA.assetTree.label")}>
                <div className="flex h-12 shrink-0 items-center gap-2 px-4">
                    <strong className="text-sm font-semibold">{t("canvasA.assetView.title")}</strong>
                    <span className="text-xs text-muted-foreground tabular-nums">{totalCount}</span>
                    <Button className="!ml-auto" size="small" type="text" icon={<Upload className="size-3.5" />} onClick={onUpload} aria-label={t("canvasA.assetView.uploadLabel")}>
                        {t("canvasA.assetView.upload")}
                    </Button>
                </div>
                <div className="shrink-0 px-3 pb-2">
                    <Input
                        allowClear
                        size="small"
                        variant="filled"
                        className="!h-8"
                        prefix={<Search className="size-3.5 text-muted-foreground" />}
                        placeholder={t("canvasA.assetView.searchPlaceholder")}
                        aria-label={t("canvasA.assetView.searchLabel")}
                        value={queryInput}
                        onChange={(event) => setQueryInput(event.target.value)}
                    />
                </div>
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                    <CanvasAssetTree
                        groups={visibleGroups}
                        nodeById={nodeById}
                        selectedKey={selectionKey(selection)}
                        expandedKeys={effectiveExpandedKeys}
                        onSelect={(key) => {
                            const next = parseSelectionKey(key);
                            if (!next) return;
                            select(next);
                            // 选中分类或多版本资产时顺带展开，减少一次点击。
                            if (next.type === "kind" || next.type === "asset") setExpandedKeys((current) => (current.includes(key) ? current : [...current, key]));
                        }}
                        onToggle={(key, expanded) => setExpandedKeys((current) => (expanded ? (current.includes(key) ? current : [...current, key]) : current.filter((item) => item !== key)))}
                    />
                </div>
            </aside>
            <section className="flex min-w-0 flex-1 flex-col" aria-live="polite">
                {selection.type === "kind" ? (
                    <KindGrid group={visibleGroups.find((group) => group.kind === selection.kind)!} nodeById={nodeById} totalCount={totalCount} onOpen={(entry) => select({ type: "asset", entryKey: entry.key })} onLocate={onLocate} onUpload={onUpload} />
                ) : selectedEntry ? (
                    <AssetDetail
                        key={selectedEntry.key}
                        entry={selectedEntry}
                        version={selection.type === "version" ? selectedEntry.versions.find((item) => item.key === selection.versionKey) : undefined}
                        nodeById={nodeById}
                        onSelectVersion={(version) => select({ type: "version", entryKey: selectedEntry.key, versionKey: version.key })}
                        onBack={() => select({ type: "kind", kind: selectedEntry.kind })}
                        onLocate={onLocate}
                        onRename={onRename}
                        onPromoteVersion={onPromoteVersion}
                        onDownload={download}
                    />
                ) : null}
            </section>
        </div>
    );
}

function KindGrid({
    group,
    nodeById,
    totalCount,
    onOpen,
    onLocate,
    onUpload,
}: {
    group: CanvasAssetGroup;
    nodeById: Map<string, CanvasNodeData>;
    totalCount: number;
    onOpen: (entry: CanvasAssetEntry) => void;
    onLocate: (nodeId: string) => void;
    onUpload: () => void;
}) {
    const { t } = useTranslation();
    return (
        <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-5">
                {canvasAssetKindIcon(group.kind)}
                <h2 className="m-0 text-sm font-semibold">{group.label}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{group.entries.length}</span>
            </header>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
                {group.entries.length ? (
                    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-4 p-0">
                        {group.entries.map((entry) => {
                            const node = nodeById.get(entry.nodeId);
                            if (!node) return null;
                            return (
                                <li key={entry.key} className="group relative min-w-0">
                                    <button
                                        type="button"
                                        className="block w-full rounded-[var(--r-lg)] text-left focus-visible:outline-2 focus-visible:outline-offset-2"
                                        onClick={() => onOpen(entry)}
                                        onDoubleClick={() => onLocate(entry.nodeId)}
                                        title={t("canvasA.assetView.cardHint")}
                                    >
                                        <span className="block aspect-[4/3] overflow-hidden rounded-[var(--r-lg)] border border-border bg-[var(--workspace-surface)] transition-colors group-hover:border-foreground/30">
                                            <CanvasAssetThumbnail node={node} kind={entry.kind} />
                                        </span>
                                        <span className="mt-2 block truncate text-sm" title={entry.title}>
                                            {entry.title}
                                        </span>
                                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{assetSubtitle(entry, node)}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                        <span>{totalCount ? t("canvasA.assetView.emptyKind", { kind: group.label }) : t("canvasA.assetView.empty")}</span>
                        {!totalCount ? (
                            <Button icon={<Upload className="size-4" />} onClick={onUpload}>
                                {t("canvasA.assetView.uploadFiles")}
                            </Button>
                        ) : null}
                    </div>
                )}
            </div>
        </>
    );
}

function assetSubtitle(entry: CanvasAssetEntry, node: CanvasNodeData) {
    const parts: string[] = [];
    if (entry.versions.length > 1) parts.push(translate("canvasA.assetView.versionCount", { count: entry.versions.length }));
    const bytes = formatBytes(node.metadata?.bytes || 0);
    if (bytes && (entry.kind === "audio" || entry.kind === "video")) parts.push(bytes);
    if ((entry.kind === "txt" || entry.kind === "markdown") && canvasAssetText(node)) parts.push(translate("canvasA.assetView.charCount", { count: canvasAssetText(node).length }));
    if (entry.updatedAt) parts.push(formatDate(entry.updatedAt));
    return parts.join(" · ") || CANVAS_ASSET_KIND_LABELS[entry.kind];
}

function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(currentLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

type AssetDetailProps = {
    entry: CanvasAssetEntry;
    version?: CanvasAssetVersion;
    nodeById: Map<string, CanvasNodeData>;
    onSelectVersion: (version: CanvasAssetVersion) => void;
    onBack: () => void;
    onLocate: (nodeId: string) => void;
    onRename: CanvasAssetViewProps["onRename"];
    onPromoteVersion: CanvasAssetViewProps["onPromoteVersion"];
    onDownload: (node: CanvasNodeData, kind: CanvasAssetKind) => Promise<void>;
};

function AssetDetail({ entry, version, nodeById, onSelectVersion, onBack, onLocate, onRename, onPromoteVersion, onDownload }: AssetDetailProps) {
    const { t } = useTranslation();
    const activeVersion = version || entry.versions.find((item) => item.primary) || entry.versions[0];
    const baseNode = nodeById.get(activeVersion?.nodeId || entry.nodeId) || nodeById.get(entry.nodeId);
    const previewNode = useMemo(() => {
        if (!baseNode || !activeVersion?.mediaVersionId) return baseNode;
        const media = baseNode.metadata?.mediaVersions?.find((item) => item.id === activeVersion.mediaVersionId);
        return media ? mediaVersionPreviewNode(baseNode, media) : baseNode;
    }, [activeVersion?.mediaVersionId, baseNode]);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(entry.title);
    if (!baseNode || !previewNode) return null;

    const commitRename = () => {
        setEditing(false);
        const title = draft.trim();
        if (!title || title === entry.title) return;
        onRename(renameUpdates(entry, title, nodeById));
    };

    return (
        <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-5">
                <button type="button" className="shrink-0 text-xs text-muted-foreground hover:text-foreground" onClick={onBack}>
                    {CANVAS_ASSET_KIND_LABELS[entry.kind]}
                </button>
                <span className="text-xs text-muted-foreground" aria-hidden="true">
                    /
                </span>
                {editing ? (
                    <Input
                        autoFocus
                        size="small"
                        className="!max-w-sm"
                        aria-label={t("canvasA.assetView.nameLabel")}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commitRename}
                        onPressEnter={commitRename}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") {
                                setDraft(entry.title);
                                setEditing(false);
                            }
                        }}
                    />
                ) : (
                    <>
                        <button type="button" className="min-w-0 truncate text-sm font-semibold" title={t("canvasA.assetView.renameHint")} onClick={() => setEditing(true)}>
                            {entry.title}
                        </button>
                        <Button type="text" size="small" aria-label={t("canvasA.assetView.rename")} icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)} />
                    </>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {activeVersion && activeVersion.promotable && !activeVersion.primary && entry.versions.length > 1 ? (
                        <Button size="small" icon={<Star className="size-3.5" />} onClick={() => onPromoteVersion(activeVersion)}>
                            {t("canvasA.assetView.setPrimary")}
                        </Button>
                    ) : null}
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => void onDownload(previewNode, entry.kind)}>
                        {t("canvasA.assetView.download")}
                    </Button>
                    <Button size="small" type="primary" icon={<Crosshair className="size-3.5" />} onClick={() => onLocate(baseNode.id)}>
                        {t("canvasA.assetView.locate")}
                    </Button>
                </div>
            </header>
            <div className="flex min-h-0 flex-1 max-lg:flex-col">
                <div className="grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden bg-[var(--workspace-surface)] p-4">
                    <CanvasAssetPreview node={previewNode} kind={entry.kind} />
                </div>
                <aside className="thin-scrollbar w-72 shrink-0 overflow-y-auto border-l border-border p-4 text-sm max-lg:w-full max-lg:border-l-0 max-lg:border-t" aria-label={t("canvasA.assetView.info")}>
                    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
                        <InfoRow label={t("canvasA.assetView.type")}>{CANVAS_ASSET_KIND_LABELS[entry.kind]}</InfoRow>
                        {activeVersion ? (
                            <InfoRow label={t("canvasA.assetView.version")}>
                                {activeVersion.label}
                                {activeVersion.primary ? t("canvasA.assetView.primarySuffix") : ""}
                            </InfoRow>
                        ) : null}
                        {previewNode.metadata?.naturalWidth && previewNode.metadata.naturalHeight ? <InfoRow label={t("canvasA.assetView.size")}>{`${previewNode.metadata.naturalWidth} × ${previewNode.metadata.naturalHeight}`}</InfoRow> : null}
                        {previewNode.metadata?.durationMs ? <InfoRow label={t("canvasA.assetView.duration")}>{t("canvasA.approval.seconds", { count: (previewNode.metadata.durationMs / 1000).toFixed(1) })}</InfoRow> : null}
                        {formatBytes(previewNode.metadata?.bytes || 0) ? <InfoRow label={t("canvasA.assetView.fileSize")}>{formatBytes(previewNode.metadata?.bytes || 0)}</InfoRow> : null}
                        {previewNode.metadata?.producedModel || previewNode.metadata?.model ? <InfoRow label={t("canvasA.assetView.model")}>{previewNode.metadata.producedModel || previewNode.metadata.model}</InfoRow> : null}
                        {activeVersion?.origin ? <InfoRow label={t("canvasA.assetView.origin")}>{activeVersion.origin === "generate" ? t("canvasA.assetView.originGenerate") : t("canvasA.assetView.originUpload")}</InfoRow> : null}
                        {entry.updatedAt ? <InfoRow label={t("canvasA.assetView.updated")}>{formatDate(entry.updatedAt)}</InfoRow> : null}
                    </dl>
                    {(entry.kind === "image" || entry.kind === "video" || entry.kind === "audio") && previewNode.metadata?.prompt ? (
                        <section className="mt-4">
                            <h3 className="m-0 mb-1 text-xs font-medium text-muted-foreground">{t("canvasA.assetView.prompt")}</h3>
                            <p className="m-0 line-clamp-[12] whitespace-pre-wrap break-words text-xs leading-5">{previewNode.metadata.prompt}</p>
                        </section>
                    ) : null}
                    {entry.versions.length > 1 ? (
                        <section className="mt-4">
                            <h3 className="m-0 mb-2 text-xs font-medium text-muted-foreground">{t("canvasA.assetView.allVersions", { count: entry.versions.length })}</h3>
                            <ul className="m-0 flex list-none flex-col gap-1 p-0">
                                {entry.versions.map((item) => (
                                    <li key={item.key}>
                                        <button
                                            type="button"
                                            className={`flex w-full items-center gap-2 rounded-[var(--r-md)] px-2 py-1.5 text-left text-xs hover:bg-foreground/5 ${item.key === activeVersion?.key ? "bg-foreground/10 font-medium" : ""}`}
                                            aria-current={item.key === activeVersion?.key ? "true" : undefined}
                                            onClick={() => onSelectVersion(item)}
                                        >
                                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                            {item.primary ? <Star className="size-3.5 shrink-0 fill-current" aria-label={t("canvasA.assetTree.primaryVersion")} /> : null}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : null}
                </aside>
            </div>
        </>
    );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 min-w-0 break-words">{children}</dd>
        </>
    );
}

/** 重命名一个资产：跨节点版本组保留各自的 A/B 后缀，其余只改承载节点。 */
function renameUpdates(entry: CanvasAssetEntry, title: string, nodeById: Map<string, CanvasNodeData>) {
    const memberIds = entry.versions.some((version) => version.source === "version-group") ? Array.from(new Set(entry.versions.map((version) => version.nodeId))) : [entry.nodeId];
    return memberIds.flatMap((nodeId) => {
        const node = nodeById.get(nodeId);
        if (!node) return [];
        const label = entry.versions.some((version) => version.source === "version-group") ? node.metadata?.versionLabel : undefined;
        return [{ nodeId, title: label ? `${title} · ${label}` : title }];
    });
}

function downloadCanvasText(node: CanvasNodeData, kind: "txt" | "markdown") {
    const extension = kind === "markdown" ? "md" : "txt";
    const baseName = (node.title || translate("canvasA.media.text")).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\.(txt|md|markdown)$/i, "");
    const fileName = `${baseName}.${extension}`;
    // 上传的文本在画布上可能已被编辑，下载当前正文而不是上传时的原始资源。
    const url = URL.createObjectURL(new Blob([canvasAssetText(node)], { type: kind === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" }));
    try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}
