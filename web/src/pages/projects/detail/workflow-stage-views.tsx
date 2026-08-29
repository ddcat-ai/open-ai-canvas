import { Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Film, Layers3, PackageCheck } from "lucide-react";
import { Link } from "react-router";

import { listProjectAssetsPage, type ProjectDetail } from "@/services/api/projects";

import { assetCategoryLabel, formatDuration, MetricCard, StageHeading } from "./workflow-shared";

export function StoryStage({ detail, projectId, unitId }: { detail: ProjectDetail; projectId: string; unitId: string }) {
    const unit = detail.units.find((item) => item.id === unitId)!;
    return <section className="mx-auto max-w-5xl"><StageHeading eyebrow="01 / 剧情与章节" title={unit.title} description="章节原文是资产拆分、分镜版本和生成提示的唯一来源。" /><div className="mt-6 rounded-xl border border-border/70 bg-surface p-5"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium text-foreground/55">章节原文</span><Link to={`/projects/${projectId}/chapters/${unit.id}`}><Button size="small">编辑章节</Button></Link></div><div className="max-h-[60vh] whitespace-pre-wrap text-sm leading-7 text-foreground/78">{unit.sourceText || "当前章节还没有正文。请先在剧情章节中上传小说或添加内容。"}</div></div></section>;
}

export function AssetsStage({ detail, projectId, unitId }: { detail: ProjectDetail; projectId: string; unitId: string }) {
    const candidates = detail.assetCandidates.filter((item) => !item.unitId || item.unitId === unitId);
    const assetCountsQuery = useQuery({ queryKey: ["project", projectId, "assets", "workflow-counts"], queryFn: () => listProjectAssetsPage(projectId, { page: 1, pageSize: 1 }) });
    const confirmedCounts = assetCountsQuery.data?.categoryCounts || {};
    const categories = ["character", "environment", "wardrobe", "prop", "weapon"];
    return <section className="mx-auto max-w-6xl"><StageHeading eyebrow="02 / 资产拆分" title="确认镜头真正会使用的资产" description="角色、场景、服饰、配饰与武器先建立稳定版本，镜头再绑定具体版本。" /><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{categories.map((category) => { const confirmed = confirmedCounts[category] || 0; const pending = candidates.filter((item) => item.category === category && item.status === "pending_confirmation").length; return <div key={category} className="border-t border-border/70 py-4"><div className="text-xs font-medium text-foreground/55">{assetCategoryLabel(category)}</div><div className="mt-3 text-2xl font-semibold">{assetCountsQuery.isLoading ? "—" : confirmed}</div><div className="mt-1 text-[var(--fs-micro)] text-foreground/42">已确认 · {pending} 待处理</div></div>; })}</div><div className="mt-5 flex items-center justify-between border-y border-border/70 py-5"><div><h3 className="text-sm font-semibold">资产库承担版本确认与设定维护</h3><p className="mt-1 text-xs text-foreground/48">确认后可直接在分镜工作台左栏绑定到镜头。</p></div><Link to={`/projects/${projectId}/assets`}><Button type="primary">打开资产库</Button></Link></div></section>;
}

export function DeliveryStage({ detail, unitId }: { detail: ProjectDetail; unitId: string }) {
    const shots = detail.shots.filter((item) => item.unitId === unitId);
    const readyVideos = shots.filter((shot) => detail.shotArtifacts.some((item) => item.shotId === shot.id && item.type === "video" && item.selected && item.status === "ready"));
    const stale = detail.shotArtifacts.filter((item) => item.unitId === unitId && item.status === "stale").length;
    return <section className="mx-auto max-w-5xl"><StageHeading eyebrow="06 / 交付与打包" title="交付前质量门禁" description="所有镜头视频就绪、过期产物清零后，再打包成片与生产资料。" /><div className="mt-6 grid gap-4 sm:grid-cols-3"><MetricCard icon={<Film className="size-5" />} label="视频已就绪" value={`${readyVideos.length} / ${shots.length}`} /><MetricCard icon={<Clock3 className="size-5" />} label="总时长" value={formatDuration(shots.reduce((total, item) => total + item.durationMs, 0))} /><MetricCard icon={<Layers3 className="size-5" />} label="过期产物" value={String(stale)} /></div><div className="mt-5 border-y border-border/70 py-5"><div className="flex items-start gap-3"><PackageCheck className="mt-0.5 size-5 text-[var(--workspace-accent)]" /><div><h3 className="text-sm font-semibold">计划交付内容</h3><p className="mt-1 text-xs leading-5 text-foreground/48">成片 MP4、字幕 SRT、分镜 JSON/CSV、资产清单和生成参数 ZIP。</p></div></div><Button className="mt-5" disabled>生成交付包（后端打包尚未接入）</Button></div></section>;
}
