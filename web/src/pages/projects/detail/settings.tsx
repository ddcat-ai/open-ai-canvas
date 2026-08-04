import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Input, Modal, Select } from "antd";
import { Archive, Check, Eye, Palette, Save, ShieldAlert } from "lucide-react";

import { CanvasStyleDetailModal, CanvasStylePickerModal, resolveCanvasStylePreset, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
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
    const [styleDetail, setStyleDetail] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [archiveOpen, setArchiveOpen] = useState(false);
    useEffect(() => { setName(project.name); setDescription(project.description || ""); setAspectRatio(project.aspectRatio); setSourceType(project.sourceType); setStylePresetId(project.stylePresetId || ""); }, [project]);
    const dirty = useMemo(() => name.trim() !== project.name || description !== (project.description || "") || aspectRatio !== project.aspectRatio || sourceType !== project.sourceType || stylePresetId !== (project.stylePresetId || ""), [aspectRatio, description, name, project, sourceType, stylePresetId]);
    const selectedStyle = useMemo(() => resolveCanvasStylePreset(stylePresetId), [stylePresetId]);
    const saveMutation = useMutation({ mutationFn: () => updateProject(project.id, { name: name.trim(), description, aspectRatio, sourceType, stylePresetId }), onSuccess: () => { refreshProject(); message.success("项目设置已保存"); }, onError: (error) => message.error(error instanceof Error ? error.message : "项目设置保存失败") });
    const archiveMutation = useMutation({ mutationFn: () => updateProject(project.id, { status: project.status === "archived" ? "active" : "archived" }), onSuccess: () => { setArchiveOpen(false); refreshProject(); message.success(project.status === "archived" ? "项目已恢复" : "项目已归档"); }, onError: (error) => message.error(error instanceof Error ? error.message : "项目状态更新失败") });

    return (
        <div>
            <header className="flex items-end justify-between gap-3 border-b border-border/70 pb-3"><div><h2 className="text-lg font-semibold">项目设置</h2><p className="mt-1 text-xs text-foreground/48">基础信息、项目画风与归档管理</p></div><Button type={dirty ? "primary" : "default"} icon={dirty ? <Save className="size-3.5" /> : <Check className="size-3.5" />} disabled={!dirty || !name.trim()} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{dirty ? "保存设置" : "已保存"}</Button></header>

            <section className="border-b border-border/70 py-4">
                <h3 className="mb-3 text-sm font-semibold">基础设置</h3>
                <div className="grid gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
                    <Field label="项目名称" className="xl:col-span-2"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
                    <Field label="默认画幅"><Select className="w-full" value={aspectRatio} options={[{ label: "9:16 · 竖屏短剧", value: "9:16" }, { label: "16:9 · 横屏", value: "16:9" }, { label: "1:1 · 方形", value: "1:1" }]} onChange={setAspectRatio} /></Field>
                    <Field label="内容来源"><Select className="w-full" value={sourceType} options={[{ label: "空白开始", value: "blank" }, { label: "导入小说", value: "novel" }, { label: "粘贴文本", value: "text" }]} onChange={setSourceType} /></Field>
                    <Field label="项目简介" className="md:col-span-2 xl:col-span-4"><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="一句话说明项目目标" /></Field>
                </div>
            </section>

            <section className="border-b border-border/70 py-4">
                <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">项目画风</h3><p className="mt-0.5 text-[var(--fs-label)] text-foreground/45">选择后会同步到项目画布中的画风节点</p></div>{stylePresetId ? <span className="text-[var(--fs-label)] text-[var(--workspace-accent)]">已选择</span> : <span className="text-[var(--fs-label)] text-foreground/40">未设置</span>}</div>
                <div className="flex flex-col gap-3 border-y border-border/70 py-3 sm:flex-row sm:items-center">
                    {selectedStyle ? <img src={selectedStyle.imageUrl} width="160" height="90" alt={`${selectedStyle.title}画风示意`} className="aspect-video w-40 shrink-0 rounded-md object-cover" /> : <span className="grid aspect-video w-40 shrink-0 place-items-center rounded-md bg-foreground/[.04] text-foreground/35"><Palette className="size-5" /></span>}
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{selectedStyle?.title || "尚未设置项目画风"}</div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground/48">{selectedStyle?.description || "选择题材世界、叙事气质、视觉媒介和角色造型。"}</p>
                        {selectedStyle ? <div className="mt-2 flex flex-wrap gap-1">{selectedStyle.tags.map((tag) => <span key={tag} className="rounded bg-foreground/[.06] px-1.5 py-0.5 text-[var(--fs-tiny)] text-foreground/55">{tag}</span>)}</div> : null}
                    </div>
                    <div className="flex shrink-0 gap-2"><Button icon={<Eye className="size-3.5" />} disabled={!selectedStyle} onClick={() => setStyleDetail(selectedStyle || null)}>查看规范</Button><Button icon={<Palette className="size-3.5" />} onClick={() => setStylePickerOpen(true)}>{selectedStyle ? "更换画风" : "选择画风"}</Button></div>
                </div>
            </section>

            <section className="py-4">
                <div className="flex flex-col gap-3 rounded-lg border border-red-500/20 bg-red-500/[.025] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5"><span className="grid size-7 shrink-0 place-items-center rounded bg-red-500/10 text-red-500"><Archive className="size-3.5" /></span><div className="min-w-0"><h3 className="text-sm font-medium">{project.status === "archived" ? "恢复项目" : "归档项目"}</h3><p className="mt-0.5 text-[var(--fs-label)] text-foreground/48">{project.status === "archived" ? "恢复后可继续创建章节、画布和生成任务" : "保留全部章节、画布和资产，停止项目内新建与生成"}</p></div></div>
                    <Button size="small" danger={project.status !== "archived"} icon={project.status === "archived" ? <Check className="size-3.5" /> : <ShieldAlert className="size-3.5" />} onClick={() => setArchiveOpen(true)}>{project.status === "archived" ? "恢复项目" : "归档项目"}</Button>
                </div>
            </section>

            <Modal title={project.status === "archived" ? "恢复项目" : "归档项目"} open={archiveOpen} okText={project.status === "archived" ? "确认恢复" : "确认归档"} cancelText="取消" okButtonProps={{ danger: project.status !== "archived", loading: archiveMutation.isPending }} onCancel={() => setArchiveOpen(false)} onOk={() => archiveMutation.mutate()} width={440} styles={{ body: { paddingTop: 12 } }}><p className="m-0 text-sm leading-6 text-foreground/65">{project.status === "archived" ? "恢复后项目会重新进入可编辑状态。" : "归档不会删除章节、画布或资产，画布文档仍可在创作画布中打开。"}</p></Modal>
            <CanvasStylePickerModal open={stylePickerOpen} value={stylePresetId} onClose={() => setStylePickerOpen(false)} onSelect={(preset) => { setStylePresetId(preset.id); setStylePickerOpen(false); }} />
            <CanvasStyleDetailModal open={Boolean(styleDetail)} preset={styleDetail} selected={styleDetail?.id === stylePresetId} onClose={() => setStyleDetail(null)} onSelect={(preset) => { setStylePresetId(preset.id); setStyleDetail(null); }} />
        </div>
    );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
    return <label className={`grid gap-1.5 text-xs ${className}`}><span className="font-medium text-foreground/62">{label}</span>{children}</label>;
}
