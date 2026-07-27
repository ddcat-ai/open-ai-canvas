import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Input, InputNumber, Modal, Select, Tooltip } from "antd";
import { Archive, Check, Save, ShieldAlert } from "lucide-react";

import { canvasStylePresets } from "@/components/canvas/canvas-style-picker-modal";
import { updateProject } from "@/services/api/projects";

import type { ProjectDetailViewProps } from "./shared";

export default function ProjectSettingsView({ detail, refreshProject }: ProjectDetailViewProps) {
    const { message } = App.useApp();
    const { project } = detail;
    const [name, setName] = useState(project.name);
    const [description, setDescription] = useState(project.description || "");
    const [aspectRatio, setAspectRatio] = useState(project.aspectRatio);
    const [sourceType, setSourceType] = useState(project.sourceType);
    const [stylePresetId, setStylePresetId] = useState(project.stylePresetId || "");
    const [activeTaskLimit, setActiveTaskLimit] = useState(project.activeTaskLimit || 3);
    const [archiveOpen, setArchiveOpen] = useState(false);
    useEffect(() => { setName(project.name); setDescription(project.description || ""); setAspectRatio(project.aspectRatio); setSourceType(project.sourceType); setStylePresetId(project.stylePresetId || ""); setActiveTaskLimit(project.activeTaskLimit || 3); }, [project]);
    const dirty = useMemo(() => name.trim() !== project.name || description !== (project.description || "") || aspectRatio !== project.aspectRatio || sourceType !== project.sourceType || stylePresetId !== (project.stylePresetId || "") || activeTaskLimit !== (project.activeTaskLimit || 3), [activeTaskLimit, aspectRatio, description, name, project, sourceType, stylePresetId]);
    const saveMutation = useMutation({ mutationFn: () => updateProject(project.id, { name: name.trim(), description, aspectRatio, sourceType, stylePresetId, activeTaskLimit }), onSuccess: () => { refreshProject(); message.success("项目设置已保存"); }, onError: (error) => message.error(error instanceof Error ? error.message : "项目设置保存失败") });
    const archiveMutation = useMutation({ mutationFn: () => updateProject(project.id, { status: project.status === "archived" ? "active" : "archived" }), onSuccess: () => { setArchiveOpen(false); refreshProject(); message.success(project.status === "archived" ? "项目已恢复" : "项目已归档"); }, onError: (error) => message.error(error instanceof Error ? error.message : "项目状态更新失败") });

    return (
        <div>
            <header className="flex items-end justify-between gap-3 border-b border-border/70 pb-3"><div><h2 className="text-lg font-semibold">项目设置</h2><p className="mt-1 text-xs text-foreground/48">基础信息、项目画风与运行限额</p></div><Button type={dirty ? "primary" : "default"} icon={dirty ? <Save className="size-3.5" /> : <Check className="size-3.5" />} disabled={!dirty || !name.trim()} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{dirty ? "保存设置" : "已保存"}</Button></header>

            <section className="border-b border-border/70 py-4">
                <h3 className="mb-3 text-sm font-semibold">基础设置</h3>
                <div className="grid gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
                    <Field label="项目名称" className="xl:col-span-2"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
                    <Field label="默认画幅"><Select className="w-full" value={aspectRatio} options={[{ label: "9:16 · 竖屏短剧", value: "9:16" }, { label: "16:9 · 横屏", value: "16:9" }, { label: "1:1 · 方形", value: "1:1" }]} onChange={setAspectRatio} /></Field>
                    <Field label="内容来源"><Select className="w-full" value={sourceType} options={[{ label: "空白开始", value: "blank" }, { label: "导入小说", value: "novel" }, { label: "粘贴文本", value: "text" }]} onChange={setSourceType} /></Field>
                    <Field label="项目简介" className="md:col-span-2 xl:col-span-3"><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="一句话说明项目目标" /></Field>
                    <Field label="活跃任务上限（个）"><InputNumber className="!w-full" min={1} max={20} value={activeTaskLimit} onChange={(value) => setActiveTaskLimit(value || 1)} /></Field>
                </div>
            </section>

            <section className="border-b border-border/70 py-4">
                <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">项目画风</h3><p className="mt-0.5 text-[11px] text-foreground/45">选择后会同步到项目画布中的画风节点</p></div>{stylePresetId ? <span className="text-[11px] text-[var(--workspace-accent)]">已选择</span> : <span className="text-[11px] text-foreground/40">未设置</span>}</div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {canvasStylePresets.map((preset) => {
                        const active = preset.id === stylePresetId;
                        return <Tooltip key={preset.id} title={preset.description}><button type="button" onClick={() => setStylePresetId(preset.id)} className={`group grid min-w-0 grid-cols-[72px_minmax(0,1fr)_24px] items-center gap-2 overflow-hidden rounded-lg border p-1.5 text-left transition-colors ${active ? "border-[var(--workspace-accent)] bg-[var(--workspace-accent-soft)]" : "border-border/80 hover:border-foreground/25"}`}><img src={preset.imageUrl} alt="" loading="lazy" className="h-11 w-[72px] rounded object-cover" /><span className="min-w-0"><span className="block truncate text-xs font-medium">{preset.title}</span><span className="mt-0.5 block truncate text-[10px] text-foreground/42">{preset.description}</span></span><span className={`grid size-5 place-items-center rounded-full ${active ? "bg-[var(--workspace-accent)] text-white" : "border border-border text-transparent"}`}><Check className="size-3" /></span></button></Tooltip>;
                    })}
                </div>
            </section>

            <section className="py-4">
                <div className="flex flex-col gap-3 rounded-lg border border-red-500/20 bg-red-500/[.025] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5"><span className="grid size-7 shrink-0 place-items-center rounded bg-red-500/10 text-red-500"><Archive className="size-3.5" /></span><div className="min-w-0"><h3 className="text-sm font-medium">{project.status === "archived" ? "恢复项目" : "归档项目"}</h3><p className="mt-0.5 text-[11px] text-foreground/48">{project.status === "archived" ? "恢复后可继续创建章节、画布和生成任务" : "保留全部章节、画布和资产，停止项目内新建与生成"}</p></div></div>
                    <Button size="small" danger={project.status !== "archived"} icon={project.status === "archived" ? <Check className="size-3.5" /> : <ShieldAlert className="size-3.5" />} onClick={() => setArchiveOpen(true)}>{project.status === "archived" ? "恢复项目" : "归档项目"}</Button>
                </div>
            </section>

            <Modal title={project.status === "archived" ? "恢复项目" : "归档项目"} open={archiveOpen} okText={project.status === "archived" ? "确认恢复" : "确认归档"} cancelText="取消" okButtonProps={{ danger: project.status !== "archived", loading: archiveMutation.isPending }} onCancel={() => setArchiveOpen(false)} onOk={() => archiveMutation.mutate()} width={440} styles={{ body: { paddingTop: 12 } }}><p className="m-0 text-sm leading-6 text-foreground/65">{project.status === "archived" ? "恢复后项目会重新进入可编辑状态。" : "归档不会删除章节、画布或资产，画布文档仍可在创作画布中打开。"}</p></Modal>
        </div>
    );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
    return <label className={`grid gap-1.5 text-xs ${className}`}><span className="font-medium text-foreground/62">{label}</span>{children}</label>;
}
