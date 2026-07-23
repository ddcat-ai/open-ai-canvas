import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Form, Input, Modal, Statistic, Table, Tag } from "antd";
import { ArrowLeft, ExternalLink, Plus } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { createProjectUnit, getProject, type ProjectUnit } from "@/services/api/projects";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";

type UnitForm = { title: string; sourceText?: string };

export default function ProjectDetailPage() {
    const { projectId = "" } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const [unitOpen, setUnitOpen] = useState(false);
    const detail = useQuery({ queryKey: ["project", projectId], queryFn: () => getProject(projectId), enabled: Boolean(projectId) });
    const unitMutation = useMutation({
        mutationFn: (values: UnitForm) => createProjectUnit(projectId, { kind: "chapter", ...values, position: detail.data?.units.length || 0 }),
        onSuccess: () => { setUnitOpen(false); void queryClient.invalidateQueries({ queryKey: ["project", projectId] }); void queryClient.invalidateQueries({ queryKey: ["projects"] }); },
        onError: (error) => message.error(error instanceof Error ? error.message : "章节创建失败"),
    });
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
    const { project, units, canvases } = detail.data;
    const completed = units.filter((unit) => unit.status === "completed").length;
    return (
        <WorkspacePage>
            <PageHeader title={project.name} description={`${project.aspectRatio} · ${project.sourceType === "blank" ? "空白开始" : project.sourceType === "novel" ? "小说导入" : "文本来源"}`} meta={<Tag color={project.status === "active" ? "blue" : "default"}>{project.status === "active" ? "进行中" : "已归档"}</Tag>} actions={<><Button icon={<ArrowLeft className="size-3.5" />} onClick={() => navigate("/projects")}>项目中心</Button><Button type="primary" icon={<Plus className="size-3.5" />} onClick={createCanvas}>创建项目画布</Button></>} />
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Metric label="章节" value={units.length} suffix={units.length ? `已完成 ${completed}` : undefined} />
                <Metric label="画布" value={canvases.length} />
                <Metric label="待处理" value={units.filter((unit) => unit.status !== "completed").length} />
                <Metric label="版本" value={project.revision} />
            </section>
            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
                <section className="overflow-hidden rounded-lg border border-border bg-background">
                    <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="font-semibold">故事与章节</h2><Button size="small" icon={<Plus className="size-3.5" />} onClick={() => setUnitOpen(true)}>添加章节</Button></div>
                    <Table<ProjectUnit> rowKey="id" dataSource={units} pagination={false} locale={{ emptyText: "还没有章节，先添加一个章节" }} columns={[{ title: "章节", key: "title", render: (_, unit) => <span className="font-medium">第 {String(unit.position + 1).padStart(2, "0")} 章 {unit.title}</span> }, { title: "状态", dataIndex: "status", key: "status", render: (status: string) => <Tag color={status === "completed" ? "green" : "default"}>{status === "completed" ? "已完成" : "草稿"}</Tag> }, { title: "更新", dataIndex: "updatedAt", key: "updatedAt", render: (value: string) => formatTime(value) }]} />
                </section>
                <section className="overflow-hidden rounded-lg border border-border bg-background">
                    <div className="border-b border-border px-4 py-3"><h2 className="font-semibold">项目画布</h2><p className="mt-1 text-xs text-foreground/55">画布只保存空间编排，章节关系由项目域单独维护。</p></div>
                    {canvases.length ? <div className="divide-y divide-border">{canvases.map((canvas) => <Link key={canvas.id} to={`/canvas/${canvas.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-foreground/[.03]"><span className="min-w-0 truncate text-sm font-medium">{canvas.title}</span><span className="flex shrink-0 items-center gap-1 text-xs text-foreground/45"><ExternalLink className="size-3.5" />打开</span></Link>)}</div> : <div className="px-4 py-10 text-center text-sm text-foreground/50">还没有项目画布</div>}
                </section>
            </div>
            <Modal title="添加章节" open={unitOpen} footer={null} destroyOnClose onCancel={() => setUnitOpen(false)}><Form<UnitForm> layout="vertical" className="mt-4" onFinish={(values) => unitMutation.mutate(values)}><Form.Item name="title" label="章节标题" rules={[{ required: true, whitespace: true, message: "请输入章节标题" }]}><Input autoFocus placeholder="例如：雨夜归城" /></Form.Item><Form.Item name="sourceText" label="原文（可选）"><Input.TextArea rows={5} placeholder="粘贴章节原文，后续可在审核工作区继续编辑" /></Form.Item><div className="flex justify-end gap-2"><Button onClick={() => setUnitOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={unitMutation.isPending}>保存章节</Button></div></Form></Modal>
        </WorkspacePage>
    );
}

function Metric({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
    return <div className="rounded-lg border border-border bg-background px-4 py-3"><Statistic title={label} value={value} valueStyle={{ fontSize: 24, lineHeight: 1.2 }} /><div className="mt-1 min-h-4 text-xs text-foreground/50">{suffix}</div></div>;
}

function formatTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
