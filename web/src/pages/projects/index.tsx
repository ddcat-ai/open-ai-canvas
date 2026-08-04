import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal, Select } from "antd";
import { ArrowRight, BookOpenText, FolderKanban, Images, LayoutGrid, Plus, Search } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { ListToolbar, PageHeader, TableSurface, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { resolveCanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { projectSummaryCompletion, projectSummaryStage } from "@/lib/project-workbench";
import { createProject, listProjects, type ProjectSummary } from "@/services/api/projects";

import { sourceTypeLabel } from "./detail/shared";

type ProjectForm = { name: string; aspectRatio: string; sourceType: string };

export default function ProjectsPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<"all" | "active" | "archived">("all");
    const [sort, setSort] = useState<"updated" | "progress" | "name">("updated");
    const createOpen = searchParams.get("create") === "1";
    const setCreateOpen = (open: boolean) => {
        const next = new URLSearchParams(searchParams);
        if (open) next.set("create", "1");
        else next.delete("create");
        setSearchParams(next, { replace: true });
    };
    const query = useQuery({ queryKey: ["projects"], queryFn: listProjects });
    const mutation = useMutation({
        mutationFn: createProject,
        onSuccess: ({ project }) => {
            setCreateOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            navigate(`/projects/${project.id}/overview`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "项目创建失败"),
    });
    const rows = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        return [...(query.data?.projects || [])]
            .filter(({ project }) => status === "all" || project.status === status)
            .filter(({ project }) => !normalizedKeyword || `${project.name} ${project.description} ${project.stylePresetId} ${resolveCanvasStylePreset(project.stylePresetId)?.title || ""}`.toLowerCase().includes(normalizedKeyword))
            .sort((left, right) => {
                if (sort === "name") return left.project.name.localeCompare(right.project.name, "zh-CN");
                if (sort === "progress") return projectSummaryCompletion(right) - projectSummaryCompletion(left);
                return right.project.updatedAt.localeCompare(left.project.updatedAt);
            });
    }, [keyword, query.data, sort, status]);

    return (
        <WorkspacePage>
            <PageHeader
                icon="projects"
                title="短剧创作"
                description="按制作阶段查看故事项目，继续最近工作或处理未完成章节。"
                meta={<span className="text-xs text-foreground/45">{rows.length} 个</span>}
                actions={<Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>创建项目</Button>}
            />
            <ListToolbar active={Boolean(keyword || status !== "all" || sort !== "updated")} onReset={() => { setKeyword(""); setStatus("all"); setSort("updated"); }}>
                <Input allowClear className="app-list-search" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索项目、简介或画风" onChange={(event) => setKeyword(event.target.value)} />
                <Select className="w-32" value={status} onChange={setStatus} options={[{ label: "全部状态", value: "all" }, { label: "进行中", value: "active" }, { label: "已归档", value: "archived" }]} />
                <Select className="w-32" value={sort} onChange={setSort} options={[{ label: "最近更新", value: "updated" }, { label: "章节进度", value: "progress" }, { label: "项目名称", value: "name" }]} />
            </ListToolbar>

            {query.isError ? <WorkspaceErrorState description={query.error instanceof Error ? query.error.message : "项目列表加载失败"} onRetry={() => void query.refetch()} /> : null}
            {query.isLoading ? <WorkspaceLoadingState label="正在整理项目" detail="读取章节、画布与资产进度" /> : null}
            {!query.isLoading && rows.length ? (
                <TableSurface>
                    <div className="hidden h-10 grid-cols-[minmax(240px,1.2fr)_minmax(150px,.75fr)_minmax(150px,.7fr)_minmax(180px,.8fr)_120px_28px] items-center gap-4 border-b border-border/70 bg-foreground/[.025] px-4 text-[var(--fs-label)] font-medium text-foreground/42 lg:grid">
                        <span>项目</span><span>当前阶段</span><span>章节进度</span><span>内容</span><span>最近更新</span><span />
                    </div>
                    <div className="divide-y divide-border/65">
                        {rows.map((row) => <ProjectRow key={row.project.id} row={row} />)}
                    </div>
                </TableSurface>
            ) : null}
            {!query.isLoading && !rows.length && !query.isError ? (
                <WorkspaceState
                    icon="projects"
                    title={keyword || status !== "all" ? "没有匹配的项目" : "创建第一个故事项目"}
                    description={keyword || status !== "all" ? "调整搜索词或状态筛选后再试。" : "项目会集中保存章节、项目画布、角色场景和制作进度。自由试图可从画布开始。"}
                    action={!keyword && status === "all" ? <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>创建项目</Button> : undefined}
                />
            ) : null}

            <Modal title="创建短剧项目" open={createOpen} footer={null} destroyOnHidden onCancel={() => setCreateOpen(false)} width={500} styles={{ body: { paddingTop: 12 } }}>
                <Form<ProjectForm> layout="vertical" initialValues={{ aspectRatio: "9:16", sourceType: "blank" }} onFinish={(values) => mutation.mutate({ ...values, type: "short-drama" })}>
                    <Form.Item name="name" label="项目名称" rules={[{ required: true, whitespace: true, message: "请输入项目名称" }]}><Input autoFocus placeholder="例如：长安夜行" /></Form.Item>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="aspectRatio" label="默认画幅"><Select options={[{ label: "9:16 竖屏", value: "9:16" }, { label: "16:9 横屏", value: "16:9" }, { label: "1:1 方形", value: "1:1" }]} /></Form.Item>
                        <Form.Item name="sourceType" label="内容来源"><Select options={[{ label: "空白开始", value: "blank" }, { label: "导入小说", value: "novel" }, { label: "粘贴文本", value: "text" }]} /></Form.Item>
                    </div>
                    <p className="-mt-1 mb-5 text-xs leading-5 text-foreground/48">创建后先进入项目概览。章节、画风和参考资产可以逐步补充。</p>
                    <div className="flex justify-end gap-2"><Button onClick={() => setCreateOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>创建项目</Button></div>
                </Form>
            </Modal>
        </WorkspacePage>
    );
}

function ProjectRow({ row }: { row: ProjectSummary }) {
    const completion = projectSummaryCompletion(row);
    const stage = projectSummaryStage(row);
    const styleTitle = resolveCanvasStylePreset(row.project.stylePresetId)?.title || (row.project.stylePresetId ? "自定义画风" : "未设置画风");
    return (
        <Link to={`/projects/${row.project.id}/overview`} className="group block min-w-0 px-3 py-3 transition-colors hover:bg-foreground/[.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/20 sm:px-4 lg:grid lg:min-h-[76px] lg:grid-cols-[minmax(240px,1.2fr)_minmax(150px,.75fr)_minmax(150px,.7fr)_minmax(180px,.8fr)_120px_28px] lg:items-center lg:gap-4 lg:py-2.5">
            <span className="flex min-w-0 items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground/[.06] text-foreground/50"><FolderKanban className="size-4" /></span>
                <span className="min-w-0"><span className="flex min-w-0 items-center gap-2"><strong className="truncate text-sm font-semibold">{row.project.name}</strong>{row.project.status === "archived" ? <span className="shrink-0 rounded bg-foreground/[.07] px-1.5 py-0.5 text-[var(--fs-tiny)] text-foreground/45">已归档</span> : null}</span><span className="mt-1 block truncate text-[var(--fs-label)] text-foreground/42">{styleTitle} · {row.project.aspectRatio} · {sourceTypeLabel(row.project.sourceType)}</span></span>
            </span>

            <span className="mt-3 grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2 lg:mt-0 lg:block">
                <span className="text-[var(--fs-tiny)] text-foreground/38 lg:hidden">当前阶段</span>
                <span className="min-w-0"><span className="block text-xs font-medium text-foreground/78">{stage.label}</span><span className="mt-1 line-clamp-1 block text-[var(--fs-tiny)] text-foreground/40">{stage.detail}</span></span>
            </span>

            <span className="mt-3 grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 lg:mt-0 lg:block">
                <span className="text-[var(--fs-tiny)] text-foreground/38 lg:hidden">章节进度</span>
                <span className="min-w-0"><span className="flex items-center justify-between text-[var(--fs-tiny)] text-foreground/48"><span>{row.completedUnitCount}/{row.unitCount} 章</span><span>{completion}%</span></span><span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-foreground/[.08]"><span className="block h-full rounded-full bg-[var(--workspace-accent)] transition-[width]" style={{ width: `${completion}%` }} /></span></span>
            </span>

            <span className="mt-3 flex items-center gap-4 text-[var(--fs-label)] text-foreground/50 lg:mt-0">
                <ProjectCount icon={<BookOpenText className="size-3.5" />} label="章节" value={row.unitCount} />
                <ProjectCount icon={<LayoutGrid className="size-3.5" />} label="画布" value={row.canvasCount} />
                <ProjectCount icon={<Images className="size-3.5" />} label="资产" value={row.assetCount} />
            </span>
            <span className="mt-3 block text-[var(--fs-label)] tabular-nums text-foreground/42 lg:mt-0">{formatProjectTime(row.project.updatedAt)}</span>
            <ArrowRight className="hidden size-4 text-foreground/25 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/60 lg:block" />
        </Link>
    );
}

function ProjectCount({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
    return <span className="inline-flex items-center gap-1.5" title={`${value} ${label}`}><span className="text-foreground/32">{icon}</span><strong className="font-medium tabular-nums text-foreground/65">{value}</strong><span className="hidden 2xl:inline">{label}</span></span>;
}

function formatProjectTime(value: string) {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
