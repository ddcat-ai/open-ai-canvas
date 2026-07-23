import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Form, Input, Modal, Select, Statistic, Table, Tag } from "antd";
import { ArrowLeft, ExternalLink, Link2, Plus, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { confirmProjectAssetCandidate, createProjectAssetVersion, createProjectUnit, createUnitWorkflow, getProject, linkProjectAsset, linkShotAsset, saveProjectShot, unlinkProjectAsset, updateWorkflowStep, type ProjectAsset, type ProjectAssetCandidate, type ProjectShot, type ProjectUnit, type ProjectWorkflow, type WorkflowStep } from "@/services/api/projects";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { useAssetStore, type AssetCategory, type AssetStatus } from "@/stores/use-asset-store";

type UnitForm = { title: string; sourceText?: string };
type ShotForm = { unitId?: string; title: string; description?: string; durationMs?: number };
const categoryOptions = [
    { label: "角色", value: "character" },
    { label: "场景", value: "environment" },
    { label: "服饰", value: "wardrobe" },
    { label: "道具", value: "prop" },
    { label: "武器", value: "weapon" },
    { label: "画风", value: "style" },
    { label: "其他", value: "other" },
];
const usageOptions = [
    { label: "普通参考", value: "reference" },
    { label: "首帧", value: "start_frame" },
    { label: "尾帧", value: "end_frame" },
    { label: "关键帧", value: "keyframe" },
    { label: "分镜", value: "storyboard" },
    { label: "产物", value: "output" },
];

export default function ProjectDetailPage() {
    const { projectId = "" } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const personalAssets = useAssetStore((state) => state.assets);
    const updatePersonalAsset = useAssetStore((state) => state.updateAsset);
    const [unitOpen, setUnitOpen] = useState(false);
    const [assetOpen, setAssetOpen] = useState(false);
    const [shotOpen, setShotOpen] = useState(false);
    const [shotAssetOpen, setShotAssetOpen] = useState(false);
    const [targetShotId, setTargetShotId] = useState("");
    const [shotAssetId, setShotAssetId] = useState("");
    const [shotAssetRole, setShotAssetRole] = useState("reference");
    const [candidateTarget, setCandidateTarget] = useState<ProjectAssetCandidate | null>(null);
    const [candidateAssetId, setCandidateAssetId] = useState("__new__");
    const [assetId, setAssetId] = useState("");
    const [assetCategory, setAssetCategory] = useState("character");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [mediaFilter, setMediaFilter] = useState("all");
    const [usageFilter, setUsageFilter] = useState("all");
    const detail = useQuery({ queryKey: ["project", projectId], queryFn: () => getProject(projectId), enabled: Boolean(projectId) });
    const refreshProject = () => {
        void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
    };
    const unitMutation = useMutation({
        mutationFn: (values: UnitForm) => createProjectUnit(projectId, { kind: "chapter", ...values, position: detail.data?.units.length || 0 }),
        onSuccess: () => { setUnitOpen(false); refreshProject(); },
        onError: (error) => message.error(error instanceof Error ? error.message : "章节创建失败"),
    });
    const assetMutation = useMutation({
        mutationFn: () => linkProjectAsset(projectId, { assetId, category: assetCategory }),
        onSuccess: ({ asset }) => {
            updatePersonalAsset(asset.id, { category: asset.category as AssetCategory, status: asset.status as AssetStatus, primaryVersionId: asset.primaryVersionId });
            setAssetOpen(false);
            setAssetId("");
            refreshProject();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "项目资产关联失败"),
    });
    const unlinkMutation = useMutation({
        mutationFn: (targetAssetId: string) => unlinkProjectAsset(projectId, targetAssetId),
        onSuccess: refreshProject,
        onError: (error) => message.error(error instanceof Error ? error.message : "项目资产移除失败"),
    });
    const versionMutation = useMutation({
        mutationFn: (targetAssetId: string) => createProjectAssetVersion(projectId, targetAssetId, {}),
        onSuccess: ({ version }) => { updatePersonalAsset(version.assetId, { primaryVersionId: version.id, status: "draft" }); refreshProject(); },
        onError: (error) => message.error(error instanceof Error ? error.message : "资产版本创建失败"),
    });
    const workflowMutation = useMutation({
        mutationFn: ({ stepId, status }: { stepId: string; status: string }) => updateWorkflowStep(projectId, stepId, { status }),
        onSuccess: refreshProject,
        onError: (error) => message.error(error instanceof Error ? error.message : "流程状态更新失败"),
    });
    const unitWorkflowMutation = useMutation({
        mutationFn: (unitId: string) => createUnitWorkflow(projectId, unitId),
        onSuccess: refreshProject,
        onError: (error) => message.error(error instanceof Error ? error.message : "章节流程创建失败"),
    });
    const candidateMutation = useMutation({
        mutationFn: () => confirmProjectAssetCandidate(projectId, candidateTarget?.id || "", candidateAssetId === "__new__" ? undefined : candidateAssetId),
        onSuccess: () => { setCandidateTarget(null); setCandidateAssetId("__new__"); refreshProject(); },
        onError: (error) => message.error(error instanceof Error ? error.message : "资产候选确认失败"),
    });
    const shotMutation = useMutation({
        mutationFn: (values: ShotForm) => saveProjectShot(projectId, { ...values, position: (detail.data?.shots || []).filter((shot) => shot.unitId === values.unitId).length, durationMs: Math.max(0, Number(values.durationMs || 0)) }),
        onSuccess: () => { setShotOpen(false); refreshProject(); },
        onError: (error) => message.error(error instanceof Error ? error.message : "镜头创建失败"),
    });
    const shotAssetMutation = useMutation({
        mutationFn: () => {
            const asset = detail.data?.assets.find((item) => item.id === shotAssetId);
            if (!asset?.primaryVersionId) throw new Error("所选资产还没有可引用版本");
            return linkShotAsset(projectId, targetShotId, { assetVersionId: asset.primaryVersionId, role: shotAssetRole });
        },
        onSuccess: () => { setShotAssetOpen(false); setShotAssetId(""); refreshProject(); },
        onError: (error) => message.error(error instanceof Error ? error.message : "镜头素材关联失败"),
    });
    const visibleAssets = useMemo(() => (detail.data?.assets || []).filter((asset) => (categoryFilter === "all" || asset.category === categoryFilter) && (mediaFilter === "all" || asset.mediaType === mediaFilter) && (usageFilter === "all" || (asset.usages || []).includes(usageFilter))), [categoryFilter, detail.data?.assets, mediaFilter, usageFilter]);
    const createCanvas = () => {
        void createCanvasProjectWithRemoteSync(`${detail.data?.project.name || "项目"} · 新画布`, projectId).then(({ id, syncError }) => {
            if (syncError) {
                message.error(syncError instanceof Error ? `画布已本地创建，但项目关联同步失败：${syncError.message}` : "画布已本地创建，但项目关联同步失败");
                return;
            }
            navigate(`/canvas/${id}`);
        });
    };

    if (detail.isLoading) return <WorkspacePage><div className="py-16 text-center text-sm text-foreground/50">正在加载项目...</div></WorkspacePage>;
    if (detail.isError || !detail.data) return <WorkspacePage><Empty description="项目不存在或无权访问"><Button onClick={() => navigate("/projects")}>返回项目中心</Button></Empty></WorkspacePage>;
    const { project, units, canvases, workflows = [], shots = [], shotReferences = [], assetCandidates = [] } = detail.data;
    const completed = units.filter((unit) => unit.status === "completed").length;
    const projectWorkflow = workflows.find((workflow) => workflow.instance.scope === "project");
    const pendingCandidates = assetCandidates.filter((candidate) => candidate.status === "pending_confirmation");
    return (
        <WorkspacePage>
            <PageHeader title={project.name} description={`${project.aspectRatio} · ${sourceLabel(project.sourceType)}`} meta={<Tag color={project.status === "active" ? "blue" : "default"}>{project.status === "active" ? "进行中" : "已归档"}</Tag>} actions={<><Button icon={<ArrowLeft className="size-3.5" />} onClick={() => navigate("/projects")}>项目中心</Button><Button type="primary" icon={<Plus className="size-3.5" />} onClick={createCanvas}>创建项目画布</Button></>} />
            <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Metric label="章节" value={units.length} suffix={units.length ? `已完成 ${completed}` : undefined} />
                <Metric label="画布" value={canvases.length} />
                <Metric label="项目资产" value={(detail.data.assets || []).length} />
                <Metric label="待确认资产" value={pendingCandidates.length} />
                <Metric label="流程完成" value={projectWorkflow?.steps.filter((step) => step.status === "completed").length || 0} suffix={`共 ${projectWorkflow?.steps.length || 0} 阶段`} />
            </section>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
                <section className="overflow-hidden rounded-lg border border-border bg-background">
                    <SectionHeader title="故事与章节" action={<Button size="small" icon={<Plus className="size-3.5" />} onClick={() => setUnitOpen(true)}>添加章节</Button>} />
                    <Table<ProjectUnit> rowKey="id" dataSource={units} pagination={false} locale={{ emptyText: "还没有章节，先添加一个章节" }} columns={[{ title: "章节", key: "title", render: (_, unit) => <span className="font-medium">第 {String(unit.position + 1).padStart(2, "0")} 章 {unit.title}</span> }, { title: "状态", dataIndex: "status", key: "status", render: (status: string) => <StatusTag status={status} /> }, { title: "制作流程", key: "workflow", render: (_, unit) => workflows.some((workflow) => workflow.instance.unitId === unit.id) ? <span className="text-xs text-foreground/50">已建立</span> : <Button size="small" loading={unitWorkflowMutation.isPending} onClick={() => unitWorkflowMutation.mutate(unit.id)}>建立流程</Button> }, { title: "更新", dataIndex: "updatedAt", key: "updatedAt", render: formatTime }]} />
                </section>
                <section className="overflow-hidden rounded-lg border border-border bg-background">
                    <SectionHeader title="项目画布" description="删除项目只解除关系，不删除画布文档。" />
                    {canvases.length ? <div className="divide-y divide-border">{canvases.map((canvas) => <Link key={canvas.id} to={`/canvas/${canvas.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-foreground/[.03]"><span className="min-w-0 truncate text-sm font-medium">{canvas.title}</span><span className="flex shrink-0 items-center gap-1 text-xs text-foreground/45"><ExternalLink className="size-3.5" />打开</span></Link>)}</div> : <div className="px-4 py-10 text-center text-sm text-foreground/50">还没有项目画布</div>}
                </section>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <section className="overflow-hidden rounded-lg border border-border bg-background">
                    <SectionHeader title="待确认资产" description="Agent 识别结果先审核，再进入正式资产库。" />
                    <Table<ProjectAssetCandidate> size="small" rowKey="id" dataSource={assetCandidates} pagination={false} locale={{ emptyText: "暂无资产候选" }} columns={[{ title: "名称", dataIndex: "name", key: "name", render: (value: string) => <span className="font-medium">{value}</span> }, { title: "分类", dataIndex: "category", key: "category", render: categoryLabel }, { title: "来源", key: "source", render: (_, candidate) => candidate.shotId ? "镜头" : candidate.unitId ? units.find((unit) => unit.id === candidate.unitId)?.title || "章节" : "项目" }, { title: "状态", dataIndex: "status", key: "status", render: (status: string) => <StatusTag status={status} /> }, { title: "", key: "action", width: 72, render: (_, candidate) => candidate.status === "pending_confirmation" ? <Button size="small" onClick={() => { setCandidateTarget(candidate); setCandidateAssetId("__new__"); }}>确认</Button> : null }]} />
                </section>
                <section className="overflow-hidden rounded-lg border border-border bg-background">
                    <SectionHeader title="镜头" description="素材用途属于镜头上下文，并固定到具体资产版本。" action={<Button size="small" icon={<Plus className="size-3.5" />} onClick={() => setShotOpen(true)}>添加镜头</Button>} />
                    <Table<ProjectShot> size="small" rowKey="id" dataSource={shots} pagination={false} locale={{ emptyText: "暂无镜头" }} columns={[{ title: "镜头", dataIndex: "title", key: "title", render: (value: string) => <span className="font-medium">{value}</span> }, { title: "章节", key: "unit", render: (_, shot) => units.find((unit) => unit.id === shot.unitId)?.title || "未关联" }, { title: "时长", dataIndex: "durationMs", key: "duration", render: (value: number) => value ? `${(value / 1000).toFixed(1)} 秒` : "-" }, { title: "用途", key: "references", render: (_, shot) => { const roles = shotReferences.filter((item) => item.shotId === shot.id).map((item) => item.role); return roles.length ? <span className="flex flex-wrap gap-1">{roles.map((role) => <Tag key={`${shot.id}-${role}`} className="m-0">{usageLabel(role)}</Tag>)}</span> : <span className="text-foreground/40">缺少参考</span>; } }, { title: "", key: "action", width: 48, render: (_, shot) => <Button type="text" icon={<Link2 className="size-3.5" />} title="关联素材" aria-label={`为 ${shot.title} 关联素材`} onClick={() => { setTargetShotId(shot.id); setShotAssetOpen(true); }} /> }]} />
                </section>
            </div>

            <section className="mt-6 overflow-hidden rounded-lg border border-border bg-background">
                <SectionHeader title="项目资产" description="业务分类与媒体类型独立，加入项目只建立引用。" action={<Button size="small" icon={<Plus className="size-3.5" />} onClick={() => setAssetOpen(true)}>引用个人素材</Button>} />
                <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3"><Select className="w-36" value={categoryFilter} onChange={setCategoryFilter} options={[{ label: "全部分类", value: "all" }, ...categoryOptions]} /><Select className="w-36" value={mediaFilter} onChange={setMediaFilter} options={[{ label: "全部媒体", value: "all" }, { label: "图片", value: "image" }, { label: "视频", value: "video" }, { label: "文本", value: "text" }, { label: "3D 模型", value: "model" }]} /><Select className="w-36" value={usageFilter} onChange={setUsageFilter} options={[{ label: "全部用途", value: "all" }, ...usageOptions]} /></div>
                <Table<ProjectAsset> rowKey="id" dataSource={visibleAssets} pagination={false} locale={{ emptyText: "当前筛选下没有项目资产" }} columns={[{ title: "资产", dataIndex: "title", key: "title", render: (value: string) => <span className="font-medium">{value}</span> }, { title: "业务分类", dataIndex: "category", key: "category", render: categoryLabel }, { title: "媒体", dataIndex: "mediaType", key: "mediaType", render: mediaLabel }, { title: "用途", dataIndex: "usages", key: "usages", render: (values: string[]) => values?.length ? <span className="flex flex-wrap gap-1">{values.map((value) => <Tag key={value} className="m-0">{usageLabel(value)}</Tag>)}</span> : "-" }, { title: "版本", dataIndex: "versionCount", key: "versionCount", render: (value: number) => `v${Math.max(1, value)}` }, { title: "状态", dataIndex: "status", key: "status", render: (value: string) => <StatusTag status={value} /> }, { title: "", key: "action", width: 96, render: (_, asset) => <div className="flex"><Button type="text" aria-label={`为 ${asset.title} 创建新版本`} title="创建新版本" icon={<Plus className="size-3.5" />} loading={versionMutation.isPending} onClick={() => versionMutation.mutate(asset.id)} /><Button danger type="text" aria-label={`从项目移除 ${asset.title}`} title="移出项目" icon={<Trash2 className="size-3.5" />} loading={unlinkMutation.isPending} onClick={() => unlinkMutation.mutate(asset.id)} /></div> }]} />
            </section>

            <section className="mt-6 overflow-hidden rounded-lg border border-border bg-background">
                <SectionHeader title="制作流程" description="流程状态独立保存在后端，不扫描画布节点。" />
                {projectWorkflow ? <WorkflowMatrix units={units} workflows={workflows} loading={workflowMutation.isPending} onAdvance={(stepId, status) => workflowMutation.mutate({ stepId, status })} /> : <div className="px-4 py-10 text-center text-sm text-foreground/50">暂无流程实例</div>}
            </section>

            <Modal title="添加章节" open={unitOpen} footer={null} destroyOnClose onCancel={() => setUnitOpen(false)}><Form<UnitForm> layout="vertical" className="mt-4" onFinish={(values) => unitMutation.mutate(values)}><Form.Item name="title" label="章节标题" rules={[{ required: true, whitespace: true, message: "请输入章节标题" }]}><Input autoFocus placeholder="例如：雨夜归城" /></Form.Item><Form.Item name="sourceText" label="原文（可选）"><Input.TextArea rows={5} placeholder="粘贴章节原文，后续可在审核工作区继续编辑" /></Form.Item><div className="flex justify-end gap-2"><Button onClick={() => setUnitOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={unitMutation.isPending}>保存章节</Button></div></Form></Modal>
            <Modal title="添加镜头" open={shotOpen} footer={null} destroyOnClose onCancel={() => setShotOpen(false)}><Form<ShotForm> layout="vertical" className="mt-4" onFinish={(values) => shotMutation.mutate(values)}><Form.Item name="unitId" label="所属章节"><Select allowClear options={units.map((unit) => ({ label: unit.title, value: unit.id }))} /></Form.Item><Form.Item name="title" label="镜头标题" rules={[{ required: true, whitespace: true, message: "请输入镜头标题" }]}><Input autoFocus placeholder="例如：雨巷中回头" /></Form.Item><Form.Item name="description" label="镜头描述"><Input.TextArea rows={3} /></Form.Item><Form.Item name="durationMs" label="时长（毫秒）"><Input type="number" min={0} placeholder="例如：3000" /></Form.Item><div className="flex justify-end gap-2"><Button onClick={() => setShotOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={shotMutation.isPending}>保存镜头</Button></div></Form></Modal>
            <Modal title="确认资产候选" open={Boolean(candidateTarget)} okText="确认进入资产库" cancelText="取消" okButtonProps={{ loading: candidateMutation.isPending }} onCancel={() => setCandidateTarget(null)} onOk={() => candidateMutation.mutate()}><div className="mt-4 grid gap-3"><div className="text-sm">候选：<strong>{candidateTarget?.name}</strong> · {categoryLabel(candidateTarget?.category || "other")}</div><label className="grid gap-2 text-sm"><span>关联方式</span><Select value={candidateAssetId} options={[{ label: "创建新的正式资产", value: "__new__" }, ...personalAssets.map((asset) => ({ label: `关联已有：${asset.title}`, value: asset.id }))]} onChange={setCandidateAssetId} /></label></div></Modal>
            <Modal title="关联镜头素材" open={shotAssetOpen} okText="保存关联" cancelText="取消" okButtonProps={{ disabled: !shotAssetId, loading: shotAssetMutation.isPending }} onCancel={() => setShotAssetOpen(false)} onOk={() => shotAssetMutation.mutate()}><div className="mt-4 grid gap-3"><label className="grid gap-2 text-sm"><span>项目资产版本</span><Select showSearch optionFilterProp="label" value={shotAssetId || undefined} placeholder="选择有主版本的资产" options={detail.data.assets.filter((asset) => asset.primaryVersionId).map((asset) => ({ label: `${asset.title} · v${asset.versionCount}`, value: asset.id }))} onChange={setShotAssetId} /></label><label className="grid gap-2 text-sm"><span>素材用途</span><Select value={shotAssetRole} options={usageOptions} onChange={setShotAssetRole} /></label></div></Modal>
            <Modal title="引用个人素材" open={assetOpen} okText="加入项目" cancelText="取消" okButtonProps={{ disabled: !assetId, loading: assetMutation.isPending }} onCancel={() => setAssetOpen(false)} onOk={() => assetMutation.mutate()}><div className="mt-4 grid gap-4"><label className="grid gap-2 text-sm"><span>个人素材</span><Select showSearch optionFilterProp="label" value={assetId || undefined} placeholder="选择已有素材" options={personalAssets.map((asset) => ({ label: asset.title, value: asset.id }))} onChange={setAssetId} /></label><label className="grid gap-2 text-sm"><span>业务分类</span><Select value={assetCategory} options={categoryOptions} onChange={setAssetCategory} /></label></div></Modal>
        </WorkspacePage>
    );
}

function Metric({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
    return <div className="rounded-lg border border-border bg-background px-4 py-3"><Statistic title={label} value={value} valueStyle={{ fontSize: 24, lineHeight: 1.2 }} /><div className="mt-1 min-h-4 text-xs text-foreground/50">{suffix}</div></div>;
}

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
    return <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4 py-3"><div><h2 className="font-semibold">{title}</h2>{description ? <p className="mt-1 text-xs text-foreground/55">{description}</p> : null}</div>{action}</div>;
}

function WorkflowMatrix({ units, workflows, loading, onAdvance }: { units: ProjectUnit[]; workflows: ProjectWorkflow[]; loading: boolean; onAdvance: (stepId: string, status: string) => void }) {
    const projectWorkflow = workflows.find((workflow) => workflow.instance.scope === "project");
    const templateSteps = projectWorkflow?.steps || [];
    const rows = [{ label: "项目总览", workflow: projectWorkflow }, ...units.map((unit) => ({ label: unit.title, workflow: workflows.find((workflow) => workflow.instance.unitId === unit.id) }))];
    return <div className="overflow-x-auto"><div className="min-w-[980px]"><div className="grid grid-cols-[minmax(140px,1fr)_repeat(7,minmax(110px,1fr))] border-b border-border bg-foreground/[.02] text-xs text-foreground/50"><div className="px-3 py-2">范围</div>{templateSteps.map((step) => <div key={step.id} className="border-l border-border px-3 py-2">{step.name}</div>)}</div>{rows.map((row) => <div key={row.label} className="grid grid-cols-[minmax(140px,1fr)_repeat(7,minmax(110px,1fr))] border-b border-border last:border-b-0"><div className="flex items-center px-3 py-3 text-sm font-medium">{row.label}</div>{templateSteps.map((templateStep) => { const step = row.workflow?.steps.find((item) => item.stepKey === templateStep.stepKey); return <div key={`${row.label}-${templateStep.stepKey}`} className="border-l border-border">{step ? <WorkflowCell step={step} loading={loading} onAdvance={(status) => onAdvance(step.id, status)} /> : <div className="px-3 py-5 text-xs text-foreground/30">未建立</div>}</div>; })}</div>)}</div></div>;
}

function WorkflowCell({ step, loading, onAdvance }: { step: WorkflowStep; loading: boolean; onAdvance: (status: string) => void }) {
    const next = nextWorkflowStatus(step.status);
    return <div className="min-w-0 px-3 py-4"><div className="text-xs font-semibold">{step.name}</div><div className="mt-2"><StatusTag status={step.status} /></div>{next ? <Button className="mt-3" size="small" loading={loading} onClick={() => onAdvance(next.status)}>{next.label}</Button> : <div className="mt-3 h-6" />}</div>;
}

function nextWorkflowStatus(status: string) {
    if (status === "ready" || status === "failed") return { status: "running", label: "开始" };
    if (status === "running") return { status: "review", label: "送审" };
    if (status === "review") return { status: "completed", label: "完成" };
    return null;
}

function usageLabel(value: string) {
    return usageOptions.find((item) => item.value === value)?.label || value;
}

function StatusTag({ status }: { status: string }) {
    const labels: Record<string, string> = { draft: "草稿", confirmed: "已确认", pending: "未开始", ready: "就绪", running: "运行中", review: "待审核", completed: "已完成", failed: "失败", skipped: "已跳过", archived: "已归档" };
    const colors: Record<string, string> = { ready: "blue", running: "processing", review: "gold", completed: "green", failed: "red", confirmed: "green" };
    return <Tag color={colors[status] || "default"}>{labels[status] || status}</Tag>;
}

function categoryLabel(value: string) {
    return categoryOptions.find((item) => item.value === value)?.label || "其他";
}

function mediaLabel(value: string) {
    return ({ image: "图片", video: "视频", text: "文本", model: "3D 模型" } as Record<string, string>)[value] || value;
}

function sourceLabel(value: string) {
    return value === "blank" ? "空白开始" : value === "novel" ? "小说导入" : "文本来源";
}

function formatTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
