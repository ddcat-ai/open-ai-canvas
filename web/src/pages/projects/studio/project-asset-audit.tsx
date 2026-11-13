import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input } from "antd";
import { AlertCircle, ArrowUpRight, Box, Check, ChevronDown, Clapperboard, Image, MapPin, Search, UsersRound, ZoomIn } from "lucide-react";

import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceNoResultsState, WorkspaceState } from "@/components/layout/workspace-state";
import { buildDramaAssetUsage, type DramaAssetUsage, type DramaAssetUsageKind, type DramaShotAssetUsage } from "@/lib/drama/asset-usage";
import { dramaKeys } from "@/lib/drama/drama-query-keys";
import { getDramaEpisode, type DramaCast, type DramaEpisodeRow } from "@/services/api/drama";
import { formatDuration, MediaThumb } from "../drama-shared";
import "./asset-kind.css";
import "./project-asset-audit.css";

const KINDS = ["character", "scene", "prop", "image"] as const;
const KIND_LABEL: Record<DramaAssetUsageKind, string> = { character: "角色", scene: "环境", prop: "道具", image: "附加素材" };
const KIND_ICON = { character: UsersRound, scene: MapPin, prop: Box, image: Image };
const ISSUE_LABEL = { "missing-asset": "资产已缺失", "missing-image": "缺少参考图", "not-selected": "未选为本段参考", "not-sent": "本次请求不附图" };

export type ProjectAssetAuditProps = {
    projectId: string;
    episodes: DramaEpisodeRow[];
    cast: DramaCast[];
    activeEpisodeId?: string;
    onOpenCast: (id: string) => void;
    onOpenSegment: (episodeId: string, index: number) => void;
};

function AuditAsset({ asset, onOpenCast, onPreview }: { asset: DramaAssetUsage; onOpenCast: (id: string) => void; onPreview: (asset: DramaAssetUsage) => void }) {
    const Icon = KIND_ICON[asset.kind];
    return (
        <article className="drama-audit-asset">
            <button type="button" className="drama-audit-asset-media" disabled={!asset.resourceId} aria-label={`预览${asset.name}`} onClick={() => onPreview(asset)}>
                <MediaThumb resourceId={asset.resourceId} alt={asset.name} fallback={<Icon className="size-6" />} />
                {asset.resourceId ? <ZoomIn className="drama-audit-zoom size-4" aria-hidden /> : null}
            </button>
            <div className="drama-audit-asset-body">
                <div className="drama-audit-asset-title">
                    <strong title={asset.name}>{asset.name}</strong>
                    {asset.castId ? <Button type="text" size="small" icon={<ArrowUpRight className="size-3.5" />} aria-label={`打开${asset.name}的资产设定`} onClick={() => onOpenCast(asset.castId!)} /> : null}
                </div>
                <span className="drama-audit-asset-meta">
                    <span className="drama-asset-kind" data-asset-kind={asset.kind}>
                        <Icon className="size-3" />
                        {KIND_LABEL[asset.kind]}
                    </span>
                    {asset.reference?.label ? <span>{asset.reference.label}</span> : null}
                </span>
                <span className={`drama-audit-asset-state ${asset.issue ? "has-issue" : ""}`}>
                    {asset.issue ? <AlertCircle className="size-3.5" /> : <Check className="size-3.5" />}
                    {asset.issue ? ISSUE_LABEL[asset.issue] : "随当前请求发送"}
                </span>
                <small>{asset.shotIds.length ? `关联 ${asset.shotIds.length} 个镜头` : "本段附加参考"}</small>
            </div>
        </article>
    );
}

function AuditShots({ shots, onOpenCast }: { shots: DramaShotAssetUsage[]; onOpenCast: (id: string) => void }) {
    return (
        <div className="drama-audit-shots">
            {shots.map(({ shot, assets }) => (
                <div className="drama-audit-shot" key={shot.id}>
                    <span className="drama-audit-shot-number">镜头 {shot.position + 1}</span>
                    <div className="drama-audit-shot-description">
                        <p>{shot.action || shot.sourceQuote || shot.scene || "尚未填写镜头内容"}</p>
                        <span>{[shot.shotSize, shot.camera, shot.durationMs ? formatDuration(shot.durationMs) : ""].filter(Boolean).join(" · ")}</span>
                    </div>
                    <div className="drama-audit-shot-assets">
                        {assets.map((asset) => {
                            const Icon = KIND_ICON[asset.kind];
                            return (
                                <button
                                    type="button"
                                    className="drama-asset-kind"
                                    data-asset-kind={asset.kind}
                                    key={asset.key}
                                    disabled={!asset.castId}
                                    title={asset.issue ? `${asset.name} · ${ISSUE_LABEL[asset.issue]}` : asset.name}
                                    onClick={() => asset.castId && onOpenCast(asset.castId)}
                                >
                                    <Icon className="size-3" />
                                    {asset.name}
                                    {asset.issue ? <AlertCircle className="size-3" aria-label={ISSUE_LABEL[asset.issue]} /> : null}
                                </button>
                            );
                        })}
                        {!assets.length ? <span className="drama-audit-note">未配置镜头资产</span> : null}
                    </div>
                </div>
            ))}
        </div>
    );
}

export function ProjectAssetAudit({ projectId, episodes, cast, activeEpisodeId, onOpenCast, onOpenSegment }: ProjectAssetAuditProps) {
    const [selectedId, setSelectedId] = useState(activeEpisodeId || "");
    const [kind, setKind] = useState<DramaAssetUsageKind | "all">("all");
    const [search, setSearch] = useState("");
    const [issuesOnly, setIssuesOnly] = useState(false);
    const [preview, setPreview] = useState<DramaAssetUsage>();
    const searchTerm = useDeferredValue(search.trim().toLocaleLowerCase());
    useEffect(() => setSelectedId(activeEpisodeId || ""), [projectId, activeEpisodeId]);
    const selected = episodes.find((episode) => episode.id === selectedId) || episodes.find((episode) => episode.id === activeEpisodeId) || episodes[0];
    const episodeId = selected?.id || "";
    const query = useQuery({
        queryKey: dramaKeys.episode(projectId, episodeId),
        queryFn: ({ signal }) => getDramaEpisode(projectId, episodeId, signal),
        enabled: Boolean(projectId && episodeId),
        refetchInterval: selected && ["script", "prompts", "video", "render"].includes(selected.stage) ? 4_000 : false,
    });
    const detail = query.data?.episode.id === episodeId ? query.data : undefined;
    const usage = useMemo(() => (detail ? buildDramaAssetUsage(detail, cast) : undefined), [detail, cast]);
    const matches = (asset: DramaAssetUsage) => (kind === "all" || asset.kind === kind) && (!issuesOnly || Boolean(asset.issue)) && (!searchTerm || asset.name.toLocaleLowerCase().includes(searchTerm));
    const filteredSegments = usage?.segments
        .map((entry) => ({ ...entry, visibleAssets: entry.assets.filter(matches).sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)) }))
        .filter((entry) => entry.visibleAssets.length || (!entry.assets.length && kind === "all" && !issuesOnly && !searchTerm));
    const resetFilters = () => {
        setSearch("");
        setKind("all");
        setIssuesOnly(false);
    };
    return (
        <section className="drama-asset-audit" aria-label="按集核查资产">
            <div className="drama-audit-intro">
                <div>
                    <h2>分集资产配置</h2>
                    <p>逐段核对人物、环境与道具，查看镜头配置和当前请求使用的参考图。</p>
                </div>
                <span className="drama-audit-note">选择一集读取配置 · 共 {episodes.length} 集</span>
            </div>
            <nav className="drama-audit-episodes thin-scrollbar" aria-label="选择核查的集">
                {episodes.map((episode) => (
                    <button
                        type="button"
                        key={episode.id}
                        className="drama-audit-episode"
                        aria-pressed={episode.id === episodeId}
                        onClick={() => {
                            setSelectedId(episode.id);
                            setPreview(undefined);
                        }}
                    >
                        <span>第 {episode.number} 集</span>
                        <strong>{episode.title || "未命名"}</strong>
                        <small>
                            {episode.shotCount} 个镜头{episode.id === episodeId ? " · 当前核查" : " · 点击查看"}
                        </small>
                    </button>
                ))}
            </nav>
            {!episodes.length ? (
                <WorkspaceState compact title="还没有可核查的分集" description="完成分集与分镜后，可在这里核对每一段的资产配置。" />
            ) : query.isError && !detail ? (
                <WorkspaceErrorState compact title="本集资产配置读取失败" description={query.error instanceof Error ? query.error.message : "请重试，当前无法判断本集使用了哪些资产。"} onRetry={() => void query.refetch()} />
            ) : !usage || !detail ? (
                <WorkspaceLoadingState label={`正在读取第 ${selected?.number} 集的资产配置`} detail="尚未读取的集不会记为零资产。" />
            ) : (
                <>
                    <div className="drama-audit-toolbar">
                        <Input aria-label="搜索本集资产" placeholder="搜索本集资产" prefix={<Search className="size-4" />} value={search} allowClear onChange={(event) => setSearch(event.target.value)} />
                        <div className="drama-audit-filters" role="group" aria-label="资产类型">
                            {(["all", ...KINDS] as const).map((value) => (
                                <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>
                                    {value === "all" ? "全部" : KIND_LABEL[value]}
                                    <span>{value === "all" ? usage.assetCount : usage.counts[value]}</span>
                                </button>
                            ))}
                        </div>
                        <Button aria-pressed={issuesOnly} icon={<AlertCircle className="size-4" />} onClick={() => setIssuesOnly(!issuesOnly)}>
                            只看待核查
                        </Button>
                    </div>
                    <div className="drama-audit-content thin-scrollbar" aria-busy={query.isFetching}>
                        {query.isError ? (
                            <div className="drama-audit-notice" role="alert">
                                <AlertCircle className="size-4" />
                                <span>刷新失败，以下为上次读取的配置。</span>
                                <Button size="small" onClick={() => void query.refetch()}>
                                    重试
                                </Button>
                            </div>
                        ) : null}
                        {usage.warnings.length ? (
                            <div className="drama-audit-notice" role="alert">
                                <AlertCircle className="size-4" />
                                <div>
                                    {usage.warnings.map((warning) => (
                                        <p key={warning}>{warning}</p>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        <p className="drama-audit-note">以下展示当前配置；历史视频可能使用了不同版本的参考图。未附图的原因请进入对应剧情段查看。</p>
                        {filteredSegments?.map(({ segment, shots, visibleAssets, issueCount }) => (
                            <section className="drama-audit-segment" key={segment.id} aria-label={`第 ${segment.index + 1} 段资产配置`}>
                                <header className="drama-audit-segment-head">
                                    <span className="drama-audit-segment-index">{String(segment.index + 1).padStart(2, "0")}</span>
                                    <div className="drama-audit-segment-heading">
                                        <h3>{segment.title || `第 ${segment.index + 1} 段`}</h3>
                                        <span>
                                            {shots.length} 个镜头 · {formatDuration(segment.durationMs)}
                                            {issueCount ? ` · ${issueCount} 项待核查` : ""}
                                        </span>
                                    </div>
                                    <Button icon={<ArrowUpRight className="size-4" />} onClick={() => onOpenSegment(episodeId, segment.index)}>
                                        进入剧情段
                                    </Button>
                                </header>
                                {visibleAssets.length ? (
                                    <div className="drama-audit-assets">
                                        {visibleAssets.map((asset) => (
                                            <AuditAsset key={asset.key} asset={asset} onOpenCast={onOpenCast} onPreview={setPreview} />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="drama-audit-note">本段尚未配置资产或参考图，可进入剧情段补充。</p>
                                )}
                                {shots.length ? (
                                    <details className="drama-audit-shot-details">
                                        <summary>
                                            <Clapperboard className="size-4" />
                                            查看 {shots.length} 个镜头的资产配置
                                            <ChevronDown className="size-4" />
                                        </summary>
                                        <AuditShots shots={shots} onOpenCast={onOpenCast} />
                                    </details>
                                ) : null}
                            </section>
                        ))}
                        {usage.unassignedShots.length ? (
                            <section className="drama-audit-segment">
                                <header className="drama-audit-segment-head">
                                    <AlertCircle className="size-4" />
                                    <div className="drama-audit-segment-heading">
                                        <h3>{usage.unassignedShots.length} 个镜头尚未关联剧情段</h3>
                                        <span>保留镜头资产供核查，尚无可对照的段参考请求。</span>
                                    </div>
                                </header>
                                <AuditShots shots={usage.unassignedShots} onOpenCast={onOpenCast} />
                            </section>
                        ) : null}
                        {!filteredSegments?.length && !usage.unassignedShots.length ? (
                            detail.segments.length ? (
                                <WorkspaceNoResultsState compact query={search || undefined} title="没有符合筛选的资产" onClear={resetFilters} />
                            ) : (
                                <WorkspaceState compact title="本集还没有分镜资产配置" description="剧本与分镜生成后，这里会显示每一段的角色、环境、道具和参考素材。" />
                            )
                        ) : null}
                    </div>
                </>
            )}
            {preview?.resourceId ? <CanvasImagePreview storageKey={`resource:${preview.resourceId}`} alt={preview.name} onClose={() => setPreview(undefined)} /> : null}
        </section>
    );
}
