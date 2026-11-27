import { App, Button, Dropdown, Input } from "antd";
import { Check, CirclePlus, History, ScanFace, Shirt, Smile, PersonStanding, Gem, Scissors, Sparkles, Expand, X } from "lucide-react";
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
import "./character-dressing-panel.css";

const CATEGORY_ICONS = { clothing: Shirt, expression: Smile, pose: PersonStanding, accessory: Gem, hairstyle: Scissors, facial_features: ScanFace };

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
            const saved = await saveCharacterDressing(task, image.resourceId, name);
            onSaved(saved.detail, saved.outfitId);
            message.success("已保存到「形象」中的造型列表");
            void historyQuery.refetch();
        } catch (error) {
            setError(error instanceof Error ? error.message : "保存失败，生成结果已保留");
            onRefresh();
        } finally {
            setSaving(false);
        }
    };
    return (
        <div className="character-dressing" data-canvas-no-zoom data-canvas-wheel-scroll>
            <section className="character-dressing__studio" aria-label="人物搭配">
                <div className="character-dressing__heading">
                    <div>
                        <h3>为角色搭配新造型</h3>
                        <p>选择参考素材，保留人物身份与未调整的特征。</p>
                    </div>
                    <span className="character-dressing__count">{Object.values(references).filter(Boolean).length} / 6 素材</span>
                </div>
                <div className="character-dressing__orbit">
                    <div className="character-dressing__portrait">
                        {outfit ? (
                            <CachedResourceImage eager storageKey={resourceStorageKey(outfit.resourceId)} alt={outfit.name} className="h-full w-full object-contain" />
                        ) : (
                            <div className="character-dressing__empty" role="status">
                                <ScanFace size={32} />
                                <span>
                                    请先在「形象」中
                                    <br />
                                    添加基础人物图
                                </span>
                            </div>
                        )}
                    </div>
                    <div className="character-dressing__base">
                        <span>基础造型</span>
                        <strong>{outfit?.name || "尚未添加"}</strong>
                    </div>
                    {DRESSING_CATEGORIES.map((category) => {
                        const reference = references[category];
                        const Icon = CATEGORY_ICONS[category];
                        const referencePicker = (
                            <button
                                type="button"
                                className={`character-dressing__slot ${reference ? "is-filled" : ""}`}
                                onClick={category === "pose" ? undefined : () => setPickerCategory(category)}
                                aria-label={`选择${ASSET_CATEGORY_LABELS[category]}`}
                                title={reference?.title || `选择${ASSET_CATEGORY_LABELS[category]}`}
                            >
                                {reference ? (
                                    <CachedResourceImage variant="thumbnail" storageKey={resourceStorageKey(reference.resourceId)} alt={reference.title} className="h-full w-full rounded-full object-cover" />
                                ) : (
                                    <>
                                        <Icon size={23} />
                                        <CirclePlus className="character-dressing__add" size={16} />
                                    </>
                                )}
                            </button>
                        );
                        return (
                            <div key={category} className={`character-dressing__reference character-dressing__reference--${category}`}>
                                {category === "pose" ? (
                                    <Dropdown
                                        trigger={["click"]}
                                        menu={{
                                            "aria-label": "选择姿势来源",
                                            items: [
                                                { key: "assets", label: "从素材库选择" },
                                                { key: "poses", label: "从姿势库选择动作与视角" },
                                            ],
                                            onClick: ({ key }) => (key === "poses" ? setPoseOpen(true) : setPickerCategory("pose")),
                                        }}
                                    >
                                        {referencePicker}
                                    </Dropdown>
                                ) : (
                                    referencePicker
                                )}
                                <span className="character-dressing__category">{ASSET_CATEGORY_LABELS[category]}</span>
                                {reference ? (
                                    <>
                                        <span className="character-dressing__reference-title">{reference.title}</span>
                                        <div className="character-dressing__reference-actions">
                                            <Button type="text" size="small" aria-label={`预览${ASSET_CATEGORY_LABELS[category]}`} onClick={() => setPreview({ resourceId: reference.resourceId, title: reference.title })}>
                                                <Expand size={12} />
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
                                                <X size={12} />
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <span className="character-dressing__reference-title">点击添加</span>
                                )}
                            </div>
                        );
                    })}
                </div>
                <div className="character-dressing__studio-footer">
                    <span>参考素材均为选填，也可以只描述想法</span>
                    <Button type="link" size="small" href={workspacePath("/assets")} target="_blank" rel="noopener noreferrer">
                        整理素材
                    </Button>
                </div>
            </section>
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
            <div className="character-dressing__controls">
                <section className="character-dressing__composer">
                    <label className="block space-y-2">
                        <span className="text-sm font-medium">附加提示词</span>
                        <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} autoSize={{ minRows: 3, maxRows: 5 }} maxLength={12000} placeholder="例如：换成深蓝色西服，微笑，保留人物身份" />
                    </label>
                    <ModelPicker
                        config={config}
                        value={config.imageModel || config.model}
                        capability="image"
                        fullWidth
                        onChange={(model) => setConfig((current) => ({ ...current, model, imageModel: model, ...defaultImageParamsForModel(current, model) }))}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <CanvasImageSettingsPopover config={config} onConfigChange={(key, value) => setConfig((current) => ({ ...current, [key]: value }))} />
                        <Button
                            type={images.length && !savedOutfit ? "default" : "primary"}
                            icon={<Sparkles size={15} />}
                            loading={working}
                            disabled={!outfit || active || (!prompt.trim() && !Object.values(references).some(Boolean))}
                            onClick={() => void generate()}
                        >
                            生成新造型
                        </Button>
                    </div>
                </section>
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
                    <section className="character-dressing__history">
                        <div className="character-dressing__section-heading">
                            <h3>
                                <History size={15} />
                                历史生成
                            </h3>
                            <span>结果可随时回来保存</span>
                        </div>
                        <div className="character-dressing__history-list">
                            {history.map((item) => {
                                const thumbnail = dressingImages(item)[0];
                                return (
                                    <button
                                        type="button"
                                        key={item.id}
                                        className="character-dressing__history-item"
                                        aria-pressed={task?.id === item.id}
                                        onClick={() => {
                                            setSubmitted(item);
                                            setSelectedResource("");
                                            setName("");
                                            setError("");
                                        }}
                                    >
                                        {thumbnail ? <CachedResourceImage variant="thumbnail" storageKey={resourceStorageKey(thumbnail.resourceId)} alt="历史造型" className="size-12 rounded-md object-cover" /> : <Sparkles size={20} />}
                                        <span>
                                            <strong>{statusLabel[item.status] || item.status}</strong>
                                            <time>{new Date(item.createdAt).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
                                        </span>
                                    </button>
                                );
                            })}
                            {historyQuery.hasNextPage ? (
                                <Button loading={historyQuery.isFetchingNextPage} onClick={() => void historyQuery.fetchNextPage()}>
                                    加载更早记录
                                </Button>
                            ) : null}
                        </div>
                    </section>
                ) : null}
                {task ? (
                    <section className="character-dressing__result" aria-live="polite">
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
                                          ? savedOutfit
                                              ? "已保存到角色造型"
                                              : "新造型已就绪"
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
                                <div className="character-dressing__results">
                                    {images.map((item) => (
                                        <button type="button" key={item.resourceId} aria-pressed={image?.resourceId === item.resourceId} onClick={() => setSelectedResource(item.resourceId)} className="character-dressing__result-image">
                                            <CachedResourceImage storageKey={resourceStorageKey(item.resourceId)} alt="生成形象" className="h-full w-full object-contain" />
                                            {image?.resourceId === item.resourceId ? (
                                                <span className="character-dressing__selected">
                                                    <Check size={13} />
                                                    已选
                                                </span>
                                            ) : null}
                                        </button>
                                    ))}
                                </div>
                                <Button size="small" type="text" icon={<Expand size={13} />} onClick={() => image && setPreview({ resourceId: image.resourceId, title: savedOutfit?.name || "生成形象" })}>
                                    放大查看所选结果
                                </Button>
                                <form
                                    className="character-dressing__save"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        if (name.trim() && !savedOutfit) void save();
                                    }}
                                >
                                    <label htmlFor={`dressing-name-${nodeId}`}>造型名称</label>
                                    <div>
                                        <Input
                                            id={`dressing-name-${nodeId}`}
                                            aria-label="新形象名称"
                                            value={savedOutfit?.name || name}
                                            disabled={Boolean(savedOutfit) || saving}
                                            maxLength={32}
                                            onChange={(event) => setName(event.target.value)}
                                            placeholder="给新造型起个名字"
                                        />
                                        <Button type={savedOutfit ? "default" : "primary"} htmlType="submit" loading={saving} icon={savedOutfit ? <Check size={14} /> : undefined} disabled={Boolean(savedOutfit) || !name.trim()}>
                                            {savedOutfit ? "已保存" : "保存造型"}
                                        </Button>
                                    </div>
                                    <p>{savedOutfit ? "可在「形象」中查看和切换，刷新后仍保留。" : "保存后将加入角色的「形象」列表。"}</p>
                                </form>
                            </>
                        ) : null}
                    </section>
                ) : null}
            </div>
        </div>
    );
}
