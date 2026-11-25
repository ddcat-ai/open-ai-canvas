import { App, Button, Input } from "antd";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { ModelPicker } from "@/components/model-picker";
import { CanvasImageSettingsPopover } from "@/components/canvas/canvas-image-settings-popover";
import { WorkspaceErrorState } from "@/components/layout/workspace-state";
import { createClientUUID } from "@/lib/client-id";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import { dressingImages, saveCharacterDressing, submitCharacterDressing } from "@/services/character-dressing";
import { cancelGenerationTask, queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { resourceStorageKey } from "@/services/api/resources";
import type { ProjectCharacterDetail } from "@/services/api/projects";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CharacterOutfit } from "./character-outfits";

export function CharacterDressingPanel({
    detail,
    outfit,
    nodeId,
    onSaved,
    onRefresh,
}: {
    detail: ProjectCharacterDetail;
    outfit?: CharacterOutfit;
    nodeId: string;
    onSaved: (detail: ProjectCharacterDetail, outfitId: string) => void;
    onRefresh: () => void;
}) {
    const { message } = App.useApp();
    const userId = useUserStore((state) => state.user?.id);
    const globalConfig = useConfigStore((state) => state.config);
    const [config, setConfig] = useState(() => ({ ...globalConfig, model: globalConfig.imageModel || globalConfig.model, count: "1" }));
    const [prompt, setPrompt] = useState("");
    const [submitted, setSubmitted] = useState<GenerationTask | null>(null);
    const [working, setWorking] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [name, setName] = useState("");
    const [selectedResource, setSelectedResource] = useState("");
    const operation = useRef<{ key: string; id: string } | null>(null);
    const taskQuery = useQuery({
        queryKey: ["character-dressing-task", userId, submitted?.id],
        queryFn: () => queryGenerationTask(submitted!.id),
        enabled: Boolean(submitted),
        refetchInterval: (query) => {
            const task = query.state.data || submitted;
            return task && (task.status === "queued" || task.status === "running" || (task.status === "succeeded" && task.resultState && task.resultState !== "READY" && task.resultState !== "FAILED_PERMANENT")) ? 2000 : false;
        },
    });
    const task = taskQuery.data || submitted;
    const active = task?.status === "queued" || task?.status === "running";
    const images = task ? dressingImages(task) : [];
    const image = images.find((item) => item.resourceId === selectedResource) || images[0];
    const generate = async () => {
        if (!outfit || working || active) return;
        setWorking(true);
        setError("");
        try {
            const key = JSON.stringify({ prompt, config, outfit, version: detail.character.versionId });
            if (operation.current?.key !== key) operation.current = { key, id: createClientUUID() };
            const created = await submitCharacterDressing({ detail, outfit, nodeId, prompt, config, operationId: operation.current.id });
            setSubmitted(created);
            setSelectedResource("");
            setName("");
            operation.current = null;
        } catch (error) {
            setError(error instanceof Error ? error.message : "提交失败");
        } finally {
            setWorking(false);
        }
    };
    const save = async () => {
        if (!task || !image || saving) return;
        setSaving(true);
        setError("");
        try {
            const saved = await saveCharacterDressing(task, image.resourceId, name, detail.character.versionId);
            onSaved(saved.detail, saved.outfitId);
            message.success("已保存为角色形象");
        } catch (error) {
            setError(error instanceof Error ? error.message : "保存失败，生成结果已保留");
            onRefresh();
        } finally {
            setSaving(false);
        }
    };
    return (
        <div className="space-y-5" data-canvas-no-zoom data-canvas-wheel-scroll>
            <p className="text-sm text-foreground/60">以当前形象为基础，描述需要修改的内容。生成后预览并命名保存，其他节点保留原形象。</p>
            {!outfit ? (
                <p role="status" className="text-sm text-foreground/60">
                    请先到「形象」中上传或绑定基础人物图。
                </p>
            ) : (
                <div className="flex items-center gap-3">
                    <CachedResourceImage storageKey={resourceStorageKey(outfit.resourceId)} alt={outfit.name} className="h-20 w-16 rounded-lg object-contain" />
                    <span className="text-sm">基础形象：{outfit.name}</span>
                </div>
            )}
            <label className="block space-y-2">
                <span className="text-sm font-medium">附加提示词</span>
                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} maxLength={12000} placeholder="例如：换成深蓝色西服，微笑，保留人物身份" />
            </label>
            <ModelPicker config={config} value={config.imageModel || config.model} capability="image" fullWidth onChange={(model) => setConfig((current) => ({ ...current, model, imageModel: model, ...defaultImageParamsForModel(current, model) }))} />
            <div className="flex flex-wrap items-center justify-between gap-3">
                <CanvasImageSettingsPopover config={config} onConfigChange={(key, value) => setConfig((current) => ({ ...current, [key]: value }))} />
                <Button type="primary" loading={working} disabled={!outfit || active || !prompt.trim()} onClick={() => void generate()}>
                    生成新形象
                </Button>
            </div>
            {error || taskQuery.error ? <WorkspaceErrorState compact title="操作未完成" description={error || String(taskQuery.error)} /> : null}
            {task ? (
                <section className="space-y-3 rounded-lg border border-border p-4" aria-live="polite">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm">
                            {active ? `正在生成 ${task.progress || 0}%` : task.status === "failed" ? task.error || "生成失败" : task.status === "cancelled" ? "任务已取消" : images.length ? "生成完成，请选择图片并命名保存" : "结果处理中，请稍候"}
                        </span>
                        {active ? (
                            <Button
                                size="small"
                                onClick={() =>
                                    void cancelGenerationTask(task.id)
                                        .then(() => taskQuery.refetch())
                                        .catch((error) => setError(String(error)))
                                }
                            >
                                取消任务
                            </Button>
                        ) : null}
                    </div>
                    {images.length ? (
                        <>
                            <div className="grid grid-cols-2 gap-2">
                                {images.map((item) => (
                                    <button
                                        type="button"
                                        key={item.resourceId}
                                        aria-pressed={image?.resourceId === item.resourceId}
                                        onClick={() => setSelectedResource(item.resourceId)}
                                        className={`rounded-lg border p-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent)] ${image?.resourceId === item.resourceId ? "border-[var(--workspace-accent)]" : "border-border"}`}
                                    >
                                        <CachedResourceImage storageKey={resourceStorageKey(item.resourceId)} alt="生成形象" className="max-h-72 w-full object-contain" />
                                    </button>
                                ))}
                            </div>
                            <Input aria-label="新形象名称" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="为新形象命名" />
                            <Button loading={saving} disabled={!name.trim()} onClick={() => void save()}>
                                保存为角色形象
                            </Button>
                        </>
                    ) : null}
                </section>
            ) : null}
        </div>
    );
}
