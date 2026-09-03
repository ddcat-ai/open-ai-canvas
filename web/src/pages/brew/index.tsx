import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Empty, Input } from "antd";
import { ArrowRight, FlaskConical, Database, GitBranch, RefreshCw, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { nxfHealth } from "@/services/api/nxf";
import { listProjects, type ProjectSummary } from "@/services/api/projects";

function EngineHealthCard() {
    const healthQuery = useQuery({ queryKey: ["nxf", "health"], queryFn: ({ signal }) => nxfHealth(signal), refetchInterval: 30_000, retry: 1 });
    const health = healthQuery.data;

    if (healthQuery.isLoading) {
        return <div className="h-[104px] animate-pulse rounded-xl border border-[var(--workspace-border)] bg-surface px-4 py-4" />;
    }

    const online = Boolean(health?.router_json_ok);
    const stateItems = health ? Object.entries(health.cards_by_state || {}) : [];

    return (
        <section className="rounded-xl border border-[var(--workspace-border)] bg-surface px-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
                <span className="relative flex size-2.5 shrink-0">
                    <span className={online ? "absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" : "absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-40"} />
                    <span className={online ? "relative inline-flex size-2.5 rounded-full bg-emerald-500" : "relative inline-flex size-2.5 rounded-full bg-red-500"} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[var(--fs-body)] font-medium">
                        <FlaskConical className="size-4 text-emerald-600" strokeWidth={1.8} />
                        酿笑坊引擎 {online ? "运行中" : "未连接"}
                    </div>
                    <div className="mt-0.5 text-[var(--fs-caption)] text-foreground/50">
                        {online && health ? `桥接 v${health.bridge_version} · 坊规 v${health.spec_version}` : "引擎服务（127.0.0.1:8823）未就绪，可用控制台面板启动「酿笑坊能力服务」"}
                    </div>
                </div>
                <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={healthQuery.isFetching} onClick={() => void healthQuery.refetch()}>
                    刷新
                </Button>
            </div>

            {online && health ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[var(--fs-caption)]">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-700">
                        <Database className="size-3.5" strokeWidth={1.8} />
                        配方卡 {health.cards_total}
                    </span>
                    {stateItems.map(([state, count]) => (
                        <span key={state} className="rounded-full bg-foreground/5 px-2.5 py-1 text-foreground/60">
                            {state} {count}
                        </span>
                    ))}
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2.5 py-1 font-medium text-sky-700">
                        <GitBranch className="size-3.5" strokeWidth={1.8} />
                        路由 {health.router_json_ok ? "正常" : "异常"}
                    </span>
                </div>
            ) : null}
        </section>
    );
}

function ProjectBrewCard({ summary }: { summary: ProjectSummary }) {
    const project = summary.project;
    const total = summary.unitCount || 0;
    const done = summary.completedUnitCount || 0;
    const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

    return (
        <Link
            to={`/projects/${project.id}/brew`}
            className="group flex flex-col rounded-xl border border-[var(--workspace-border)] bg-surface px-4 py-4 transition-all hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-md"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-[var(--fs-body)] font-medium">{project.name || "未命名项目"}</div>
                    <div className="mt-0.5 line-clamp-2 text-[var(--fs-caption)] text-foreground/50">{project.description || "暂无简介"}</div>
                </div>
                <ArrowRight className="mt-1 size-4 shrink-0 text-foreground/25 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-600" strokeWidth={1.8} />
            </div>

            <div className="mt-3 flex items-center gap-2 text-[var(--fs-caption)] text-foreground/45">
                <span>章节 {done}/{total}</span>
                <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/8">
                    <div className="h-full rounded-full bg-emerald-500/70 transition-all" style={{ width: `${percent}%` }} />
                </div>
                <span className="tabular-nums">{percent}%</span>
            </div>

            <div className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[var(--fs-caption)] font-medium text-emerald-700">
                <Sparkles className="size-3" strokeWidth={1.8} />
                进入酿造
            </div>
        </Link>
    );
}

export default function BrewHubPage() {
    const { message } = App.useApp();
    const [keyword, setKeyword] = useState("");

    const projectsQuery = useQuery({
        queryKey: ["projects", "list", "brew-hub"],
        queryFn: () => listProjects(),
    });

    const summaries = useMemo(() => {
        const items = projectsQuery.data?.projects || [];
        const kw = keyword.trim().toLowerCase();
        return items.filter((item) => {
            const project = item.project;
            if (project.status === "archived") return false;
            if (!kw) return true;
            return (project.name || "").toLowerCase().includes(kw) || (project.description || "").toLowerCase().includes(kw);
        });
    }, [projectsQuery.data, keyword]);

    return (
        <WorkspacePage>
            <PageHeader
                title="酿造工坊"
                description="酿笑坊引擎驱动：项目分镜编译 · 方法论路由 · 提示词翻译 · 质量 Gate"
                meta={<FlaskConical className="size-5 text-emerald-600" strokeWidth={1.8} />}
            />

            <div className="mt-4 flex flex-col gap-4">
                <EngineHealthCard />

                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-[var(--fs-body)] font-semibold">选择一个项目开始酿造</h2>
                    <Input
                        allowClear
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        placeholder="搜索项目"
                        prefix={<Search className="size-3.5 text-foreground/35" strokeWidth={1.6} />}
                        className="max-w-56"
                    />
                </div>

                {projectsQuery.isLoading ? (
                    <WorkspaceLoadingState label="正在载入项目…" />
                ) : projectsQuery.isError ? (
                    <Alert type="error" showIcon message="项目列表载入失败" description={String(projectsQuery.error)} />
                ) : summaries.length === 0 ? (
                    <Empty
                        className="rounded-xl border border-dashed border-[var(--workspace-border)] py-10"
                        description={keyword ? "没有匹配的项目" : "还没有项目，先到「短剧创作」页新建一个"}
                    />
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {summaries.map((summary) => (
                            <ProjectBrewCard key={summary.project.id} summary={summary} />
                        ))}
                    </div>
                )}
            </div>
        </WorkspacePage>
    );
}
