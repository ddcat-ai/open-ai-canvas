import { App, Button, Input } from "antd";
import { useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { ModelPicker } from "@/components/model-picker";
import { CanvasImageSettingsPopover } from "@/components/canvas/canvas-image-settings-popover";
import { WorkspaceErrorState } from "@/components/layout/workspace-state";
import { createClientUUID } from "@/lib/client-id";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import {
    DRESSING_CATEGORIES,
    dressingAssetReference,
    dressingImages,
    listCharacterDressingTasks,
    saveCharacterDressing,
    submitCharacterDressing,
    uploadDressingAsset,
    type DressingCategory,
    type DressingAssetReference,
} from "@/services/character-dressing";
import { getActiveUserScope } from "@/lib/user-scope";
import { taskBillingLabel } from "@/lib/generation-task-billing";
import { workspacePath } from "@/lib/workspace-routes";
import { canCancelGenerationTask, statusLabel } from "@/lib/generation-task-display";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { AssetLibraryPickerModal, remoteAssetToPickerItem } from "@/components/assets/asset-library-picker-modal";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { cancelGenerationTask, queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { resourceStorageKey } from "@/services/api/resources";
import type { ProjectCharacterDetail } from "@/services/api/projects";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { parseCharacterOutfits, type CharacterOutfit } from "./character-outfits";
import { CanvasPoseLibraryModal } from "./canvas-pose-library-modal";
import { CanvasImagePreview } from "./canvas-image-preview";

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
    const scope = getActiveUserScope();
    const historyQuery = useInfiniteQuery({
        queryKey: ["character-dressing-history", scope, detail.asset.id],
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam, signal }) => listCharacterDressingTasks(detail.asset.id, pageParam, signal),
        getNextPageParam: (page) => (page.length === 40 ? page.at(-1)?.id : undefined),
    });
    const history = historyQuery.data?.pages.flat() || [];
    const selectedTask = submitted || history[0];
    const [references, setReferences] = useState<Partial<Record<DressingCategory, DressingAssetReference>>>({});
    const [pickerCategory, setPickerCategory] = useState<DressingCategory | null>(null);
    const [poseOpen, setPoseOpen] = useState(false);
    const [preview, setPreview] = useState<{ resourceId: string; title: string } | null>(null);
    const assets = useAssetStore((state) => state.assets);
    const [uploadedAssets, setUploadedAssets] = useState<Asset[]>([]);
    const pickerItems = [...assets, ...uploadedAssets.filter((item) => !assets.some((asset) => asset.id === item.id))]
        .filter((asset) => asset.kind === "image" && asset.status !== "archived")
        .map((asset) => remoteAssetToPickerItem(asset, undefined, true));
    const taskQuery = useQuery({
        queryKey: ["character-dressing-task", scope, userId, selectedTask?.id],
        queryFn: ({ signal }) => queryGenerationTask(selectedTask!.id, { signal }),
        enabled: Boolean(selectedTask),
        refetchInterval: (query) => {
            const task = query.state.data || selectedTask;
            return task && (task.status === "queued" || task.status === "running" || (task.status === "succeeded" && task.resultState && ["NOT_AVAILABLE", "PENDING_MATERIALIZATION", "MATERIALIZING"].includes(task.resultState))) ? 2000 : false;
        },
    });
    const task = taskQuery.data || selectedTask;
    const active = task?.status === "queued" || task?.status === "running";
    const images = task ? dressingImages(task) : [];
    const image = images.find((item) => item.resourceId === selectedResource) || images[0];
    const savedOutfit = task && image ? parseCharacterOutfits(detail.character.definition, detail.character.representations).find((item) => item.resourceId === image.resourceId && item.source?.taskId === task.id) : undefined;
    const generate = async () => {
        if (!outfit || working || active) return;
        setWorking(true);
        setError("");
        try {
            const key = JSON.stringify({ prompt, config, outfit, references, version: detail.character.versionId });
            if (operation.current?.key !== key) operation.current = { key, id: createClientUUID() };
            const created = await submitCharacterDressing({ detail, outfit, nodeId, prompt, config, operationId: operation.current.id, references: Object.values(references).filter((item): item is DressingAssetReference => Boolean(item)) });
            setSubmitted(created);
            void historyQuery.refetch();
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
            void historyQuery.refetch();
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
            <div className="grid grid-cols-2 gap-2">
                {DRESSING_CATEGORIES.map((category) => {
                    const reference = references[category];
                    return (
                        <div key={category} className="space-y-2 rounded-lg border border-border p-3">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium">{ASSET_CATEGORY_LABELS[category]}</span>
                                {reference ? (
                                    <span className="flex items-center gap-1">
                                        <Button type="text" size="small" aria-label={`预览${ASSET_CATEGORY_LABELS[category]}`} onClick={() => setPreview({ resourceId: reference.resourceId, title: reference.title })}>
                                            预览
                                        </Button>
                                        <Button
                                            type="text"
                                            size="small"
                                            aria-label={`清除${ASSET_CATEGORY_LABELS[category]}`}
                                            onClick={() =>
                                                setReferences((current) => {
                                                    const next = { ...current };
                                                    delete next[category];
                                                    return next;
                                                })
                                            }
                                        >
                                            清除
                                        </Button>
                                    </span>
                                ) : null}
                            </div>
                            <button
                                type="button"
                                className="flex min-h-16 w-full items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent)]"
                                onClick={() => setPickerCategory(category)}
                                aria-label={`选择${ASSET_CATEGORY_LABELS[category]}`}
                            >
                                {reference ? (
                                    <>
                                        <CachedResourceImage storageKey={resourceStorageKey(reference.resourceId)} alt={reference.title} className="size-14 rounded object-contain" />
                                        <span className="min-w-0 truncate text-xs">
                                            {reference.title}
                                            <span className="block text-foreground/50">{reference.poseItemId ? "姿势库" : reference.officialAssetId ? "官方素材" : "我的素材"}</span>
                                        </span>
                                    </>
                                ) : (
                                    <span className="text-xs text-foreground/50">选择参考图片（选填）</span>
                                )}
                            </button>
                        </div>
                    );
                })}
            </div>
            <Button onClick={() => setPoseOpen(true)}>从姿势库选择动作与视角</Button>
            {preview ? <CanvasImagePreview storageKey={resourceStorageKey(preview.resourceId)} alt={preview.title} onClose={() => setPreview(null)} /> : null}
            <CanvasPoseLibraryModal
                open={poseOpen}
                onClose={() => setPoseOpen(false)}
                onPick={async (copy) => {
                    setReferences((current) => ({ ...current, pose: { category: "pose", resourceId: copy.resource.id, title: `${copy.name} · ${copy.angle}`, poseItemId: copy.itemId, angle: copy.angle } }));
                }}
            />
            {pickerCategory ? (
                <AssetLibraryPickerModal
                    key={pickerCategory}
                    open
                    items={pickerItems}
                    remoteLibrary
                    officialSelectionMode="import-to-library"
                    remoteKind="image"
                    acceptRemoteItems
                    mediaKinds={["image"]}
                    categoryLabels={ASSET_CATEGORY_LABELS}
                    initialCategory={pickerCategory}
                    fixedCategory={pickerCategory}
                    multiple={false}
                    title={`选择${ASSET_CATEGORY_LABELS[pickerCategory]}参考`}
                    emptyTitle="还没有此类参考图"
                    emptyDescription="可以上传图片，或到素材库编辑业务分类后重新选择。"
                    footerNote="可在素材库的新增、编辑或批量上传中设置业务分类。"
                    onClose={() => setPickerCategory(null)}
                    upload={{
                        accept: "image/*",
                        description: "上传后归入当前业务分类",
                        onUpload: async (files) => {
                            const asset = await uploadDressingAsset(files[0], pickerCategory);
                            setUploadedAssets((current) => [...current, asset]);
                            return [asset.id];
                        },
                    }}
                    onConfirm={async (ids, picked) => {
                        const item = picked?.find((entry) => entry.id === ids[0]) || pickerItems.find((entry) => entry.id === ids[0]);
                        const asset = item?.asset;
                        if (!asset) throw new Error("素材尚未就绪，请重新选择");
                        const reference = { ...dressingAssetReference(asset, pickerCategory), ...(item?.originOfficialAssetId ? { officialAssetId: item.originOfficialAssetId } : {}) };
                        setReferences((current) => ({ ...current, [pickerCategory]: reference }));
                        setPickerCategory(null);
                    }}
                />
            ) : null}
            <label className="block space-y-2">
                <span className="text-sm font-medium">附加提示词</span>
                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} maxLength={12000} placeholder="例如：换成深蓝色西服，微笑，保留人物身份" />
            </label>
            <ModelPicker config={config} value={config.imageModel || config.model} capability="image" fullWidth onChange={(model) => setConfig((current) => ({ ...current, model, imageModel: model, ...defaultImageParamsForModel(current, model) }))} />
            <div className="flex flex-wrap items-center justify-between gap-3">
                <CanvasImageSettingsPopover config={config} onConfigChange={(key, value) => setConfig((current) => ({ ...current, [key]: value }))} />
                <Button type="primary" loading={working} disabled={!outfit || active || (!prompt.trim() && !Object.values(references).some(Boolean))} onClick={() => void generate()}>
                    生成新形象
                </Button>
            </div>
            {error || taskQuery.error || historyQuery.error ? (
                <WorkspaceErrorState
                    compact
                    title="操作未完成"
                    description={error || String(taskQuery.error || historyQuery.error)}
                    onRetry={() => {
                        void taskQuery.refetch();
                        void historyQuery.refetch();
                    }}
                />
            ) : null}
            {history.length ? (
                <details className="rounded-lg border border-border p-3">
                    <summary className="cursor-pointer text-sm">历史生成（关闭或刷新后可继续保存）</summary>
                    <div className="mt-2 space-y-1">
                        {history.map((item) => (
                            <Button
                                key={item.id}
                                type="text"
                                block
                                aria-pressed={task?.id === item.id}
                                onClick={() => {
                                    setSubmitted(item);
                                    setSelectedResource("");
                                    setName("");
                                    setError("");
                                }}
                            >
                                {new Date(item.createdAt).toLocaleString()} · {statusLabel[item.status] || item.status}
                            </Button>
                        ))}
                        {historyQuery.hasNextPage ? (
                            <Button loading={historyQuery.isFetchingNextPage} onClick={() => void historyQuery.fetchNextPage()}>
                                加载更早记录
                            </Button>
                        ) : null}
                    </div>
                </details>
            ) : null}
            {task ? (
                <section className="space-y-3 rounded-lg border border-border p-4" aria-live="polite">
                    {task.billing ? <p className="text-xs text-foreground/60">{taskBillingLabel(task.billing)}</p> : null}
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm">
                            {active
                                ? `正在生成 ${task.progress || 0}%`
                                : task.status === "failed"
                                  ? task.error || "生成失败"
                                  : task.status === "cancelled"
                                    ? "任务已取消"
                                    : images.length
                                      ? "生成完成，请选择图片并命名保存"
                                      : task.resultState?.startsWith("FAILED")
                                        ? "结果保存失败，可前往任务中心查看并恢复"
                                        : "结果处理中，请稍候"}
                        </span>
                        {canCancelGenerationTask(task) ? (
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
                    {task.canRecoverMedia || task.resultState?.startsWith("FAILED") ? <Button href={workspacePath("/tasks")}>前往任务中心恢复结果</Button> : null}
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
                            <Button type="text" onClick={() => image && setPreview({ resourceId: image.resourceId, title: savedOutfit?.name || "生成形象" })}>
                                放大查看所选结果
                            </Button>
                            <Input aria-label="新形象名称" value={savedOutfit?.name || name} disabled={Boolean(savedOutfit)} maxLength={32} onChange={(event) => setName(event.target.value)} placeholder="为新形象命名" />
                            <Button loading={saving} disabled={Boolean(savedOutfit) || !name.trim()} onClick={() => void save()}>
                                {savedOutfit ? "已保存到形象库" : "保存为角色形象"}
                            </Button>
                        </>
                    ) : null}
                </section>
            ) : null}
        </div>
    );
}
