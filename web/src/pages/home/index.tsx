import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Input, Pagination, Segmented, Select } from "antd";
import { ArrowRight, FolderKanban, Images, LayoutGrid, ListTodo, Plus, Search, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";

import { resolveCanvasStylePreset, resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { WorkspaceSignalIcon } from "@/components/ui/aceternity/workspace-signal-icon";
import { parseStyleProfile } from "@/lib/canvas/style-profile";
import { projectSummaryCompletion, projectSummaryStage } from "@/lib/project-workbench";
import { listProjects, type ProjectSummary } from "@/services/api/projects";
import { listGenerationTasks } from "@/services/api/task-center";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { useAssetStore, type AssetKind } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";

const workflow = [
    { title: "整理故事", description: "导入小说、粘贴文本或创建章节" },
    { title: "确认设定", description: "整理角色、场景、画风和参考资料" },
    { title: "制作镜头", description: "生成分镜、图片和视频候选" },
    { title: "检查结果", description: "比较版本、处理失败并整理导出" },
];

const sourceTypeLabels: Record<string, string> = {
    blank: "空白开始",
    novel: "导入小说",
    text: "粘贴文本",
};

const ASSET_KINDS: Array<{ key: AssetKind; label: string }> = [
    { key: "image", label: "图片" },
    { key: "video", label: "视频" },
    { key: "audio", label: "音频" },
    { key: "text", label: "文本" },
    { key: "entity", label: "实体" },
    { key: "model", label: "模型" },
];

const CHART_ACCENT = "var(--workspace-accent)";
const CHART_MUTED = "color-mix(in srgb, var(--workspace-accent) 30%, transparent)";

export default function IndexPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const canvasProjects = useCanvasStore((state) => state.projects);
    const assets = useAssetStore((state) => state.assets);
    const user = useUserStore((state) => state.user);
    const userHydrated = useUserStore((state) => state.hydrated);
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const taskCenterEnabled = useUserStore((state) => state.features.taskCenterEnabled);

    const domainProjectsQuery = useQuery({
        queryKey: ["projects"],
        queryFn: () => listProjects(),
        enabled: Boolean(user && shortDramaEnabled),
    });
    const domainProjects = useMemo(() => [...(domainProjectsQuery.data?.projects || [])].sort((left, right) => right.project.updatedAt.localeCompare(left.project.updatedAt)), [domainProjectsQuery.data]);

    // 仪表盘需要生成记录做活跃度与任务统计；后端不可用时降级为空数据，不影响其他区块。
    const tasksQuery = useQuery({
        queryKey: ["home-dashboard-tasks"],
        queryFn: () => listGenerationTasks(300).catch(() => []),
        enabled: Boolean(user && taskCenterEnabled),
    });
    const tasks = useMemo(() => tasksQuery.data || [], [tasksQuery.data]);

    const createIndependentCanvas = () => {
        if (!canvasHydrated) return;
        if (!user) {
            navigate(`/login?next=${encodeURIComponent("/canvas?mode=new")}`);
            return;
        }
        void createCanvasProjectWithRemoteSync(`自由画布 ${canvasProjects.length + 1}`).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? `画布已在本地创建，云端同步失败：${syncError.message}` : "画布已在本地创建，云端同步失败");
            navigate(`/canvas/${id}`);
        });
    };

    const loadingUserWorkspace = !userHydrated || (Boolean(user && shortDramaEnabled) && domainProjectsQuery.isLoading);
    return (
        <main className="app-user-content app-workspace-canvas app-workspace-scroll h-full overflow-y-auto text-foreground">
            <div className="app-home-dashboard w-full px-4 pb-14 pt-5 sm:px-6 lg:px-8">
                {loadingUserWorkspace ? (
                    <WorkspaceLoadingState className="mt-3" label="正在恢复工作台" detail="读取项目、素材和最近任务" rows={5} />
                ) : user && shortDramaEnabled && domainProjectsQuery.isError ? (
                    <WorkspaceErrorState title="项目工作台加载失败" description={domainProjectsQuery.error instanceof Error ? domainProjectsQuery.error.message : "暂时无法读取项目列表。"} onRetry={() => void domainProjectsQuery.refetch()} />
                ) : (
                    <HomeDashboard
                        user={user}
                        shortDramaEnabled={shortDramaEnabled}
                        domainProjects={domainProjects}
                        canvasProjects={canvasProjects}
                        assets={assets}
                        tasks={tasks}
                        canvasHydrated={canvasHydrated}
                        onCreateIndependentCanvas={createIndependentCanvas}
                    />
                )}
            </div>
        </main>
    );
}

function HomeDashboard({
    user,
    shortDramaEnabled,
    domainProjects,
    canvasProjects,
    assets,
    tasks,
    canvasHydrated,
    onCreateIndependentCanvas,
}: {
    user: ReturnType<typeof useUserStore.getState>["user"];
    shortDramaEnabled: boolean;
    domainProjects: ProjectSummary[];
    canvasProjects: ReturnType<typeof useCanvasStore.getState>["projects"];
    assets: ReturnType<typeof useAssetStore.getState>["assets"];
    tasks: Awaited<ReturnType<typeof listGenerationTasks>>;
    canvasHydrated: boolean;
    onCreateIndependentCanvas: () => void;
}) {
    const hasProjects = Boolean(domainProjects.length);
    const displayName = user?.displayName || user?.username || "创作者";

    const activeProjects = useMemo(() => domainProjects.filter(({ project }) => project.status !== "archived"), [domainProjects]);
    const archivedCount = domainProjects.length - activeProjects.length;
    const totalUnits = useMemo(() => activeProjects.reduce((sum, row) => sum + row.unitCount, 0), [activeProjects]);
    const activeProject = activeProjects[0];

    const independentCanvases = useMemo(() => canvasProjects.filter((project) => !project.projectId), [canvasProjects]);
    const latestCanvasUpdate = useMemo(() => canvasProjects.reduce<string | null>((latest, project) => (latest === null || project.updatedAt > latest ? project.updatedAt : latest), null), [canvasProjects]);

    const weekWindow = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekTasks = useMemo(() => tasks.filter((task) => new Date(task.createdAt).getTime() >= weekWindow), [tasks, weekWindow]);
    const weekSucceeded = useMemo(() => weekTasks.filter((task) => task.status === "succeeded").length, [weekTasks]);
    const weekFailed = useMemo(() => weekTasks.filter((task) => task.status === "failed" || task.status === "cancelled").length, [weekTasks]);
    const weekRunning = useMemo(() => weekTasks.filter((task) => task.status === "queued" || task.status === "running").length, [weekTasks]);

    const assetKindCounts = useMemo(() => {
        const counts: Partial<Record<AssetKind, number>> = {};
        for (const asset of assets) counts[asset.kind] = (counts[asset.kind] || 0) + 1;
        return counts;
    }, [assets]);

    const [rangeDays, setRangeDays] = useState(14);
    const activityData = useMemo(
        () =>
            buildActivityBuckets(
                rangeDays,
                tasks.map((task) => new Date(task.createdAt).getTime()),
                canvasProjects.map((project) => new Date(project.updatedAt).getTime()),
            ),
        [rangeDays, tasks, canvasProjects],
    );
    const assetChartEntries = useMemo(() => assetChartData(assets), [assets]);
    const assetTotal = useMemo(() => assets.length, [assets]);

    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<"all" | "active" | "archived">("all");
    const [sort, setSort] = useState<"updated" | "progress" | "name">("updated");
    const [page, setPage] = useState(1);
    const rows = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        return domainProjects
            .filter(({ project }) => status === "all" || project.status === status)
            .filter(({ project }) => !normalizedKeyword || `${project.name} ${project.description || ""} ${projectStyleTitle(project)}`.toLowerCase().includes(normalizedKeyword))
            .sort((left, right) => {
                if (sort === "name") return left.project.name.localeCompare(right.project.name, "zh-CN");
                if (sort === "progress") return projectSummaryCompletion(right) - projectSummaryCompletion(left);
                return right.project.updatedAt.localeCompare(left.project.updatedAt);
            });
    }, [domainProjects, keyword, sort, status]);
    const pageSize = 5;
    const safePage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
    const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

    const projectHref = user ? "/projects?create=1" : `/login?next=${encodeURIComponent("/projects?create=1")}`;

    return (
        <>
            <header className="home-welcome" aria-label="欢迎区">
                <div className="min-w-0">
                    <span className="home-welcome-kicker">
                        <WorkspaceSignalIcon variant="home" size="sm" />
                        影策 · AI 影视与短剧创作工作台
                    </span>
                    <h1 className="home-welcome-title">{hasProjects ? `欢迎回来，${displayName}` : `欢迎使用影策，${displayName}`}</h1>
                    <p className="home-welcome-sub">{hasProjects ? "回到最近制作，或从一句话故事开始一部新的短剧。" : "从一个故事开始：整理章节、确认设定、制作镜头，直到可交付的结果。"}</p>
                </div>
                <div className="home-welcome-actions">
                    {shortDramaEnabled ? (
                        <Link
                            className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25"
                            to={projectHref}
                        >
                            <Plus className="size-4" />
                            开始创作
                        </Link>
                    ) : null}
                    <Button size="large" disabled={!canvasHydrated} icon={<LayoutGrid className="size-4" />} onClick={onCreateIndependentCanvas}>
                        打开画布
                    </Button>
                </div>
            </header>

            <section className="home-stats-grid" aria-label="工作台统计">
                {shortDramaEnabled ? (
                    <StatCard icon={<FolderKanban className="size-4" />} label="进行中项目" value={activeProjects.length} hint={activeProjects.length ? `共 ${totalUnits} 章 · ${archivedCount} 个已归档` : "创建项目开始制作"} to="/projects" />
                ) : null}
                <StatCard icon={<LayoutGrid className="size-4" />} label="自由画布" value={independentCanvases.length} hint={latestCanvasUpdate ? `最近更新 ${formatRelativeTime(latestCanvasUpdate)}` : "新建独立创作空间"} to="/canvas" />
                <StatCard icon={<Images className="size-4" />} label="素材资产" value={assets.length} hint={assetSummaryHint(assetKindCounts)} to="/assets" />
                <StatCard icon={<ListTodo className="size-4" />} label="本周任务" value={weekTasks.length} hint={weekTasks.length ? `成功 ${weekSucceeded} · 失败 ${weekFailed} · 进行中 ${weekRunning}` : "本周还没有生成任务"} to="/tasks" />
            </section>

            <section className="home-charts-grid mt-3" aria-label="创作数据">
                <div className="home-panel">
                    <div className="home-panel-head">
                        <div>
                            <h2 className="home-panel-title">创作活跃度</h2>
                            <p className="home-panel-sub">按天统计生成任务与画布更新</p>
                        </div>
                        <Segmented
                            size="small"
                            options={[
                                { label: "近 7 天", value: 7 },
                                { label: "近 14 天", value: 14 },
                                { label: "近 30 天", value: 30 },
                            ]}
                            value={rangeDays}
                            onChange={(value) => setRangeDays(value as number)}
                        />
                    </div>
                    <div className="home-panel-body">
                        {activityData.some((item) => item.tasks > 0 || item.canvases > 0) ? (
                            <ResponsiveContainer width="100%" height={232}>
                                <BarChart data={activityData} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                                    <CartesianGrid vertical={false} stroke="var(--workspace-border)" strokeOpacity={0.6} />
                                    <XAxis
                                        dataKey="label"
                                        tickLine={false}
                                        axisLine={{ stroke: "var(--workspace-border)" }}
                                        tickMargin={6}
                                        interval={rangeDays > 14 ? 4 : rangeDays > 7 ? 2 : 0}
                                        tick={{ fill: "var(--foreground)", opacity: 0.45, fontSize: 11 }}
                                    />
                                    <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "var(--foreground)", opacity: 0.45, fontSize: 10 }} />
                                    <ChartTooltip
                                        cursor={{ fill: "var(--workspace-accent)", opacity: 0.05 }}
                                        contentStyle={tooltipStyle}
                                        itemStyle={{ color: "var(--foreground)", fontSize: 12 }}
                                        labelStyle={{ color: "var(--foreground)", fontWeight: 600, fontSize: 12 }}
                                    />
                                    <Bar dataKey="tasks" name="生成任务" fill={CHART_ACCENT} radius={[4, 4, 0, 0]} maxBarSize={14} />
                                    <Bar dataKey="canvases" name="画布更新" fill={CHART_MUTED} radius={[4, 4, 0, 0]} maxBarSize={14} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="home-chart-empty">还没有生成记录，去画布或项目开始第一次创作。</div>
                        )}
                    </div>
                </div>

                <div className="home-panel">
                    <div className="home-panel-head">
                        <div>
                            <h2 className="home-panel-title">素材构成</h2>
                            <p className="home-panel-sub">按类型统计当前素材库</p>
                        </div>
                    </div>
                    <div className="home-panel-body">
                        {assetTotal ? (
                            <div className="flex min-h-[232px] items-center gap-2 py-2">
                                <div className="relative h-[200px] w-[56%] shrink-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={assetChartEntries} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="88%" paddingAngle={2} cornerRadius={3} stroke="none">
                                                {assetChartEntries.map((entry) => (
                                                    <Cell key={entry.name} fill={entry.color} />
                                                ))}
                                            </Pie>
                                            <ChartTooltip contentStyle={tooltipStyle} itemStyle={{ color: "var(--foreground)", fontSize: 12 }} labelStyle={{ color: "var(--foreground)", fontWeight: 600, fontSize: 12 }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <div className="home-donut-center">
                                        <strong>{assetTotal}</strong>
                                        <span>项素材</span>
                                    </div>
                                </div>
                                <ul className="home-donut-legend">
                                    {assetChartEntries.map((entry) => (
                                        <li key={entry.name}>
                                            <i style={{ background: entry.color }} />
                                            <span>{entry.name}</span>
                                            <em>{entry.value}</em>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : (
                            <div className="home-chart-empty">还没有素材资产，生成的图片、视频和音频会沉淀在这里。</div>
                        )}
                    </div>
                </div>
            </section>

            <section className="home-lower-grid mt-3" aria-label="最近项目与创作入口">
                <div className="home-panel">
                    <div className="home-panel-head">
                        <div>
                            <h2 className="home-panel-title">最近项目</h2>
                            <p className="home-panel-sub">按更新时间排列，支持搜索、筛选与排序</p>
                        </div>
                        <Link to="/projects" className="inline-flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground">
                            查看全部
                            <ArrowRight className="size-3.5" />
                        </Link>
                    </div>
                    <div className="home-recent-toolbar">
                        <Input
                            allowClear
                            className="home-recent-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder="搜索项目名称或画风"
                            onChange={(event) => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                            aria-label="搜索项目"
                        />
                        <Select
                            size="middle"
                            className="w-32"
                            value={status}
                            onChange={(value) => {
                                setStatus(value as "all" | "active" | "archived");
                                setPage(1);
                            }}
                            options={[
                                { label: "全部状态", value: "all" },
                                { label: "进行中", value: "active" },
                                { label: "已归档", value: "archived" },
                            ]}
                        />
                        <Select
                            size="middle"
                            className="w-32"
                            value={sort}
                            onChange={(value) => {
                                setSort(value as "updated" | "progress" | "name");
                                setPage(1);
                            }}
                            options={[
                                { label: "最近更新", value: "updated" },
                                { label: "章节进度", value: "progress" },
                                { label: "项目名称", value: "name" },
                            ]}
                        />
                    </div>
                    <div className="home-recent-scroll">
                        <div className="home-recent-table">
                            <div className="home-recent-col-head" aria-hidden="true">
                                <span>项目</span>
                                <span>阶段</span>
                                <span>章节进度</span>
                                <span>更新时间</span>
                                <span />
                            </div>
                            {rows.length ? (
                                pageRows.map((row) => <RecentProjectRow key={row.project.id} row={row} />)
                            ) : (
                                <div className="home-recent-empty">
                                    {domainProjects.length ? (
                                        <>
                                            <Search className="size-5 text-foreground/35" />
                                            <p className="text-sm font-medium">没有匹配的项目</p>
                                            <p className="text-xs leading-5 text-foreground/45">调整搜索词或状态筛选后再试。</p>
                                        </>
                                    ) : shortDramaEnabled ? (
                                        <>
                                            <Sparkles className="size-5 text-foreground/35" />
                                            <p className="text-sm font-medium">创建第一个故事项目</p>
                                            <p className="max-w-sm text-xs leading-5 text-foreground/45">项目会集中保存章节、项目画布、角色场景和制作进度，从这里开始一部短剧。</p>
                                            <Link
                                                className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25"
                                                to={projectHref}
                                            >
                                                <Plus className="size-3.5" />
                                                创建项目
                                            </Link>
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="size-5 text-foreground/35" />
                                            <p className="text-sm font-medium">项目功能尚未启用</p>
                                            <p className="text-xs leading-5 text-foreground/45">可以从自由画布开始创作，或联系管理员开启短剧项目。</p>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="home-panel-foot">
                        <span className="text-xs text-foreground/45">
                            共 {rows.length} 个项目{rows.length ? `，每页 ${pageSize} 条` : ""}
                        </span>
                        {rows.length > pageSize ? <Pagination size="small" current={safePage} pageSize={pageSize} total={rows.length} showSizeChanger={false} onChange={setPage} /> : null}
                    </div>
                </div>

                <div className="home-side-stack">
                    <div className="home-panel">
                        <div className="home-panel-head">
                            <div>
                                <h2 className="home-panel-title">快捷创建</h2>
                                <p className="home-panel-sub">常用创作入口</p>
                            </div>
                        </div>
                        <div className="home-panel-body home-quick-create">
                            {shortDramaEnabled ? <QuickItem icon={<FolderKanban className="size-4" />} title="创建短剧项目" description="从空白、小说或文本建立章节流程" href={projectHref} /> : null}
                            <QuickItem icon={<LayoutGrid className="size-4" />} title="打开自由画布" description="适合快速试图与提示词实验" onClick={onCreateIndependentCanvas} disabled={!canvasHydrated} />
                            <QuickItem icon={<Images className="size-4" />} title="进入素材库" description="整理角色、场景与媒体资产" href="/assets" />
                        </div>
                    </div>

                    <div className="home-panel">
                        <div className="home-panel-head">
                            <div>
                                <h2 className="home-panel-title">从工作流开始</h2>
                                <p className="home-panel-sub">整理故事 → 确认设定 → 制作镜头 → 检查结果</p>
                            </div>
                        </div>
                        <div className="home-panel-body">
                            <div className="home-workflow">
                                {workflow.map((item, index) => (
                                    <div key={item.title} className="home-workflow-step">
                                        <span className="home-workflow-num">0{index + 1}</span>
                                        <span className="min-w-0">
                                            <strong className="home-workflow-title block">{item.title}</strong>
                                            <span className="home-workflow-desc block">{item.description}</span>
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <p className="home-workflow-hint">{activeProject ? `${projectSummaryStage(activeProject).label} · ${projectSummaryCompletion(activeProject)}%` : "从一句话故事开始，逐步推进到可交付的镜头。"}</p>
                        </div>
                    </div>
                </div>
            </section>
        </>
    );
}

function StatCard({ icon, label, value, hint, to }: { icon: ReactNode; label: string; value: number; hint: string; to: string }) {
    return (
        <Link to={to} className="home-stat-card group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="home-stat-top">
                <span className="home-stat-icon">{icon}</span>
                <span className="home-stat-value">{value}</span>
            </span>
            <span>
                <span className="home-stat-label block">{label}</span>
                <span className="home-stat-hint block">{hint}</span>
            </span>
        </Link>
    );
}

function RecentProjectRow({ row }: { row: ProjectSummary }) {
    const completion = projectSummaryCompletion(row);
    const stage = projectSummaryStage(row);
    const archived = row.project.status === "archived";
    return (
        <Link to={`/projects/${row.project.id}/overview`} className="home-recent-row group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/20">
            <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                    <strong className="truncate text-sm font-medium">{row.project.name}</strong>
                    {archived ? <em className="home-stage-pill">已归档</em> : null}
                </span>
                <span className="mt-1 block truncate text-xs text-foreground/42">
                    {projectStyleTitle(row.project)} · {sourceTypeLabel(row.project.sourceType)} · {row.canvasCount} 画布 · {row.assetCount} 资产
                </span>
            </span>
            <span className="min-w-0">
                <span className="home-stage-pill">{stage.label}</span>
            </span>
            <span className="min-w-0">
                <span className="flex items-center justify-between text-[var(--fs-tiny)] text-foreground/42">
                    <span>
                        {row.completedUnitCount}/{row.unitCount} 章
                    </span>
                    <span>{completion}%</span>
                </span>
                <span className="home-progress-track mt-1.5">
                    <span className="home-progress-fill" style={{ width: `${completion}%` }} />
                </span>
            </span>
            <span className="text-xs text-foreground/45">{formatRelativeTime(row.project.updatedAt)}</span>
            <ArrowRight className="size-4 text-foreground/25 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/60" />
        </Link>
    );
}

function QuickItem({ icon, title, description, href, onClick, disabled }: { icon: ReactNode; title: string; description: string; href?: string; onClick?: () => void; disabled?: boolean }) {
    const content = (
        <>
            <span className="home-quick-icon">{icon}</span>
            <span className="min-w-0">
                <strong className="home-quick-title block">{title}</strong>
                <span className="home-quick-desc block">{description}</span>
            </span>
            <ArrowRight className="size-4 text-foreground/25 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/50" />
        </>
    );
    const className = "home-quick-item group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
    return href ? (
        <Link to={href} className={className}>
            {content}
        </Link>
    ) : (
        <button type="button" className={className} onClick={onClick} disabled={disabled}>
            {content}
        </button>
    );
}

function projectStyleTitle(project: ProjectSummary["project"]) {
    const projectStyle = resolveProjectCanvasStyle(project.stylePresetId, project.styleProfileJson);
    return projectStyle?.title || parseStyleProfile(project.styleProfileJson)?.title || resolveCanvasStylePreset(project.stylePresetId)?.title || (project.stylePresetId ? "自定义画风" : "未设置画风");
}

function sourceTypeLabel(value: string) {
    return sourceTypeLabels[value] || "其他来源";
}

function assetSummaryHint(counts: Partial<Record<AssetKind, number>>) {
    const parts = ASSET_KINDS.map(({ key, label }) => ({ label, count: counts[key] || 0 })).filter(({ count }) => count > 0);
    if (!parts.length) return "从画布或项目中沉淀素材";
    return parts
        .slice(0, 3)
        .map(({ label, count }) => `${label} ${count}`)
        .join(" · ");
}

function assetChartData(assets: ReturnType<typeof useAssetStore.getState>["assets"]) {
    const colors = [
        CHART_ACCENT,
        "color-mix(in srgb, var(--workspace-accent) 66%, transparent)",
        "color-mix(in srgb, var(--workspace-accent) 44%, transparent)",
        "color-mix(in srgb, var(--workspace-accent) 28%, transparent)",
        "color-mix(in srgb, var(--workspace-accent) 16%, transparent)",
    ];
    const counts = new Map<string, number>();
    for (const asset of assets) counts.set(asset.kind, (counts.get(asset.kind) || 0) + 1);
    const entries = ASSET_KINDS.filter(({ key }) => (counts.get(key) || 0) > 0);
    return entries.map(({ key, label }, index) => ({ name: label, value: counts.get(key) || 0, color: colors[index % colors.length] }));
}

function buildActivityBuckets(days: number, taskDates: number[], canvasDates: number[]) {
    const buckets: Array<{ label: string; tasks: number; canvases: number }> = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const day = new Date(today);
        day.setDate(today.getDate() - offset);
        const start = day.getTime();
        const end = start + 24 * 60 * 60 * 1000;
        buckets.push({
            label: `${day.getMonth() + 1}/${day.getDate()}`,
            tasks: taskDates.filter((time) => time >= start && time < end).length,
            canvases: canvasDates.filter((time) => time >= start && time < end).length,
        });
    }
    return buckets;
}

const tooltipStyle = {
    background: "var(--workspace-surface-strong)",
    border: "1px solid var(--workspace-border)",
    borderRadius: "var(--r-md)",
    boxShadow: "var(--elevation-card-hover)",
    fontSize: 12,
};

function formatRelativeTime(value: string) {
    const diffMinutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000);
    const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
    if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, "minute");
    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");
    const diffDays = Math.round(diffHours / 24);
    if (Math.abs(diffDays) < 30) return formatter.format(diffDays, "day");
    return new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
