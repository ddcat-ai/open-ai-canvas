import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Input, Modal, Select } from "antd";
import { Archive, Check, Eye, Palette, Pencil, Save, ShieldAlert } from "lucide-react";

import { CanvasStyleDetailModal, CanvasStylePickerModal, resolveProjectCanvasStyle, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { createStyleProfileSnapshot, parseStyleProfile, resolveStyleExecutionPlan, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { updateProject } from "@/services/api/projects";
import { resolveModelRequestConfig, useEffectiveConfig } from "@/stores/use-config-store";

import type { ProjectDetailViewProps } from "./shared";

export default function ProjectSettingsView({ detail, refreshProject }: ProjectDetailViewProps) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const { project } = detail;
    const [name, setName] = useState(project.name);
    const [description, setDescription] = useState(project.description || "");
    const [aspectRatio, setAspectRatio] = useState(project.aspectRatio);
    const [sourceType, setSourceType] = useState(project.sourceType);
    const [stylePresetId, setStylePresetId] = useState(project.stylePresetId || "");
    const [styleProfileJson, setStyleProfileJson] = useState(project.styleProfileJson || "");
    const [styleDetail, setStyleDetail] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [styleEditorRequested, setStyleEditorRequested] = useState(false);
    const [archiveOpen, setArchiveOpen] = useState(false);
    useEffect(() => { setName(project.name); setDescription(project.description || ""); setAspectRatio(project.aspectRatio); setSourceType(project.sourceType); setStylePresetId(project.stylePresetId || ""); setStyleProfileJson(project.styleProfileJson || ""); }, [project]);
    const dirty = useMemo(() => name.trim() !== project.name || description !== (project.description || "") || aspectRatio !== project.aspectRatio || sourceType !== project.sourceType || stylePresetId !== (project.stylePresetId || "") || styleProfileJson !== (project.styleProfileJson || ""), [aspectRatio, description, name, project, sourceType, stylePresetId, styleProfileJson]);
    const selectedStyle = useMemo(() => resolveProjectCanvasStyle(stylePresetId, styleProfileJson), [stylePresetId, styleProfileJson]);
    const styleProfile = useMemo(() => parseStyleProfile(styleProfileJson) || selectedStyle?.profile || (selectedStyle ? createStyleProfileSnapshot(selectedStyle) : null), [selectedStyle, styleProfileJson]);
    const enabledStyleAssets = styleProfile?.assets.filter((asset) => asset.enabled !== false) || [];
    const styleExecutionPlans = useMemo(() => {
        if (!styleProfile) return null;
        const imageConfig = resolveModelRequestConfig(effectiveConfig, effectiveConfig.imageModel || effectiveConfig.model);
        const videoConfig = resolveModelRequestConfig(effectiveConfig, effectiveConfig.videoModel || effectiveConfig.model);
        return {
            image: resolveStyleExecutionPlan(styleProfile, { mode: "image", model: imageConfig.model, interfaceType: imageConfig.interfaceType || imageConfig.apiFormat }),
            video: resolveStyleExecutionPlan(styleProfile, { mode: "video", model: videoConfig.model, interfaceType: videoConfig.interfaceType || videoConfig.apiFormat }),
        };
    }, [effectiveConfig, styleProfile]);
    const saveMutation = useMutation({ mutationFn: () => updateProject(project.id, { name: name.trim(), description, aspectRatio, sourceType, stylePresetId, styleProfileJson }), onSuccess: () => { refreshProject(); message.success("项目设置已保存"); }, onError: (error) => message.error(error instanceof Error ? error.message : "项目设置保存失败") });
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
                <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">项目画风</h3><p className="mt-0.5 text-[var(--fs-label)] text-foreground/45">项目保存当前版本快照；修改“我的风格”不会自动改写历史项目</p></div>{styleProfile ? <span className="text-[var(--fs-label)] text-[var(--workspace-accent)]">{styleProfile.source === "user" ? "来自我的风格" : styleProfile.source === "external" ? "外部导入" : "系统预设"}</span> : <span className="text-[var(--fs-label)] text-foreground/40">未设置</span>}</div>
                <div className="flex flex-col gap-3 border-y border-border/70 py-3 lg:flex-row lg:items-center">
                    {selectedStyle ? <img src={selectedStyle.imageUrl} width="160" height="90" alt={`${selectedStyle.title}画风示意`} className="aspect-video w-40 shrink-0 rounded-md object-cover" /> : <span className="grid aspect-video w-40 shrink-0 place-items-center rounded-md bg-foreground/5 text-foreground/35"><Palette className="size-5" /></span>}
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{styleProfile?.title || selectedStyle?.title || "尚未设置项目画风"}</div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground/48">{styleProfile?.description || selectedStyle?.description || "从系统风格开始，或创建可自由编辑的项目视觉规范。"}</p>
                        {styleProfile ? <div className="mt-2 flex flex-wrap gap-1">{styleProfile.tags.map((tag) => <span key={tag} className="rounded bg-foreground/10 px-1.5 py-0.5 text-[var(--fs-tiny)] text-foreground/55">{tag}</span>)}</div> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2"><Button icon={<Eye className="size-3.5" />} disabled={!selectedStyle} onClick={() => setStyleDetail(selectedStyle || null)}>查看规范</Button><Button type={styleProfile ? "primary" : "default"} icon={<Pencil className="size-3.5" />} disabled={!styleProfile} onClick={() => { setStyleEditorRequested(true); setStylePickerOpen(true); }}>编辑画风</Button><Button icon={<Palette className="size-3.5" />} onClick={() => { setStyleEditorRequested(false); setStylePickerOpen(true); }}>{selectedStyle ? "更换画风" : "选择画风"}</Button></div>
                </div>
                {styleProfile ? <div className="grid grid-cols-2 border-b border-border text-xs sm:grid-cols-5"><StyleMetric label="执行策略" value={styleProfile.executionPolicy === "strict-assets" ? "严格校验" : "兼容降级"} /><StyleMetric label="绑定资产" value={`${styleProfile.assets.length} 个`} /><StyleMetric label="已启用" value={`${enabledStyleAssets.length} 个`} /><StyleMetric label="图片执行" value={styleExecutionStatusLabel(styleExecutionPlans?.image.status)} /><StyleMetric label="视频执行" value={styleExecutionStatusLabel(styleExecutionPlans?.video.status)} /></div> : null}
                {styleExecutionPlans && (styleExecutionPlans.image.warnings.length || styleExecutionPlans.video.warnings.length) ? <div className="grid gap-1 border-b border-border px-3 py-2 text-[var(--fs-label)] leading-5 text-amber-600 dark:text-amber-400">{styleExecutionPlans.image.warnings.length ? <p>图片：{styleExecutionPlans.image.warnings.join("；")}</p> : null}{styleExecutionPlans.video.warnings.length ? <p>视频：{styleExecutionPlans.video.warnings.join("；")}</p> : null}</div> : null}
            </section>

            <section className="py-4">
                <div className="flex flex-col gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5"><span className="grid size-7 shrink-0 place-items-center rounded bg-red-500/10 text-red-500"><Archive className="size-3.5" /></span><div className="min-w-0"><h3 className="text-sm font-medium">{project.status === "archived" ? "恢复项目" : "归档项目"}</h3><p className="mt-0.5 text-[var(--fs-label)] text-foreground/48">{project.status === "archived" ? "恢复后可继续创建章节、画布和生成任务" : "保留全部章节、画布和资产，停止项目内新建与生成"}</p></div></div>
                    <Button size="small" danger={project.status !== "archived"} icon={project.status === "archived" ? <Check className="size-3.5" /> : <ShieldAlert className="size-3.5" />} onClick={() => setArchiveOpen(true)}>{project.status === "archived" ? "恢复项目" : "归档项目"}</Button>
                </div>
            </section>

            <Modal title={project.status === "archived" ? "恢复项目" : "归档项目"} open={archiveOpen} okText={project.status === "archived" ? "确认恢复" : "确认归档"} cancelText="取消" okButtonProps={{ danger: project.status !== "archived", loading: archiveMutation.isPending }} onCancel={() => setArchiveOpen(false)} onOk={() => archiveMutation.mutate()} width={440} styles={{ body: { paddingTop: 12 } }}><p className="m-0 text-sm leading-6 text-foreground/65">{project.status === "archived" ? "恢复后项目会重新进入可编辑状态。" : "归档不会删除章节、画布或资产，画布文档仍可在创作画布中打开。"}</p></Modal>
            <CanvasStylePickerModal open={stylePickerOpen} value={stylePresetId} currentProfile={styleProfile} startInEditor={styleEditorRequested} onClose={() => { setStylePickerOpen(false); setStyleEditorRequested(false); }} onSelect={(preset) => { applyStyle(preset); setStylePickerOpen(false); setStyleEditorRequested(false); }} />
            <CanvasStyleDetailModal open={Boolean(styleDetail)} preset={styleDetail} selected={styleDetail?.id === stylePresetId} onClose={() => setStyleDetail(null)} onSelect={(preset) => { applyStyle(preset); setStyleDetail(null); }} />
        </div>
    );

    function applyStyle(preset: CanvasStylePreset) {
        setStylePresetId(preset.id);
        setStyleProfileJson(serializeStyleProfile(preset.profile || createStyleProfileSnapshot(preset)));
    }
}

function StyleMetric({ label, value }: { label: string; value: string }) {
    return <div className="min-w-0 border-r border-t border-border px-3 py-2 first:border-l sm:border-t-0"><span className="block text-[var(--fs-tiny)] text-foreground/40">{label}</span><span className="mt-0.5 block truncate font-medium text-foreground/65">{value}</span></div>;
}

function styleExecutionStatusLabel(status?: "ready" | "degraded" | "blocked") {
    return status === "blocked" ? "不可执行" : status === "degraded" ? "降级执行" : "完整执行";
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
    return <label className={`grid gap-1.5 text-xs ${className}`}><span className="font-medium text-foreground/62">{label}</span>{children}</label>;
}
