import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Empty, Form, Input, InputNumber, Segmented, Select, Tag } from "antd";
import { Box, ChevronDown, ChevronLeft, ChevronRight, Download, Film, Image as ImageIcon, Layers3, List, Play, Plus, RefreshCcw, Save, SlidersHorizontal, UsersRound, WandSparkles } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { runBackendGenerationTask } from "@/services/api/generation-task";
import {
    linkShotAsset,
    createUnitWorkflow,
    registerProjectTaskOutput,
    saveProjectShot,
    type ProjectAsset,
    type ProjectDetail,
    type ProjectShot,
    type ShotArtifact,
    type ShotRevisionInput,
    type WorkflowStep,
} from "@/services/api/projects";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { modelDisplayName, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

import {
    ArtifactStatus,
    artifactTypeForStage,
    assetCategoryLabel,
    currentArtifact,
    currentRevision,
    formatDuration,
    type ShortDramaWorkflowStage,
} from "./workflow-shared";

type ShotEditorValues = Omit<ShotRevisionInput, "durationMs"> & {
    title: string;
    durationSeconds: number;
};

type Props = {
    activeStage: ShortDramaWorkflowStage;
    detail: ProjectDetail;
    projectId: string;
    unitId: string;
    workflowStep?: WorkflowStep;
    selectedShot?: ProjectShot;
    onSelectShot: (id: string) => void;
    onRefresh: () => Promise<void>;
    onAddShot: () => void;
    addingShot: boolean;
};

const productionStageCopy: Record<"storyboard" | "previz" | "video", { label: string; action: string; empty: string }> = {
    storyboard: { label: "分镜图", action: "生成分镜图", empty: "生成静态分镜图，确认构图、景别与角色位置" },
    previz: { label: "动作预演", action: "生成黑白预演", empty: "生成黑白动作预演，确认表演节拍与镜头运动" },
    video: { label: "镜头视频", action: "生成镜头视频", empty: "选择视频模型后生成当前镜头" },
};

export default function WorkflowProductionWorkbench(props: Props) {
    const { activeStage, detail, projectId, unitId, workflowStep, selectedShot, onSelectShot, onRefresh, onAddShot, addingShot } = props;
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [form] = Form.useForm<ShotEditorValues>();
    const watchedDuration = Form.useWatch("durationSeconds", form);
    const watchedTitle = Form.useWatch("title", form);
    const [leftTab, setLeftTab] = useState<"assets" | "episodes" | "shots">("assets");
    const [previewTab, setPreviewTab] = useState<"latest" | "history">("latest");
    const [previewArtifactId, setPreviewArtifactId] = useState("");
    const [editorDirty, setEditorDirty] = useState(false);
    const shots = useMemo(() => (detail.shots || []).filter((item) => item.unitId === unitId).slice().sort((left, right) => left.position - right.position), [detail.shots, unitId]);
    const shotIndex = selectedShot ? shots.findIndex((item) => item.id === selectedShot.id) : -1;
    const revision = currentRevision(detail, selectedShot);
    const artifactType = artifactTypeForStage(activeStage);
    const artifacts = useMemo(() => selectedShot ? (detail.shotArtifacts || []).filter((item) => item.shotId === selectedShot.id && item.type === artifactType).slice().sort((left, right) => right.version - left.version) : [], [artifactType, detail.shotArtifacts, selectedShot]);
    const newestArtifact = artifacts.find((item) => item.selected) || artifacts[0];
    const previewArtifact = artifacts.find((item) => item.id === previewArtifactId) || newestArtifact;
    const modelOptions = (activeStage === "video" ? effectiveConfig.videoModels : effectiveConfig.imageModels) || [];
    const defaultModel = activeStage === "video" ? effectiveConfig.videoModel : effectiveConfig.imageModel;
    const [selectedModel, setSelectedModel] = useState(defaultModel || modelOptions[0] || "");
    const [aspectRatio, setAspectRatio] = useState(detail.project.aspectRatio || "16:9");
    const [resolution, setResolution] = useState(effectiveConfig.vquality || "720");
    const modelSummary = selectedModel ? modelDisplayName(effectiveConfig, selectedModel) : "未选择模型";
    const durationSummary = `${Number(watchedDuration || Math.max(0.5, (selectedShot?.durationMs || 3000) / 1000))}s`;
    const resolutionSummary = `${resolution.replace(/p$/i, "")}p`;

    useEffect(() => {
        setSelectedModel(defaultModel || modelOptions[0] || "");
    }, [activeStage, defaultModel, modelOptions]);

    useEffect(() => {
        form.setFieldsValue({
            title: selectedShot?.title || "",
            plotDescription: revision?.plotDescription || selectedShot?.description || "",
            action: revision?.action || "",
            dialogue: revision?.dialogue || "",
            shotSize: revision?.shotSize || "",
            cameraAngle: revision?.cameraAngle || "",
            cameraMovement: revision?.cameraMovement || "",
            durationSeconds: Math.max(0.5, (revision?.durationMs || selectedShot?.durationMs || 3000) / 1000),
            imagePrompt: revision?.imagePrompt || "",
            videoPrompt: revision?.videoPrompt || "",
            negativePrompt: revision?.negativePrompt || "",
            continuityNotes: revision?.continuityNotes || "",
        });
        setPreviewArtifactId("");
        setEditorDirty(!revision);
    }, [form, revision?.id, selectedShot?.id]);

    const saveShot = useMutation({
        mutationFn: async (values: ShotEditorValues) => {
            if (!selectedShot) throw new Error("请先选择镜头");
            return saveProjectShot(projectId, {
                id: selectedShot.id,
                unitId,
                title: values.title,
                description: values.plotDescription,
                position: selectedShot.position,
                durationMs: Math.round(values.durationSeconds * 1000),
                status: selectedShot.status,
                revision: revisionInput(values),
            });
        },
        onSuccess: async () => { setEditorDirty(false); await onRefresh(); message.success("镜头脚本已保存为新版本"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "镜头保存失败"),
    });

    const bindAsset = useMutation({
        mutationFn: async (asset: ProjectAsset) => {
            if (!selectedShot || !asset.primaryVersionId) throw new Error("该资产还没有可绑定版本");
            return linkShotAsset(projectId, selectedShot.id, { assetVersionId: asset.primaryVersionId, role: "reference" });
        },
        onSuccess: async () => { await onRefresh(); message.success("资产已绑定到当前镜头"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "资产绑定失败"),
    });

    const generateArtifact = useMutation({
        mutationFn: async () => {
            if (!selectedShot) throw new Error("请先选择镜头");
            let productionStep = workflowStep;
            if (!productionStep) {
                const initialized = await createUnitWorkflow(projectId, unitId);
                productionStep = (initialized.workflow.steps || []).find((step) => step.stepKey === activeStage);
            }
            if (!productionStep) throw new Error("当前生成阶段不可用，请刷新页面后重试");
            if (productionStep.status === "failed") throw new Error("当前生成阶段失败，请刷新后重试");
            if (!selectedModel) throw new Error(activeStage === "video" ? "请先配置视频模型" : "请先配置图片模型");
            if (selectedModel.startsWith("local:dreamina-cli")) throw new Error("本机即梦任务暂不能登记到分镜产物，请选择后端模型渠道");
            const values = await form.validateFields();
            const saved = await saveProjectShot(projectId, {
                id: selectedShot.id,
                unitId,
                title: values.title,
                description: values.plotDescription,
                position: selectedShot.position,
                durationMs: Math.round(values.durationSeconds * 1000),
                status: selectedShot.status,
                revision: revisionInput(values),
            });
            const mode = activeStage === "video" ? "video" as const : "image" as const;
            const config = {
                ...effectiveConfig,
                model: selectedModel,
                imageModel: mode === "image" ? selectedModel : effectiveConfig.imageModel,
                videoModel: mode === "video" ? selectedModel : effectiveConfig.videoModel,
                size: aspectRatio,
                vquality: resolution,
                videoSeconds: String(Math.max(1, Math.round(values.durationSeconds))),
            };
            if (!isAiConfigReady(config, selectedModel)) throw new Error("当前模型渠道配置不完整，请先到设置中补齐");
            const prompt = mode === "video"
                ? [values.videoPrompt || values.plotDescription, values.action, values.continuityNotes].filter(Boolean).join("\n")
                : [values.imagePrompt || values.plotDescription, values.action, "黑白分镜草图，清晰动作节拍，电影构图"].filter(Boolean).join("\n");
            let taskId = "";
            const result = await runBackendGenerationTask({
                projectId,
                mode,
                prompt,
                config,
                referenceImages: shotReferenceImages(detail, selectedShot.id),
                metadata: {
                    workflowStepId: productionStep.id,
                    domainProjectId: projectId,
                    unitId,
                    shotId: saved.shot.id,
                    artifactType,
                    role: "output",
                    source: "short-drama-workflow",
                },
                onTaskUpdate: (task) => { taskId = task.id; },
            });
            const storageKey = mode === "video" ? result.video?.storageKey : result.images?.[0]?.storageKey;
            const resourceId = resourceIdFromStorageKey(storageKey);
            if (!taskId || !resourceId) throw new Error("生成已结束，但产物没有可登记的资源标识");
            await registerProjectTaskOutput(projectId, productionStep.id, {
                taskId,
                unitId,
                shotId: saved.shot.id,
                artifactType,
                resourceId,
                mediaType: mode,
                role: "output",
                metadataJson: JSON.stringify({ model: selectedModel, aspectRatio, resolution, durationSeconds: values.durationSeconds }),
            });
        },
        onSuccess: async () => { setEditorDirty(false); await onRefresh(); message.success(`${productionStageCopy[activeStage as "storyboard" | "previz" | "video"].label}已生成`); },
        onError: (error) => message.error(error instanceof Error ? error.message : "生成失败"),
    });

    const referencedVersionIds = new Set(selectedShot ? (detail.shotReferences || []).filter((item) => item.shotId === selectedShot.id).map((item) => item.assetVersionId) : []);
    const stageCopy = productionStageCopy[activeStage as "storyboard" | "previz" | "video"];

    if (!selectedShot) {
        return <div className="workflow-empty-shot"><Empty description="当前章节还没有分镜"><Button type="primary" icon={<Plus className="size-4" />} loading={addingShot} onClick={onAddShot}>新增第一个分镜</Button></Empty></div>;
    }

    const requestShotSelection = (nextShotId: string) => {
        if (nextShotId === selectedShot.id) return;
        if (!editorDirty) {
            onSelectShot(nextShotId);
            return;
        }
        modal.confirm({
            title: "当前镜头有未保存修改",
            content: "切换镜头会放弃这些修改。",
            okText: "放弃修改并切换",
            cancelText: "继续编辑",
            onOk: () => onSelectShot(nextShotId),
        });
    };

    const requestAddShot = () => {
        if (!editorDirty) {
            onAddShot();
            return;
        }
        modal.confirm({
            title: "当前镜头有未保存修改",
            content: "新增镜头会离开当前编辑内容。",
            okText: "放弃修改并新增",
            cancelText: "继续编辑",
            onOk: onAddShot,
        });
    };

    const selectRelativeShot = (offset: number) => {
        const next = shots[shotIndex + offset];
        if (next) requestShotSelection(next.id);
    };

    return (
        <div className="workflow-production-shell">
            <div className="workflow-production-main">
                <aside className="workflow-library-panel">
                    <Segmented
                        block
                        size="small"
                        value={leftTab}
                        onChange={(value) => setLeftTab(value as typeof leftTab)}
                        options={[{ value: "assets", label: "资产" }, { value: "episodes", label: "章节" }, { value: "shots", label: "镜头" }]}
                    />
                    <div className="workflow-library-scroll thin-scrollbar">
                        {leftTab === "assets" ? <AssetLibrary detail={detail} referencedVersionIds={referencedVersionIds} binding={bindAsset.isPending} onBind={(asset) => bindAsset.mutate(asset)} /> : null}
                        {leftTab === "episodes" ? <EpisodeLibrary detail={detail} activeUnitId={unitId} projectId={projectId} activeStage={activeStage} /> : null}
                        {leftTab === "shots" ? <ShotLibrary detail={detail} shots={shots} selectedShotId={selectedShot.id} onSelectShot={requestShotSelection} /> : null}
                    </div>
                </aside>

                <section className="workflow-shot-editor">
                    <header className="workflow-panel-header">
                        <div className="workflow-shot-heading">
                            <span className="workflow-shot-number">SC.{String(shotIndex + 1).padStart(2, "0")}</span>
                            <h2>{watchedTitle || selectedShot.title || "未命名镜头"}</h2>
                            <Tag className="!m-0" color={saveShot.isPending ? "blue" : editorDirty ? "orange" : revision ? "green" : undefined}>{saveShot.isPending ? "保存中" : editorDirty ? "有未保存修改" : revision ? "已保存" : "草稿"}</Tag>
                        </div>
                        <div className="flex items-center gap-1"><span className="mr-1 text-[var(--fs-micro)] text-foreground/45">{shotIndex + 1} / {shots.length}</span><Button type="text" size="small" icon={<ChevronLeft className="size-4" />} disabled={shotIndex <= 0} onClick={() => selectRelativeShot(-1)} aria-label="上一个镜头" /><Button type="text" size="small" icon={<ChevronRight className="size-4" />} disabled={shotIndex >= shots.length - 1} onClick={() => selectRelativeShot(1)} aria-label="下一个镜头" /></div>
                    </header>
                    <Form form={form} layout="vertical" className="workflow-shot-form" onValuesChange={() => setEditorDirty(true)} onFinish={(values) => saveShot.mutate(values)}>
                        <div className="workflow-shot-form-scroll thin-scrollbar">
                            <div className="workflow-form-section-heading"><span>镜头脚本</span><small>先写清镜头里发生什么，再调整生成参数</small></div>
                            <Form.Item name="title" label="镜头名称" rules={[{ required: true, message: "请输入镜头名称" }]}><Input placeholder="用一句话概括这个镜头" /></Form.Item>
                            <Form.Item name="plotDescription" label="镜头画面" rules={[{ required: true, message: "请输入镜头画面" }]}><Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} placeholder="描述主体、场景、动作、构图、光线，以及观众在这一镜看到的信息" /></Form.Item>
                            <BoundAssets detail={detail} shotId={selectedShot.id} />
                            <div className="workflow-form-grid">
                                <Form.Item name="action" label="表演与动作"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="按动作节拍描述人物表演、走位和物体运动" /></Form.Item>
                                <Form.Item name="dialogue" label="对白 / 旁白"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="填写对白、旁白或需要保留的声音信息" /></Form.Item>
                            </div>
                            <WorkflowDisclosure
                                icon={<SlidersHorizontal />}
                                title="生成设置"
                                description="生成规格与镜头语言"
                                summary={<><span>{durationSummary}</span><span>{aspectRatio}</span><span>{resolutionSummary}</span><span className="is-model">{modelSummary}</span></>}
                            >
                                <div className="workflow-settings-section">
                                    <div className="workflow-settings-section-title">生成规格</div>
                                    <Form.Item label="生成模型"><Select showSearch value={selectedModel || undefined} placeholder={activeStage === "video" ? "选择视频模型" : "选择图片模型"} onChange={setSelectedModel} options={modelOptions.map((value) => ({ value, label: modelDisplayName(effectiveConfig, value) }))} /></Form.Item>
                                    <div className="workflow-form-grid is-three">
                                        <Form.Item name="durationSeconds" label="镜头时长（秒）"><InputNumber className="w-full" min={0.5} max={60} step={0.5} /></Form.Item>
                                        <Form.Item label="画幅"><Select value={aspectRatio} onChange={setAspectRatio} options={[detail.project.aspectRatio, "16:9", "9:16", "1:1"].filter((value, index, array) => value && array.indexOf(value) === index).map((value) => ({ value, label: value }))} /></Form.Item>
                                        <Form.Item label="分辨率"><Select value={resolution} onChange={setResolution} options={[{ value: "480", label: "480p" }, { value: "720", label: "720p" }, { value: "1080", label: "1080p" }]} /></Form.Item>
                                    </div>
                                </div>
                                <div className="workflow-settings-section">
                                    <div className="workflow-settings-section-title">镜头语言</div>
                                    <div className="workflow-form-grid is-three">
                                        <Form.Item name="shotSize" label="景别"><Select allowClear placeholder="自动" options={["特写", "近景", "中景", "全景", "远景"].map((value) => ({ value, label: value }))} /></Form.Item>
                                        <Form.Item name="cameraAngle" label="机位角度"><Select allowClear placeholder="自动" options={["平视", "俯拍", "仰拍", "侧面", "过肩"].map((value) => ({ value, label: value }))} /></Form.Item>
                                        <Form.Item name="cameraMovement" label="运镜方式"><Select allowClear placeholder="自动" options={["固定", "推镜", "拉镜", "摇镜", "移镜", "跟拍"].map((value) => ({ value, label: value }))} /></Form.Item>
                                    </div>
                                </div>
                            </WorkflowDisclosure>
                            <WorkflowDisclosure
                                className="is-advanced"
                                icon={<WandSparkles />}
                                title="生成补充"
                                description="仅在模型需要额外约束时填写"
                                summary={<span>提示词 · 排除内容 · 接戏</span>}
                            >
                                <div className="workflow-form-grid">
                                    <Form.Item name="imagePrompt" label="画面提示词"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="留空时根据镜头画面自动生成" /></Form.Item>
                                    <Form.Item name="videoPrompt" label="动态提示词"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="补充动作节奏、运镜变化和动态细节" /></Form.Item>
                                    <Form.Item name="negativePrompt" label="排除内容"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="填写不希望出现的元素、动作或画面问题" /></Form.Item>
                                    <Form.Item name="continuityNotes" label="接戏备注"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="记录人物位置、朝向、服装、道具及前后镜延续关系" /></Form.Item>
                                </div>
                            </WorkflowDisclosure>
                        </div>
                        <footer className="workflow-editor-actions">
                            <div className="flex items-center gap-2"><Button htmlType="submit" icon={<Save className="size-4" />} loading={saveShot.isPending} disabled={!editorDirty}>保存脚本</Button><Button type="primary" icon={<Play className="size-4" />} loading={generateArtifact.isPending} onClick={() => generateArtifact.mutate()}>{stageCopy.action}</Button></div>
                        </footer>
                    </Form>
                </section>

                <aside className="workflow-preview-panel">
                    <header className="workflow-preview-header">
                        <div className="workflow-preview-header-row">
                            <div className="workflow-preview-title"><Film className="size-4 shrink-0" /><span>产物预览</span></div>
                            <Segmented size="small" value={previewTab} onChange={(value) => setPreviewTab(value as typeof previewTab)} options={[{ value: "latest", label: "最新" }, { value: "history", label: `历史 ${artifacts.length}` }]} />
                        </div>
                        <Segmented
                            block
                            size="small"
                            className="workflow-preview-stage-switch"
                            value={activeStage}
                            options={[{ value: "storyboard", label: "分镜图" }, { value: "previz", label: "动作预演" }, { value: "video", label: "镜头视频" }]}
                            onChange={(nextStage) => navigate(`/projects/${projectId}/workflow/${unitId}/${nextStage}`)}
                        />
                    </header>
                    <div className="workflow-preview-scroll thin-scrollbar">
                        {previewTab === "latest" ? <LatestPreview artifact={previewArtifact} emptyText={stageCopy.empty} /> : <ArtifactHistory artifacts={artifacts} activeId={previewArtifact?.id} onSelect={(artifact) => { setPreviewArtifactId(artifact.id); setPreviewTab("latest"); }} />}
                        <div className="workflow-preview-summary"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">当前产物</span><ArtifactStatus artifact={newestArtifact} compact /></div><div className="mt-1 text-[var(--fs-micro)] text-foreground/45">{newestArtifact ? `${formatDuration(selectedShot.durationMs)} · ${resolution}p · v${newestArtifact.version}` : "当前镜头还没有生成产物"}</div></div>
                        <div className="workflow-preview-actions"><Button icon={<RefreshCcw className="size-3.5" />} loading={generateArtifact.isPending} onClick={() => generateArtifact.mutate()}>重新生成</Button><Button icon={<Download className="size-3.5" />} disabled={!previewArtifact?.resourceId} onClick={() => previewArtifact?.resourceId && void downloadArtifact(previewArtifact, selectedShot.title, message.error)}>下载{activeStage === "video" ? "视频" : "图片"}</Button></div>
                        <ArtifactHistory artifacts={artifacts.slice(0, 4)} activeId={previewArtifact?.id} onSelect={(artifact) => setPreviewArtifactId(artifact.id)} compact />
                    </div>
                </aside>
            </div>

            <ShotTimeline detail={detail} shots={shots} selectedShotId={selectedShot.id} onSelectShot={requestShotSelection} onAddShot={requestAddShot} addingShot={addingShot} />
        </div>
    );
}

function WorkflowDisclosure({ icon, title, description, summary, className = "", children }: { icon: ReactNode; title: string; description: string; summary: ReactNode; className?: string; children: ReactNode }) {
    return (
        <details className={`workflow-disclosure ${className}`}>
            <summary>
                <span className="workflow-disclosure-heading"><span className="workflow-disclosure-icon">{icon}</span><span><strong>{title}</strong><small>{description}</small></span></span>
                <span className="workflow-disclosure-summary">{summary}<ChevronDown className="workflow-disclosure-chevron" /></span>
            </summary>
            <div className="workflow-disclosure-body"><div className="workflow-disclosure-content">{children}</div></div>
        </details>
    );
}

function AssetLibrary({ detail, referencedVersionIds, binding, onBind }: { detail: ProjectDetail; referencedVersionIds: Set<string>; binding: boolean; onBind: (asset: ProjectAsset) => void }) {
    const groups = useMemo(() => {
        const map = new Map<string, ProjectAsset[]>();
        detail.assets.forEach((asset) => map.set(asset.category || "other", [...(map.get(asset.category || "other") || []), asset]));
        return Array.from(map.entries());
    }, [detail.assets]);
    if (!groups.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="项目还没有资产" />;
    return <div className="workflow-asset-groups">{groups.map(([category, assets]) => <section key={category}><h3>{assetCategoryLabel(category)} <span>({assets.length})</span></h3><div className="workflow-asset-list">{assets.map((asset) => { const active = Boolean(asset.primaryVersionId && referencedVersionIds.has(asset.primaryVersionId)); const previewUrl = assetPreviewUrl(asset); return <button key={asset.id} type="button" className={`workflow-asset-row ${active ? "is-active" : ""}`} disabled={binding || !asset.primaryVersionId || active} onClick={() => onBind(asset)}><span className="workflow-asset-thumb">{previewUrl ? <img src={previewUrl} alt="" loading="lazy" /> : asset.category === "character" ? <UsersRound /> : asset.mediaType === "image" ? <ImageIcon /> : <Box />}</span><span className="min-w-0 flex-1"><strong>{asset.title}</strong><small>{active ? "已绑定当前镜头" : `${assetCategoryLabel(asset.category)} · v${Math.max(1, asset.versionCount)}`}</small></span>{active ? <span className="workflow-bound-dot" /> : null}</button>; })}</div></section>)}</div>;
}

function EpisodeLibrary({ detail, activeUnitId, projectId, activeStage }: { detail: ProjectDetail; activeUnitId: string; projectId: string; activeStage: ShortDramaWorkflowStage }) {
    return <div className="workflow-simple-list">{detail.units.slice().sort((left, right) => left.position - right.position).map((unit, index) => <Link key={unit.id} to={`/projects/${projectId}/workflow/${unit.id}/${activeStage}`} className={unit.id === activeUnitId ? "is-active" : ""}><span>{String(index + 1).padStart(2, "0")}</span><strong>{unit.title}</strong></Link>)}</div>;
}

function ShotLibrary({ detail, shots, selectedShotId, onSelectShot }: { detail: ProjectDetail; shots: ProjectShot[]; selectedShotId: string; onSelectShot: (id: string) => void }) {
    return <div className="workflow-simple-list">{shots.map((shot, index) => { const video = currentArtifact(detail, shot.id, "video"); return <button key={shot.id} type="button" className={shot.id === selectedShotId ? "is-active" : ""} onClick={() => onSelectShot(shot.id)}><span>{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 flex-1"><strong>{shot.title}</strong><small>{formatDuration(shot.durationMs)}</small></span><ArtifactStatus artifact={video} compact /></button>; })}</div>;
}

function BoundAssets({ detail, shotId }: { detail: ProjectDetail; shotId: string }) {
    const references = (detail.shotReferences || []).filter((item) => item.shotId === shotId);
    const assetByVersionId = useMemo(() => new Map(detail.assets.filter((asset) => asset.primaryVersionId).map((asset) => [asset.primaryVersionId as string, asset])), [detail.assets]);
    return (
        <div className="workflow-bound-assets">
            <div className="workflow-bound-assets-heading"><span className="workflow-field-label">镜头资产</span><small>{references.length ? `已绑定 ${references.length} 项` : "从左侧资产栏点击绑定"}</small></div>
            <div className="workflow-bound-assets-content">
                {references.length ? references.map((reference) => {
                    const asset = assetByVersionId.get(reference.assetVersionId);
                    return <span key={reference.id} className="workflow-bound-asset-chip"><em>{asset ? assetCategoryLabel(asset.category) : "历史"}</em><span>{asset?.title || "历史资产版本"}</span></span>;
                }) : <span>尚未绑定角色、场景或道具</span>}
            </div>
        </div>
    );
}

function LatestPreview({ artifact, emptyText }: { artifact?: ShotArtifact; emptyText: string }) {
    if (!artifact?.resourceId) return <div className="workflow-media-empty"><span><Play className="size-7" /></span><p>{emptyText}</p></div>;
    const src = resourceFileUrl(artifact.resourceId);
    if (artifact.type === "video") return <video className="workflow-preview-media" src={src} controls preload="metadata" />;
    return <img className={`workflow-preview-media ${artifact.type === "action_board" ? "grayscale" : ""}`} src={src} alt="镜头生成预览" loading="eager" />;
}

function ArtifactHistory({ artifacts, activeId, onSelect, compact = false }: { artifacts: ShotArtifact[]; activeId?: string; onSelect: (artifact: ShotArtifact) => void; compact?: boolean }) {
    if (!artifacts.length) return compact ? null : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史版本" />;
    return <section className={`workflow-history ${compact ? "is-compact" : ""}`}><div className="workflow-history-title">历史版本</div>{artifacts.map((artifact) => <button key={artifact.id} type="button" className={artifact.id === activeId ? "is-active" : ""} onClick={() => onSelect(artifact)}>{artifact.resourceId ? artifact.type === "video" ? <video src={resourceFileUrl(artifact.resourceId)} muted preload="metadata" /> : <img src={resourceFileUrl(artifact.resourceId)} alt="" loading="lazy" /> : <span className="workflow-history-placeholder"><Layers3 /></span>}<span className="min-w-0 flex-1"><strong>v{artifact.version}{artifact.selected ? " · 当前" : ""}</strong><small>{new Date(artifact.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span><ArtifactStatus artifact={artifact} compact /></button>)}</section>;
}

function ShotTimeline({ detail, shots, selectedShotId, onSelectShot, onAddShot, addingShot }: { detail: ProjectDetail; shots: ProjectShot[]; selectedShotId: string; onSelectShot: (id: string) => void; onAddShot: () => void; addingShot: boolean }) {
    return <section className="workflow-shot-timeline"><header><div><strong>{detail.units.find((item) => item.id === shots[0]?.unitId)?.title || "本集"}</strong><span>{shots.length} 镜 · 总时长 {formatDuration(shots.reduce((total, item) => total + item.durationMs, 0))}</span></div><div className="flex items-center gap-1 text-[var(--fs-micro)] text-foreground/40"><List className="size-3.5" /> 共 {shots.length} 镜</div></header><div className="workflow-shot-track thin-scrollbar">{shots.map((shot, index) => <TimelineShot key={shot.id} detail={detail} shot={shot} index={index} selected={shot.id === selectedShotId} onSelect={() => onSelectShot(shot.id)} />)}<button type="button" className="workflow-add-shot-card" disabled={addingShot} onClick={onAddShot}><Plus className="size-5" /><span>新增分镜</span></button></div></section>;
}

function TimelineShot({ detail, shot, index, selected, onSelect }: { detail: ProjectDetail; shot: ProjectShot; index: number; selected: boolean; onSelect: () => void }) {
    const video = currentArtifact(detail, shot.id, "video");
    const previz = currentArtifact(detail, shot.id, "action_board");
    const preview = video?.resourceId ? video : previz?.resourceId ? previz : undefined;
    const stateArtifact = video || previz;
    return <button type="button" className={`workflow-timeline-shot ${selected ? "is-active" : ""}`} onClick={onSelect}><span className="workflow-timeline-media">{preview?.resourceId ? preview.type === "video" ? <video src={resourceFileUrl(preview.resourceId)} muted preload="metadata" /> : <img src={resourceFileUrl(preview.resourceId)} alt="" loading="lazy" /> : <Film />}</span><span className="workflow-timeline-copy"><span><strong>SC.{String(index + 1).padStart(2, "0")}</strong><small>{formatDuration(shot.durationMs)}</small></span><em>{shot.title}</em><ArtifactStatus artifact={stateArtifact} compact /></span></button>;
}

function revisionInput(values: ShotEditorValues): ShotRevisionInput {
    return {
        plotDescription: values.plotDescription,
        action: values.action,
        dialogue: values.dialogue,
        shotSize: values.shotSize,
        cameraAngle: values.cameraAngle,
        cameraMovement: values.cameraMovement,
        durationMs: Math.round(values.durationSeconds * 1000),
        imagePrompt: values.imagePrompt,
        videoPrompt: values.videoPrompt,
        negativePrompt: values.negativePrompt,
        continuityNotes: values.continuityNotes,
    };
}

function shotReferenceImages(detail: ProjectDetail, shotId: string): ReferenceImage[] {
    const versionIds = new Set((detail.shotReferences || []).filter((item) => item.shotId === shotId).map((item) => item.assetVersionId));
    return detail.assets.filter((asset) => asset.primaryVersionId && versionIds.has(asset.primaryVersionId) && asset.mediaType === "image" && asset.storageKey).map((asset) => {
        const resourceId = resourceIdFromStorageKey(asset.storageKey);
        return { id: asset.id, name: asset.title, type: "image/*", dataUrl: "", ...(resourceId ? { url: resourceFileUrl(resourceId) } : {}), storageKey: asset.storageKey };
    });
}

async function downloadArtifact(artifact: ShotArtifact, shotTitle: string, onError: (content: string) => void) {
    if (!artifact.resourceId) return;
    try {
        const response = await fetch(resourceFileUrl(artifact.resourceId), { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${shotTitle || "shot"}-v${artifact.version}.${artifact.type === "video" ? "mp4" : "png"}`;
        anchor.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        onError(error instanceof Error ? `下载失败：${error.message}` : "下载失败");
    }
}

function assetPreviewUrl(asset: ProjectAsset) {
    const representation = asset.character?.representations?.find((item) => item.role === "primary") || asset.character?.representations?.[0];
    if (representation?.resourceId) return resourceFileUrl(representation.resourceId);
    const resourceId = resourceIdFromStorageKey(asset.storageKey);
    return resourceId && asset.mediaType === "image" ? resourceFileUrl(resourceId) : "";
}
