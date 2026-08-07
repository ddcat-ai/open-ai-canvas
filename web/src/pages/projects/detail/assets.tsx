import { useMemo, useState } from "react";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, Form, Input, Modal, Popconfirm, Select, Tabs, type FormInstance } from "antd";
import { Box, Check, ChevronDown, Download, FileText, Image as ImageIcon, Link2, Music2, Plus, RefreshCw, Sparkles, Trash2, UserRound, Video, VolumeX } from "lucide-react";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { AssetMediaPreview } from "@/components/asset-media-preview";
import { AssetLibraryCard, AssetLibraryCardMedia } from "@/components/assets/asset-library-card";
import { WorkspaceSignalIcon } from "@/components/ui/aceternity/workspace-signal-icon";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import {
    bindProjectCharacterVoice,
    confirmProjectAssetCandidate,
    createProjectAssetVersion,
    createProjectCharacter,
    getProjectCharacter,
    linkProjectAsset,
    listVoiceProfiles,
    replaceProjectCharacterRepresentations,
    unbindProjectCharacterVoice,
    unlinkProjectAsset,
    updateProjectAssetCategory,
    updateProjectCharacter,
    type ProjectAsset,
    type ProjectDetail,
} from "@/services/api/projects";
import { saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useAssetStore, type Asset, type AssetCategory, type AssetStatus, type EntityAsset, type ImageAsset } from "@/stores/use-asset-store";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { saveAs } from "file-saver";

import { ProjectCharacterCard } from "./project-character-card";
import { generateCharacterTurnaround } from "./project-character-media";
import { categoryLabels, categoryLabel, mediaLabel, StatusPill, formatTime, textValue, type ProjectDetailViewProps } from "./shared";

const categories = ["all", "character", "environment", "wardrobe", "prop", "weapon", "style", "other"];
const characterFields = [
    ["role", "剧情定位与人物关系"], ["aliases", "别名"], ["appearance", "稳定外貌"], ["physique", "身高、体型与体态"],
    ["clothing", "默认服装造型"], ["personality", "性格与表演基线"], ["props", "固定道具"],
    ["consistencyPrompt", "跨镜头一致性约束"], ["multiViewPrompt", "三视图补充约束"],
    ["voiceLanguage", "语言与口音"], ["voiceAge", "声音年龄感"], ["voiceTimbre", "音色气质"],
] as const;

type CharacterForm = { name: string } & Record<(typeof characterFields)[number][0], string>;

export default function ProjectAssetsView({ detail, refreshProject }: ProjectDetailViewProps) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const personalAssets = useAssetStore((state) => state.assets);
    const updatePersonalAsset = useAssetStore((state) => state.updateAsset);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [category, setCategory] = useState("all");
    const [addOpen, setAddOpen] = useState(false);
    const [assetId, setAssetId] = useState("");
    const [assetCategory, setAssetCategory] = useState("other");
    const [editorAsset, setEditorAsset] = useState<ProjectAsset | "new" | null>(null);
    const [imageAsset, setImageAsset] = useState<ProjectAsset | null>(null);
    const [voiceAsset, setVoiceAsset] = useState<ProjectAsset | null>(null);
    const [previewAsset, setPreviewAsset] = useState<ProjectAsset | null>(null);
    const [imageSelection, setImageSelection] = useState("");
    const [voiceProfileId, setVoiceProfileId] = useState("");
    const [voiceInstructions, setVoiceInstructions] = useState("");
    const [form] = Form.useForm<CharacterForm>();

    const projectAssetIds = new Set(detail.assets.map((asset) => asset.id));
    const availableAssets = personalAssets.filter((asset) => !projectAssetIds.has(asset.id));
    const selectedPersonalAsset = personalAssets.find((asset) => asset.id === assetId);
    const imageAssets = personalAssets.filter((asset): asset is ImageAsset => asset.kind === "image");
    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.category === "character" && candidate.status === "pending_confirmation");
    const characterAssets = detail.assets.filter((asset) => asset.category === "character" && asset.character);
    const mediaAssetCount = detail.assets.filter((asset) => asset.category !== "character").length;
    const visibleAssets = useMemo(() => category === "all" ? detail.assets : detail.assets.filter((asset) => asset.category === category), [category, detail.assets]);
    const categoryCounts = categories.map((value) => ({
        value,
        count: value === "all"
            ? detail.assets.length + pendingCandidates.length
            : detail.assets.filter((asset) => asset.category === value).length + (value === "character" ? pendingCandidates.length : 0),
    }));
    const voices = useQuery({ queryKey: ["voice-profiles"], queryFn: listVoiceProfiles, enabled: Boolean(voiceAsset) });
    const generatingAssets = useMutationState({
        filters: { mutationKey: ["project-character-turnaround", detail.project.id], status: "pending" },
        select: (mutation) => mutation.state.variables as ProjectAsset | undefined,
    });
    const generatingAssetIds = new Set(generatingAssets.map((asset) => asset?.id).filter((id): id is string => Boolean(id)));

    const done = (content: string) => { refreshProject(); message.success(content); };
    const failed = (fallback: string) => (error: unknown) => message.error(error instanceof Error ? error.message : fallback);
    const addMutation = useMutation({ mutationFn: () => linkProjectAsset(detail.project.id, { assetId, category: assetCategory }), onSuccess: ({ asset }) => { updatePersonalAsset(asset.id, { category: asset.category as AssetCategory, status: asset.status as AssetStatus, primaryVersionId: asset.primaryVersionId }); setAddOpen(false); setAssetId(""); done("资产已加入项目"); }, onError: failed("资产加入失败") });
    const versionMutation = useMutation({ mutationFn: (id: string) => createProjectAssetVersion(detail.project.id, id, {}), onSuccess: () => done("已创建新版本"), onError: failed("版本创建失败") });
    const unlinkMutation = useMutation({ mutationFn: (id: string) => unlinkProjectAsset(detail.project.id, id), onSuccess: () => done("资产已移出项目"), onError: failed("资产移除失败") });
    const categoryMutation = useMutation({ mutationFn: ({ id, next }: { id: string; next: string }) => updateProjectAssetCategory(detail.project.id, id, next), onSuccess: ({ asset }) => { updatePersonalAsset(asset.id, { category: asset.category as AssetCategory }); done("资产分类已更新"); }, onError: failed("资产分类更新失败") });
    const confirmMutation = useMutation({
        mutationFn: ({ candidateId, targetAssetId }: { candidateId: string; targetAssetId?: string }) => confirmProjectAssetCandidate(detail.project.id, candidateId, targetAssetId),
        onSuccess: ({ asset }, variables) => {
            // 候选确认后先精确更新当前项，剩余队列不依赖整页异步刷新才能继续操作。
            queryClient.setQueryData<ProjectDetail>(["project", detail.project.id], (current) => current ? {
                ...current,
                assetCandidates: current.assetCandidates.map((candidate) => candidate.id === variables.candidateId ? { ...candidate, status: "confirmed", resolvedAssetId: asset.id, updatedAt: asset.updatedAt } : candidate),
                assets: current.assets.some((item) => item.id === asset.id) ? current.assets.map((item) => item.id === asset.id ? asset : item) : [asset, ...current.assets],
            } : current);
            syncPersonalCharacterProjection(asset);
            done(variables.targetAssetId ? "候选信息已归并到角色新版本" : "角色卡已创建");
        },
        onError: failed("角色确认失败"),
    });
    const confirmingCandidateId = confirmMutation.isPending ? confirmMutation.variables?.candidateId || "" : "";
    const saveCharacter = useMutation({
        mutationFn: async (values: CharacterForm) => {
            const definition = characterDefinition(values);
            return editorAsset === "new" ? createProjectCharacter(detail.project.id, { name: values.name, definition }) : updateProjectCharacter(detail.project.id, editorAsset!.id, { name: values.name, definition });
        },
        onSuccess: (result) => { syncPersonalCharacterProjection(result.asset); setEditorAsset(null); done(editorAsset === "new" ? "角色卡已创建" : "角色设定已保存并生成新版本"); },
        onError: failed("角色保存失败"),
    });
    const generateMutation = useMutation({
        mutationKey: ["project-character-turnaround", detail.project.id],
        mutationFn: async (asset: ProjectAsset) => {
            if (!asset.character) throw new Error("角色版本信息不完整");
            const model = effectiveConfig.imageModel || effectiveConfig.model;
            const config = { ...effectiveConfig, model };
            if (!isAiConfigReady(config, model)) throw new Error("请先在设置中配置可用的图片模型");
            const projectStyle = resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson);
            await generateCharacterTurnaround({ projectId: detail.project.id, assetId: asset.id, versionId: asset.character.versionId, name: asset.title, definition: asset.character.definition, projectStyle, config });
            return getProjectCharacter(detail.project.id, asset.id);
        },
        onSuccess: (result) => { syncPersonalCharacterProjection(result.asset); done("三视图已生成并绑定到新角色版本"); },
        onError: failed("三视图生成失败"),
    });
    const bindImagesMutation = useMutation({
        mutationFn: async () => {
            if (!imageAsset) throw new Error("未选择角色");
            await saveRemoteUserDataNow();
            const latest = useAssetStore.getState().assets;
            const selected = latest.find((asset) => asset.id === imageSelection);
            if (selected?.kind !== "image") throw new Error("请选择一张包含正面、侧面和背面的三视图设定图");
            const resourceId = resourceIdFromStorageKey((selected as ImageAsset).data.storageKey);
            if (!resourceId) throw new Error("所选图片尚未同步到后端资源库");
            return replaceProjectCharacterRepresentations(detail.project.id, imageAsset.id, [{ role: "turnaround_sheet", resourceId, metadata: { sourceAssetId: selected.id } }, { role: "primary", resourceId, metadata: { source: "turnaround_sheet", sourceAssetId: selected.id } }]);
        },
        onSuccess: (result) => { syncPersonalCharacterProjection(result.asset); setImageAsset(null); done("三视图已绑定到新角色版本"); },
        onError: failed("三视图绑定失败"),
    });
    const bindVoiceMutation = useMutation({ mutationFn: () => voiceAsset ? bindProjectCharacterVoice(detail.project.id, voiceAsset.id, { voiceProfileId, instructions: voiceInstructions }) : Promise.reject(new Error("未选择角色")), onSuccess: (result) => { syncPersonalCharacterProjection(result.asset); setVoiceAsset(null); done("声音素材已绑定到新角色版本"); }, onError: failed("声音绑定失败") });
    const unbindVoiceMutation = useMutation({ mutationFn: () => voiceAsset ? unbindProjectCharacterVoice(detail.project.id, voiceAsset.id) : Promise.reject(new Error("未选择角色")), onSuccess: (result) => { syncPersonalCharacterProjection(result.asset); setVoiceAsset(null); done("声音绑定已解除并生成新角色版本"); }, onError: failed("声音解绑失败") });

    const openCharacterEditor = (asset: ProjectAsset | "new") => {
        setEditorAsset(asset);
        const definition = asset === "new" ? {} : asset.character?.definition || {};
        form.setFieldsValue({ name: asset === "new" ? "" : asset.title, ...Object.fromEntries(characterFields.map(([key]) => [key, fieldValue(definition[key])])) } as CharacterForm);
    };
    const openImages = (asset: ProjectAsset) => { setImageAsset(asset); setImageSelection(""); };
    const openVoice = (asset: ProjectAsset) => { setVoiceAsset(asset); setVoiceProfileId(asset.character?.voice?.profile.id || ""); setVoiceInstructions(asset.character?.voice?.instructions || ""); };
    const downloadPreviewAsset = (asset: ProjectAsset) => {
        const personal = personalAssets.find((item) => item.id === asset.id);
        if (personal && (personal.kind === "image" || personal.kind === "video" || personal.kind === "audio" || personal.kind === "model")) {
            const url = personal.kind === "image" ? personal.data.dataUrl : personal.data.url;
            const extension = personal.kind === "model" ? personal.data.fileName.split(".").pop() || "glb" : personal.data.mimeType.split("/")[1] || "bin";
            saveAs(url, `${asset.title || "asset"}.${extension}`);
            return;
        }
        const cover = asset.character?.representations.find((item) => item.role === "turnaround_sheet") || asset.character?.representations.find((item) => item.role === "primary") || asset.character?.representations[0];
        if (cover) saveAs(resourceFileUrl(cover.resourceId), `${asset.title || "character"}.png`);
        else message.warning("当前资产没有可下载的媒体文件");
    };
    return (
        <div>
            <header className="flex min-h-[72px] flex-col gap-4 border-b border-border/70 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                    <WorkspaceSignalIcon variant="assets" size="sm" />
                    <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                            <h2 className="text-[var(--fs-heading-lg)] font-semibold leading-6">角色与资产</h2>
                            <span className="rounded bg-foreground/[.055] px-1.5 py-1 text-[var(--fs-tiny)] font-medium tabular-nums text-foreground/45">{detail.assets.length} 项已确认</span>
                        </div>
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[var(--fs-label)] text-foreground/48">
                            <span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5" />{characterAssets.length} 个角色</span>
                            <span className="inline-flex items-center gap-1.5"><Box className="size-3.5" />{mediaAssetCount} 项媒体</span>
                            {pendingCandidates.length ? <span className="inline-flex items-center gap-1.5 text-[var(--workspace-accent)]"><Sparkles className="size-3.5" />{pendingCandidates.length} 个待确认</span> : null}
                        </div>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 sm:pl-4">
                    <Button type="text" className="!h-9 !px-3" icon={<Link2 className="size-3.5" />} onClick={() => setAddOpen(true)}>引用素材</Button>
                    <Button type="primary" className="!h-9 !px-3.5" icon={<Plus className="size-3.5" />} onClick={() => openCharacterEditor("new")}>新建角色</Button>
                </div>
            </header>
            <div className="mt-3 grid gap-3 lg:grid-cols-[156px_minmax(0,1fr)]">
                <nav className="space-y-0.5 border-r border-border/70 pr-2" aria-label="资产分类">{categoryCounts.map((item) => <button key={item.value} type="button" onClick={() => setCategory(item.value)} className={`flex h-11 w-full items-center justify-between rounded-md px-2 text-left text-xs ${category === item.value ? "bg-foreground/[.08] font-medium" : "text-foreground/55 hover:bg-foreground/[.04]"}`}><span>{item.value === "all" ? "全部资产" : categoryLabels[item.value]}</span><span className="min-w-5 rounded bg-foreground/[.05] px-1 text-center text-[var(--fs-tiny)] tabular-nums">{item.count}</span></button>)}</nav>
                <div className="min-w-0">
                    {(category === "all" || category === "character") && pendingCandidates.length ? (
                        <section className="mb-4" aria-label="待确认角色">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 text-xs font-medium"><Sparkles className="size-3.5 text-[var(--workspace-accent)]" />剧情识别出的角色</div>
                                <span className="text-[var(--fs-tiny)] tabular-nums text-foreground/42">剩余 {pendingCandidates.length} 个待确认</span>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                {pendingCandidates.map((candidate) => {
                                    const confirming = confirmingCandidateId === candidate.id;
                                    return (
                                        <article key={candidate.id} className="flex min-h-28 items-center gap-3 rounded-lg border border-dashed border-border p-3">
                                            <span className="grid size-12 shrink-0 place-items-center rounded-md bg-foreground/[.045] text-foreground/25"><UserRound className="size-5" /></span>
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-xs font-semibold">{candidate.name}</div>
                                                <div className="mt-1 text-[var(--fs-tiny)] text-foreground/42">待确认角色卡 · 来自章节分析</div>
                                                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1">
                                                    <Button type="text" size="small" icon={<Check className="size-3.5" />} loading={confirming} disabled={Boolean(confirmingCandidateId) && !confirming} onClick={() => confirmMutation.mutate({ candidateId: candidate.id })}>确认新角色</Button>
                                                    {characterAssets.length ? <Dropdown trigger={["click"]} menu={{ items: characterAssets.map((asset) => ({ key: asset.id, label: asset.title })), onClick: ({ key }) => confirmMutation.mutate({ candidateId: candidate.id, targetAssetId: key }) }}><Button type="text" size="small" disabled={Boolean(confirmingCandidateId)}>归并到角色<ChevronDown className="size-3" /></Button></Dropdown> : null}
                                                </div>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </section>
                    ) : null}
                    <div className="mb-2 flex items-center justify-between text-xs text-foreground/45"><span>{category === "all" ? "全部资产" : categoryLabel(category)}</span><span>{visibleAssets.length} 项已确认</span></div>
                    {visibleAssets.length ? <div className="project-assets-grid assets-library-grid">{visibleAssets.map((asset) => asset.category === "character" ? <ProjectCharacterCard key={asset.id} asset={asset} generating={generatingAssetIds.has(asset.id)} removing={unlinkMutation.isPending && unlinkMutation.variables === asset.id} onOpen={() => setPreviewAsset(asset)} onEdit={() => openCharacterEditor(asset)} onGenerate={() => generateMutation.mutate(asset)} onBindImages={() => openImages(asset)} onBindVoice={() => openVoice(asset)} onRemove={() => unlinkMutation.mutate(asset.id)} /> : <MediaAssetCard key={asset.id} asset={asset} personalAsset={personalAssets.find((item) => item.id === asset.id)} onOpen={() => setPreviewAsset(asset)} onCategoryChange={(next) => categoryMutation.mutate({ id: asset.id, next })} onVersion={() => versionMutation.mutate(asset.id)} onRemove={() => unlinkMutation.mutate(asset.id)} loading={(categoryMutation.isPending && categoryMutation.variables?.id === asset.id) || (versionMutation.isPending && versionMutation.variables === asset.id) || (unlinkMutation.isPending && unlinkMutation.variables === asset.id)} />)}</div> : (category === "all" || category === "character") && pendingCandidates.length ? null : <WorkspaceState icon="assets" compact title="这个分类还没有资产" description={category === "character" ? "新建角色，或先从剧情章节提取角色信息。" : "可从个人素材库引用，或切换到其他分类查看。"} />}
                </div>
            </div>

            <Modal title="引用个人素材" open={addOpen} okText="加入项目" cancelText="取消" okButtonProps={{ disabled: !assetId, loading: addMutation.isPending }} onCancel={() => setAddOpen(false)} onOk={() => addMutation.mutate()} width={480}><div className="grid gap-3"><Select showSearch optionFilterProp="label" value={assetId || undefined} placeholder="选择未加入项目的素材" options={availableAssets.map((asset) => ({ label: `${asset.title} · ${mediaLabel(asset.kind)}`, value: asset.id }))} onChange={(value) => { setAssetId(value); const next = personalAssets.find((asset) => asset.id === value); setAssetCategory(next?.kind === "entity" ? "character" : next?.category || "other"); }} /><Select value={assetCategory} disabled={selectedPersonalAsset?.kind === "entity"} options={selectedPersonalAsset?.kind === "entity" ? [{ value: "character", label: "角色" }] : Object.entries(categoryLabels).filter(([value]) => value !== "character").map(([value, label]) => ({ value, label }))} onChange={setAssetCategory} /></div></Modal>
            <ProjectAssetPreviewModal asset={previewAsset} personalAsset={previewAsset ? personalAssets.find((item) => item.id === previewAsset.id) : undefined} onClose={() => setPreviewAsset(null)} onDownload={() => previewAsset && downloadPreviewAsset(previewAsset)} onReplaceImage={() => { if (!previewAsset || previewAsset.category !== "character") return; setPreviewAsset(null); openImages(previewAsset); }} />
            <CharacterEditorModal open={Boolean(editorAsset)} editing={editorAsset !== "new"} form={form} loading={saveCharacter.isPending} onClose={() => setEditorAsset(null)} onSave={() => form.validateFields().then((values) => saveCharacter.mutate(values))} />
            <Modal title={`绑定单张三视图 · ${imageAsset?.title || ""}`} open={Boolean(imageAsset)} okText="绑定并生成新版本" cancelText="取消" width={720} okButtonProps={{ loading: bindImagesMutation.isPending, disabled: !imageSelection }} onCancel={() => setImageAsset(null)} onOk={() => bindImagesMutation.mutate()}>{imageAssets.length ? <div className="grid max-h-[420px] gap-3 overflow-y-auto sm:grid-cols-3">{imageAssets.map((asset) => <button type="button" key={asset.id} onClick={() => setImageSelection(asset.id)} className={`overflow-hidden rounded-lg border text-left transition ${imageSelection === asset.id ? "border-[var(--workspace-accent)] ring-2 ring-[var(--workspace-accent)]/20" : "border-border/70 hover:border-foreground/35"}`}><div className="relative aspect-[4/3] bg-foreground/[.045]"><img src={asset.data.dataUrl} alt={asset.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />{imageSelection === asset.id ? <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-[var(--workspace-accent)] text-white"><Check className="size-4" /></span> : null}</div><div className="truncate px-2 py-2 text-[var(--fs-label)] font-medium">{asset.title}</div></button>)}</div> : <WorkspaceState icon="assets" compact title="个人图片素材为空" description="需要一张包含正面、侧面、背面的角色设定图。" />}</Modal>
            <Modal title={`选择声音素材 · ${voiceAsset?.title || ""}`} open={Boolean(voiceAsset)} okText="绑定并生成新版本" cancelText="取消" okButtonProps={{ loading: bindVoiceMutation.isPending, disabled: !voiceProfileId }} onCancel={() => setVoiceAsset(null)} onOk={() => bindVoiceMutation.mutate()}><div className="grid gap-3"><Select loading={voices.isLoading} showSearch optionFilterProp="label" value={voiceProfileId || undefined} placeholder="选择声音" options={(voices.data?.profiles || []).map((voice) => ({ label: `${voice.name} · ${voice.language}`, value: voice.id }))} onChange={setVoiceProfileId} /><Input.TextArea rows={3} value={voiceInstructions} placeholder="表演指令，例如：克制、温暖、语速稍慢" onChange={(event) => setVoiceInstructions(event.target.value)} />{voiceAsset?.character && voiceAsset.character.voiceStatus !== "missing" ? <div className="flex items-center justify-between border-t border-border/70 pt-2"><span className="text-[var(--fs-label)] text-foreground/45">当前绑定：{voiceAsset.character.voice?.profile.name || "声音素材不可用"}</span><Popconfirm title="解除当前声音绑定？" description="该操作会保留历史版本，并创建一个未绑定声音的新版本。" okText="解除" cancelText="取消" onConfirm={() => unbindVoiceMutation.mutate()}><Button type="text" danger size="small" loading={unbindVoiceMutation.isPending} icon={<VolumeX className="size-3.5" />}>解除声音</Button></Popconfirm></div> : null}</div></Modal>
        </div>
    );
}

function CharacterEditorModal({ open, editing, form, loading, onClose, onSave }: { open: boolean; editing: boolean; form: FormInstance<CharacterForm>; loading: boolean; onClose: () => void; onSave: () => void }) {
    const field = (key: CharacterFormKey) => characterFields.find(([name]) => name === key)!;
    const textArea = (key: CharacterFormKey, rows = 3) => <Form.Item name={key} label={field(key)[1]}><Input.TextArea rows={rows} placeholder={key === "appearance" ? "先描述用户能看到的稳定特征…" : undefined} /></Form.Item>;
    const input = (key: CharacterFormKey) => <Form.Item name={key} label={field(key)[1]}><Input /></Form.Item>;
    return <Modal title={null} open={open} forceRender width={860} okText={editing ? "保存角色设定" : "创建角色卡"} cancelText="取消" okButtonProps={{ loading }} onCancel={onClose} onOk={onSave} styles={{ body: { paddingTop: 0 } }}>
        <div className="mb-1 border-b border-border/70 pb-4"><div className="text-[var(--fs-label)] font-medium text-[var(--workspace-accent)]">角色设定</div><h2 className="mt-1 text-xl font-semibold">{editing ? "调整角色设定" : "建立一张角色卡"}</h2></div>
        <Form form={form} layout="vertical" requiredMark={false} className="pt-2"><Form.Item name="name" label="角色名称" rules={[{ required: true, message: "请输入角色名称" }]}><Input size="large" placeholder="例如：林默" /></Form.Item><Tabs items={[{ key: "identity", label: "身份与外观", forceRender: true, children: <div className="grid gap-x-5 sm:grid-cols-2">{input("role")}{input("aliases")}{textArea("appearance", 4)}{input("physique")}{input("clothing")}{input("props")}{textArea("consistencyPrompt", 4)}{textArea("multiViewPrompt", 3)}</div> }, { key: "performance", label: "表演与声音", forceRender: true, children: <div className="grid gap-x-5 sm:grid-cols-2">{textArea("personality", 4)}{input("voiceLanguage")}{input("voiceAge")}{input("voiceTimbre")}</div> }]} /></Form>
    </Modal>;
}

type CharacterFormKey = (typeof characterFields)[number][0];

function MediaAssetCard({ asset, personalAsset, onOpen, onCategoryChange, onVersion, onRemove, loading }: { asset: ProjectAsset; personalAsset?: Asset; onOpen: () => void; onCategoryChange: (category: string) => void; onVersion: () => void; onRemove: () => void; loading: boolean }) {
    return <AssetLibraryCard className="project-asset-library-card"><AssetLibraryCardMedia className="relative aspect-[4/3] overflow-hidden bg-foreground/[.05]"><button type="button" className="project-asset-media-button" onClick={onOpen} aria-label={`查看资产：${asset.title}`}><AssetMediaPreview asset={personalAsset} alt={asset.title} className="h-full w-full bg-black object-cover" fallback={<div className="grid h-full place-items-center text-foreground/25"><MediaIcon kind={asset.mediaType} /></div>} /><div className="absolute inset-x-2 top-2 flex items-center justify-between"><StatusPill status={asset.status} /><span className="rounded bg-black/50 px-1.5 py-0.5 text-[var(--fs-micro)] text-white">{mediaLabel(asset.mediaType)}</span></div></button></AssetLibraryCardMedia><div className="p-2.5"><button type="button" className="project-asset-title-button" onClick={onOpen}><span className="min-w-0 truncate text-xs font-medium">{asset.title}</span><span className="shrink-0 text-[var(--fs-micro)] text-foreground/38">{formatTime(asset.updatedAt)}</span></button><div className="mt-1 flex items-center gap-1.5 text-[var(--fs-tiny)] text-foreground/42"><Dropdown trigger={["click"]} menu={{ selectedKeys: [asset.category], items: Object.entries(categoryLabels).filter(([value]) => value !== "character").map(([value, label]) => ({ key: value, label })), onClick: ({ key }) => onCategoryChange(key) }}><button type="button" disabled={loading} className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[var(--fs-tiny)] text-foreground/50 hover:bg-foreground/[.055]"><span>{categoryLabel(asset.category)}</span><ChevronDown className="size-3" /></button></Dropdown><span>·</span><span>v{Math.max(1, asset.versionCount)}</span><Link2 className="ml-auto size-3.5 shrink-0 text-[var(--workspace-accent)]" /></div><div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-1.5"><span className="text-[var(--fs-micro)] text-foreground/38">{mediaLabel(asset.mediaType)}</span><div className="flex items-center"><Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={onVersion} /><Popconfirm title="移出项目资产？" okText="移出" cancelText="取消" onConfirm={onRemove}><Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} loading={loading} /></Popconfirm></div></div></div></AssetLibraryCard>;
}

function ProjectAssetPreviewModal({ asset, personalAsset, onClose, onDownload, onReplaceImage }: { asset: ProjectAsset | null; personalAsset?: Asset; onClose: () => void; onDownload: () => void; onReplaceImage: () => void }) {
    const characterCover = asset?.character?.representations.find((item) => item.role === "turnaround_sheet") || asset?.character?.representations.find((item) => item.role === "primary") || asset?.character?.representations[0];
    const canDownload = Boolean(personalAsset && ["image", "video", "audio", "model"].includes(personalAsset.kind)) || Boolean(characterCover);
    const previewClass = asset?.category === "character" ? "is-character" : personalAsset?.kind === "video" ? "is-video" : personalAsset?.kind === "audio" ? "is-audio" : personalAsset?.kind === "text" ? "is-text" : "is-image";
    return (
        <Modal className="library-modal project-asset-preview-modal" title={asset?.category === "character" ? "角色卡预览" : "资产预览"} open={Boolean(asset)} width={840} onCancel={onClose} footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>关闭</Button>{asset?.category === "character" ? <Button onClick={onReplaceImage}>替换图片</Button> : null}{canDownload ? <Button type="primary" icon={<Download className="size-3.5" />} onClick={onDownload}>下载</Button> : null}</div>}>
            {asset ? <div className="project-asset-preview-layout">
                <div className={`project-asset-preview-stage ${previewClass}`}>
                    {asset.category === "character" ? characterCover ? <img src={resourceFileUrl(characterCover.resourceId)} alt={asset.title} className="project-asset-preview-media" /> : <div className="grid min-h-48 place-items-center text-foreground/35"><UserRound className="size-12" /></div> : personalAsset?.kind === "video" ? <video src={personalAsset.data.url} controls className="project-asset-preview-media" /> : personalAsset?.kind === "audio" ? <audio src={personalAsset.data.url} controls className="project-asset-preview-audio" /> : personalAsset?.kind === "image" ? <img src={personalAsset.data.dataUrl || personalAsset.coverUrl} alt={asset.title} className="project-asset-preview-media" /> : personalAsset?.kind === "text" ? <p className="project-asset-preview-text">{personalAsset.data.content}</p> : <div className="grid min-h-48 place-items-center text-foreground/35"><MediaIcon kind={asset.mediaType} /></div>}
                </div>
                <aside className="project-asset-preview-details">
                    <div className="project-asset-preview-eyebrow">{asset.category === "character" ? "角色卡" : mediaLabel(asset.mediaType)}</div>
                    <h3 className="project-asset-preview-title">{asset.title}</h3>
                    <p className="project-asset-preview-meta">更新于 {formatTime(asset.updatedAt)}</p>
                    {asset.character ? <div className="project-asset-preview-sections"><section><span>剧情定位</span><p>{textValue(asset.character.definition.role) || "未填写"}</p></section><section><span>外观设定</span><p>{textValue(asset.character.definition.appearance) || textValue(asset.character.definition.consistencyPrompt) || "未填写"}</p></section><div className="project-asset-preview-status">形象：{asset.character.visualStatus === "ready" ? "已绑定" : "待完善"} · 声音：{asset.character.voiceStatus === "ready" ? "已绑定" : "未绑定"}</div></div> : <div className="project-asset-preview-facts"><span>版本 <strong>v{Math.max(1, asset.versionCount)}</strong></span><span>{asset.usages.length} 处引用</span></div>}
                </aside>
            </div> : null}
        </Modal>
    );
}

function characterDefinition(values: CharacterForm) {
    const definition: Record<string, unknown> = Object.fromEntries(characterFields.map(([key]) => [key, values[key]?.trim() || (key === "aliases" ? [] : "")]));
    definition.aliases = values.aliases?.split(/[，,]/).map((item) => item.trim()).filter(Boolean) || [];
    return definition;
}

function fieldValue(value: unknown) { return Array.isArray(value) ? value.join("，") : typeof value === "string" ? value : ""; }
function syncPersonalCharacterProjection(asset: ProjectAsset) {
    if (!asset.character) return;
    const current = useAssetStore.getState().assets;
    const existing = current.find((item) => item.id === asset.id);
    const cover = asset.character.representations.find((item) => item.role === "turnaround_sheet") || asset.character.representations.find((item) => item.role === "primary") || asset.character.representations.find((item) => item.role === "front");
    const projected: EntityAsset = {
        id: asset.id,
        kind: "entity",
        title: asset.title,
        coverUrl: cover ? resourceFileUrl(cover.resourceId) : existing?.coverUrl || "",
        tags: existing?.tags || [],
        category: "character",
        status: asset.status as AssetStatus,
        primaryVersionId: asset.primaryVersionId,
        source: existing?.source || "project-character",
        createdAt: existing?.createdAt || asset.updatedAt,
        updatedAt: asset.updatedAt,
        data: { definition: asset.character.definition },
    };
    useAssetStore.getState().replaceAssets([projected, ...current.filter((item) => item.id !== asset.id)]);
}
function MediaIcon({ kind }: { kind: string }) { if (kind === "image") return <ImageIcon className="size-10" />; if (kind === "video") return <Video className="size-10" />; if (kind === "audio") return <Music2 className="size-10" />; if (kind === "model") return <Box className="size-10" />; return <FileText className="size-10" />; }
