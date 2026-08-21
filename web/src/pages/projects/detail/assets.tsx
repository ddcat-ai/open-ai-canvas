import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, Form, Input, Modal, Popconfirm, Select, Tabs, type FormInstance } from "antd";
import { Box, Check, ChevronDown, Download, FileText, FolderOpen, FolderPlus, Image as ImageIcon, Link2, MoreHorizontal, MoveRight, Music2, Pencil, Plus, RefreshCw, Sparkles, Trash2, UserRound, Video, VolumeX } from "lucide-react";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { AssetMediaPreview } from "@/components/asset-media-preview";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { AssetLibraryCard, AssetLibraryCardMedia } from "@/components/assets/asset-library-card";
import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import { CanvasFolderPreview } from "@/components/canvas/canvas-folder-preview";
import { CANVAS_FOLDER_THEME_OPTIONS, resolveCanvasFolderTheme } from "@/lib/canvas/canvas-folder-theme";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import {
    bindProjectCharacterVoice,
    confirmProjectAssetCandidate,
    createProjectAssetFolder,
    createProjectAssetVersion,
    createProjectCharacter,
    deleteProjectAssetFolder,
    getProjectCharacter,
    linkProjectAsset,
    listVoiceProfiles,
    moveProjectAsset,
    replaceProjectCharacterRepresentations,
    unbindProjectCharacterVoice,
    unlinkProjectAsset,
    updateProjectAssetCategory,
    updateProjectAssetFolder,
    updateProjectCharacter,
    type ProjectAsset,
    type ProjectAssetFolder,
    type ProjectDetail,
} from "@/services/api/projects";
import { saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useAssetStore, type Asset, type AssetCategory, type AssetStatus, type EntityAsset, type ImageAsset } from "@/stores/use-asset-store";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasFolderStyle, type CanvasFolderTheme, type CanvasNodeData } from "@/types/canvas";
import { saveAs } from "file-saver";

import { ProjectCharacterCard } from "./project-character-card";
import { generateCharacterTurnaround } from "./project-character-media";
import { categoryLabels, categoryLabel, mediaLabel, StatusPill, formatTime, textValue, type ProjectDetailViewProps } from "./shared";

const categories = ["all", "character", "environment", "wardrobe", "prop", "weapon", "style", "other"];
const ALL_FOLDERS = "__all_folders__";
const pickerCategoryLabels = { all: "全部素材", ...categoryLabels };
const characterFields = [
    ["role", "剧情定位与人物关系"], ["aliases", "别名"], ["appearance", "稳定外貌"], ["physique", "身高、体型与体态"],
    ["clothing", "默认服装造型"], ["personality", "性格与表演基线"], ["props", "固定道具"],
    ["consistencyPrompt", "跨镜头一致性约束"], ["multiViewPrompt", "三视图补充约束"],
    ["voiceLanguage", "语言与口音"], ["voiceAge", "声音年龄感"], ["voiceTimbre", "音色气质"],
] as const;

type CharacterForm = { name: string } & Record<(typeof characterFields)[number][0], string>;

export default function ProjectAssetsView({ detail, refreshProject }: ProjectDetailViewProps) {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const personalAssets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updatePersonalAsset = useAssetStore((state) => state.updateAsset);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [category, setCategory] = useState("all");
    const [folderId, setFolderId] = useState("");
    const [folderEditor, setFolderEditor] = useState<{ folder?: ProjectAssetFolder; parentId: string } | null>(null);
    const [folderName, setFolderName] = useState("");
    const [addOpen, setAddOpen] = useState(false);
    const [editorAsset, setEditorAsset] = useState<ProjectAsset | "new" | null>(null);
    const [imageAsset, setImageAsset] = useState<ProjectAsset | null>(null);
    const externalAssetSources = useExternalAssetSources(addOpen || Boolean(imageAsset));
    const [voiceAsset, setVoiceAsset] = useState<ProjectAsset | null>(null);
    const [previewAsset, setPreviewAsset] = useState<ProjectAsset | null>(null);
    const [voiceProfileId, setVoiceProfileId] = useState("");
    const [voiceInstructions, setVoiceInstructions] = useState("");
    const [form] = Form.useForm<CharacterForm>();

    const projectAssetIds = new Set(detail.assets.map((asset) => asset.id));
    const availableAssets = personalAssets.filter((asset) => !projectAssetIds.has(asset.id));
    const imageAssets = personalAssets.filter((asset): asset is ImageAsset => asset.kind === "image");
    const availablePickerItems = useMemo<AssetLibraryPickerItem[]>(() => [
        ...availableAssets.map((asset) => ({
            id: asset.id,
            title: asset.title,
            category: asset.kind === "entity" ? "character" : asset.category || "other",
            kindLabel: mediaLabel(asset.kind),
            asset,
            description: asset.note,
            searchText: asset.tags.join(" "),
        })),
        ...externalAssetSources.items,
    ], [availableAssets, externalAssetSources.items]);
    const imagePickerItems = useMemo<AssetLibraryPickerItem[]>(() => [
        ...imageAssets.map((asset) => ({
            id: asset.id,
            title: asset.title,
            category: asset.category || "other",
            kindLabel: "图片",
            asset,
            searchText: asset.tags.join(" "),
        })),
        ...externalAssetSources.items.filter((item) => item.external?.item.kind === "image"),
    ], [externalAssetSources.items, imageAssets]);
    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.category === "character" && candidate.status === "pending_confirmation");
    const characterAssets = detail.assets.filter((asset) => asset.category === "character" && asset.character);
    const mediaAssetCount = detail.assets.filter((asset) => asset.category !== "character").length;
    const assetFolders = detail.assetFolders || [];
    const currentFolder = assetFolders.find((folder) => folder.id === folderId);
    const childFolders = folderId === ALL_FOLDERS ? [] : assetFolders.filter((folder) => (folder.parentId || "") === folderId);
    const visibleAssets = useMemo(() => detail.assets.filter((asset) => {
        if (category !== "all" && asset.category !== category) return false;
        return folderId === ALL_FOLDERS || (asset.folderId || "") === folderId;
    }), [category, detail.assets, folderId]);
    const folderPath = useMemo(() => projectAssetFolderPath(assetFolders, folderId), [assetFolders, folderId]);
    const folderMoveItems = useMemo(() => [
        { key: "", label: "素材库 / 根目录" },
        ...assetFolders.map((folder) => ({ key: folder.id, label: projectAssetFolderLabel(assetFolders, folder) })),
    ], [assetFolders]);
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
    const addMutation = useMutation({ mutationFn: ({ assetId, category: nextCategory, nextFolderId }: { assetId: string; category: string; nextFolderId?: string }) => linkProjectAsset(detail.project.id, { assetId, category: nextCategory, folderId: nextFolderId }), onSuccess: ({ asset }) => { updatePersonalAsset(asset.id, { category: asset.category as AssetCategory, status: asset.status as AssetStatus, primaryVersionId: asset.primaryVersionId }); setAddOpen(false); done("资产已加入项目"); }, onError: failed("资产加入失败") });
    const versionMutation = useMutation({ mutationFn: (id: string) => createProjectAssetVersion(detail.project.id, id, {}), onSuccess: () => done("已创建新版本"), onError: failed("版本创建失败") });
    const unlinkMutation = useMutation({ mutationFn: (id: string) => unlinkProjectAsset(detail.project.id, id), onSuccess: () => done("资产已移出项目"), onError: failed("资产移除失败") });
    const categoryMutation = useMutation({ mutationFn: ({ id, next }: { id: string; next: string }) => updateProjectAssetCategory(detail.project.id, id, next), onSuccess: ({ asset }) => { updatePersonalAsset(asset.id, { category: asset.category as AssetCategory }); done("资产分类已更新"); }, onError: failed("资产分类更新失败") });
    const moveMutation = useMutation({ mutationFn: ({ id, nextFolderId }: { id: string; nextFolderId: string }) => moveProjectAsset(detail.project.id, id, nextFolderId), onSuccess: () => done("资产已移动"), onError: failed("资产移动失败") });
    const createFolderMutation = useMutation({
        mutationFn: ({ name, parentId }: { name: string; parentId: string }) => createProjectAssetFolder(detail.project.id, { name, parentId: parentId || undefined }),
        onSuccess: ({ folder }) => { setFolderEditor(null); setFolderName(""); setFolderId(folder.parentId || ""); done("文件夹已创建"); },
        onError: failed("文件夹创建失败"),
    });
    const renameFolderMutation = useMutation({
        mutationFn: ({ id, name }: { id: string; name: string }) => updateProjectAssetFolder(detail.project.id, id, { name }),
        onSuccess: () => { setFolderEditor(null); setFolderName(""); done("文件夹已重命名"); },
        onError: failed("文件夹重命名失败"),
    });
    const styleFolderMutation = useMutation({
        mutationFn: ({ id, style }: { id: string; style: CanvasFolderStyle }) => updateProjectAssetFolder(detail.project.id, id, { style }),
        onSuccess: () => done("文件夹样式已更新"),
        onError: failed("文件夹样式更新失败"),
    });
    const themeFolderMutation = useMutation({
        mutationFn: ({ id, theme }: { id: string; theme: CanvasFolderTheme }) => updateProjectAssetFolder(detail.project.id, id, { theme }),
        onSuccess: () => done("文件夹主题已更新"),
        onError: failed("文件夹主题更新失败"),
    });
    const moveFolderMutation = useMutation({
        mutationFn: ({ id, parentId }: { id: string; parentId: string }) => updateProjectAssetFolder(detail.project.id, id, { parentId }),
        onSuccess: () => done("文件夹已移动"),
        onError: failed("文件夹移动失败"),
    });
    const deleteFolderMutation = useMutation({
        mutationFn: (id: string) => deleteProjectAssetFolder(detail.project.id, id),
        onSuccess: (_, deletedId) => { if (folderId === deletedId) setFolderId(""); done("文件夹已删除"); },
        onError: failed("文件夹删除失败"),
    });
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
        mutationFn: async (selectedAssetId: string) => {
            if (!imageAsset) throw new Error("未选择角色");
            await saveRemoteUserDataNow();
            const latest = useAssetStore.getState().assets;
            const pickerItem = imagePickerItems.find((item) => item.id === selectedAssetId);
            const selected = latest.find((asset) => asset.id === selectedAssetId) || (pickerItem?.external ? await externalAssetSources.importExternalAsset(pickerItem.external) : undefined);
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
    const openImages = (asset: ProjectAsset) => setImageAsset(asset);
    const openVoice = (asset: ProjectAsset) => { setVoiceAsset(asset); setVoiceProfileId(asset.character?.voice?.profile.id || ""); setVoiceInstructions(asset.character?.voice?.instructions || ""); };
    const openFolderEditor = (folder?: ProjectAssetFolder, parentId = folderId === ALL_FOLDERS ? "" : folderId) => {
        setFolderEditor({ folder, parentId: folder?.parentId || parentId });
        setFolderName(folder?.name || "");
    };
    const saveFolder = () => {
        const name = folderName.trim();
        if (!name) {
            message.warning("请输入文件夹名称");
            return;
        }
        if (folderEditor?.folder) renameFolderMutation.mutate({ id: folderEditor.folder.id, name });
        else if (folderEditor) createFolderMutation.mutate({ name, parentId: folderEditor.parentId });
    };
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
        else {
            const remoteUrl = projectAssetRemoteUrl(asset);
            if (remoteUrl) saveAs(remoteUrl, `${asset.title || "asset"}.${projectAssetFileExtension(asset.mediaType)}`);
            else message.warning("当前资产没有可下载的媒体文件");
        }
    };
    return (
        <div>
            <header className="flex min-h-[72px] flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                            <h2 className="text-[var(--fs-heading-lg)] font-semibold leading-6">角色与资产</h2>
                            <span className="rounded bg-foreground/[.055] px-1.5 py-1 text-[var(--fs-tiny)] font-medium tabular-nums text-foreground/45">{detail.assets.length} 项已确认</span>
                        </div>
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[var(--fs-label)] text-foreground/48">
                            <span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5" />{characterAssets.length} 个角色</span>
                            <span className="inline-flex items-center gap-1.5"><Box className="size-3.5" />{mediaAssetCount} 项媒体</span>
                            {pendingCandidates.length ? <span className="inline-flex items-center gap-1.5 text-foreground/55"><Sparkles className="size-3.5" />{pendingCandidates.length} 个待确认</span> : null}
                        </div>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 sm:pl-4">
                    <Button type="text" className="!h-9 !px-3" icon={<FolderPlus className="size-3.5" />} onClick={() => openFolderEditor()}>新建文件夹</Button>
                    <Button type="text" className="!h-9 !px-3" icon={<Link2 className="size-3.5" />} onClick={() => setAddOpen(true)}>引用素材</Button>
                    <Button type="primary" className="!h-9 !px-3.5" icon={<Plus className="size-3.5" />} onClick={() => openCharacterEditor("new")}>新建角色</Button>
                </div>
            </header>
            <div className="project-assets-layout mt-3 grid gap-3">
                <nav className="space-y-0.5 pr-2" aria-label="素材目录与资产分类">
                    <div className="mb-1 flex h-8 items-center justify-between px-2 text-[var(--fs-tiny)] font-medium text-foreground/42"><span>素材目录</span><button type="button" className="rounded p-1 hover:bg-surface-hover" aria-label="新建根目录文件夹" onClick={() => openFolderEditor(undefined, "")}><FolderPlus className="size-3.5" /></button></div>
                    <button type="button" onClick={() => { setFolderId(""); setCategory("all"); }} className={`flex h-11 w-full items-center gap-2 rounded-md px-2 text-left text-xs ${folderId === "" ? "bg-surface-active font-medium" : "text-foreground/55 hover:bg-surface-hover"}`}><FolderOpen className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">素材库</span><span className="text-[var(--fs-tiny)] tabular-nums text-foreground/42">{detail.assets.filter((asset) => !asset.folderId).length}</span></button>
                    <ProjectAssetFolderTree folders={assetFolders} assets={detail.assets} selectedId={folderId} onSelect={(next) => { setFolderId(next); setCategory("all"); }} />
                    <div className="my-2 h-px bg-foreground/[.08]" />
                    <div className="mb-1 h-8 px-2 text-[var(--fs-tiny)] font-medium leading-8 text-foreground/42">分类筛选</div>
                    {categoryCounts.map((item) => <button key={item.value} type="button" onClick={() => { setCategory(item.value); setFolderId(ALL_FOLDERS); }} className={`flex h-11 w-full items-center justify-between rounded-md px-2 text-left text-xs ${folderId === ALL_FOLDERS && category === item.value ? "bg-surface-active font-medium" : "text-foreground/55 hover:bg-surface-hover"}`}><span>{item.value === "all" ? "全部资产" : categoryLabels[item.value]}</span><span className="min-w-5 rounded bg-foreground/[.05] px-1 text-center text-[var(--fs-tiny)] tabular-nums">{item.count}</span></button>)}
                </nav>
                <div className="min-w-0">
                    <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1 text-xs text-foreground/48">
                            <button type="button" className="truncate rounded px-1.5 py-1 hover:bg-surface-hover" onClick={() => { setFolderId(""); setCategory("all"); }}>素材库</button>
                            {folderId === ALL_FOLDERS ? <><span>/</span><span className="font-medium text-foreground">全部资产</span></> : folderPath.map((folder) => <span key={folder.id} className="contents"><span>/</span><button type="button" className="truncate rounded px-1.5 py-1 font-medium text-foreground hover:bg-surface-hover" onClick={() => setFolderId(folder.id)}>{folder.name}</button></span>)}
                        </div>
                        {folderId !== ALL_FOLDERS ? <Button type="text" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => openFolderEditor(undefined, folderId)}>新建子文件夹</Button> : null}
                    </div>
                    {childFolders.length ? <div className="project-asset-folder-grid mb-5">{childFolders.map((folder) => <ProjectAssetFolderCard key={folder.id} folder={folder} folders={assetFolders} assets={detail.assets} personalAssets={personalAssets} onOpen={() => { setFolderId(folder.id); setCategory("all"); }} onRename={() => openFolderEditor(folder)} onMove={(parentId) => moveFolderMutation.mutate({ id: folder.id, parentId })} onStyle={(style) => styleFolderMutation.mutate({ id: folder.id, style })} onTheme={(theme) => themeFolderMutation.mutate({ id: folder.id, theme })} onDelete={() => modal.confirm({ title: `删除文件夹“${folder.name}”？`, content: "仅空文件夹可以删除，素材和子文件夹不会被级联删除。", okText: "删除", okButtonProps: { danger: true }, cancelText: "取消", onOk: () => deleteFolderMutation.mutateAsync(folder.id) })} deleting={(deleteFolderMutation.isPending && deleteFolderMutation.variables === folder.id) || (moveFolderMutation.isPending && moveFolderMutation.variables?.id === folder.id) || (styleFolderMutation.isPending && styleFolderMutation.variables?.id === folder.id) || (themeFolderMutation.isPending && themeFolderMutation.variables?.id === folder.id)} />)}</div> : null}
                    {folderId === ALL_FOLDERS && (category === "all" || category === "character") && pendingCandidates.length ? (
                        <section className="mb-4" aria-label="待确认角色">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 text-xs font-medium"><Sparkles className="size-3.5 text-foreground/50" />剧情识别出的角色</div>
                                <span className="text-[var(--fs-tiny)] tabular-nums text-foreground/42">剩余 {pendingCandidates.length} 个待确认</span>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                {pendingCandidates.map((candidate) => {
                                    const confirming = confirmingCandidateId === candidate.id;
                                    return (
                                        <article key={candidate.id} className="flex min-h-28 items-center gap-3 rounded-lg bg-surface-active p-3">
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
                    <div className="mb-2 flex items-center justify-between text-xs text-foreground/45"><span>{currentFolder?.name || (folderId === ALL_FOLDERS ? (category === "all" ? "全部资产" : categoryLabel(category)) : "根目录内容")}</span><span>{visibleAssets.length} 项已确认</span></div>
                    {visibleAssets.length ? <div className="project-assets-grid assets-library-grid">{visibleAssets.map((asset) => asset.category === "character" ? <ProjectCharacterCard key={asset.id} asset={asset} folderItems={folderMoveItems} generating={generatingAssetIds.has(asset.id)} removing={(moveMutation.isPending && moveMutation.variables?.id === asset.id) || (unlinkMutation.isPending && unlinkMutation.variables === asset.id)} onOpen={() => setPreviewAsset(asset)} onEdit={() => openCharacterEditor(asset)} onGenerate={() => generateMutation.mutate(asset)} onBindImages={() => openImages(asset)} onBindVoice={() => openVoice(asset)} onMove={(nextFolderId) => moveMutation.mutate({ id: asset.id, nextFolderId })} onRemove={() => unlinkMutation.mutate(asset.id)} /> : <MediaAssetCard key={asset.id} asset={asset} personalAsset={personalAssets.find((item) => item.id === asset.id)} folderItems={folderMoveItems} onOpen={() => setPreviewAsset(asset)} onMove={(nextFolderId) => moveMutation.mutate({ id: asset.id, nextFolderId })} onCategoryChange={(next) => categoryMutation.mutate({ id: asset.id, next })} onVersion={() => versionMutation.mutate(asset.id)} onRemove={() => unlinkMutation.mutate(asset.id)} loading={(moveMutation.isPending && moveMutation.variables?.id === asset.id) || (categoryMutation.isPending && categoryMutation.variables?.id === asset.id) || (versionMutation.isPending && versionMutation.variables === asset.id) || (unlinkMutation.isPending && unlinkMutation.variables === asset.id)} />)}</div> : childFolders.length || (folderId === ALL_FOLDERS && (category === "all" || category === "character") && pendingCandidates.length) ? null : <WorkspaceState icon="assets" compact title="这个文件夹还没有内容" description="可以新建子文件夹、引用个人素材，或把画布产物归档到这里。" />}
                </div>
            </div>

            <AssetLibraryPickerModal
                open={addOpen}
                items={availablePickerItems}
                categoryLabels={{ ...pickerCategoryLabels, ...externalAssetSources.categoryLabels }}
                folders={externalAssetSources.folders}
                footerNote={externalAssetSources.error || undefined}
                multiple={false}
                title="素材库"
                confirmLabel={() => "加入项目"}
                emptyTitle="没有可引用的素材"
                emptyDescription="本地素材已全部加入项目，或切换到插件来源选择外部素材。"
                onClose={() => setAddOpen(false)}
                onConfirm={async (ids) => {
                    const selectedItem = availablePickerItems.find((item) => item.id === ids[0]);
                    if (selectedItem?.external) {
                        const imported = await externalAssetSources.importExternalAsset(selectedItem.external);
                        const assetId = addAsset(imported);
                        await addMutation.mutateAsync({ assetId, category: imported.kind === "entity" ? "character" : imported.category || "other", nextFolderId: folderId === ALL_FOLDERS ? undefined : folderId });
                        return;
                    }
                    const selected = selectedItem?.asset || personalAssets.find((asset) => asset.id === ids[0]);
                    if (!selected) throw new Error("所选素材已不存在，请重新选择");
                    await addMutation.mutateAsync({ assetId: selected.id, category: selected.kind === "entity" ? "character" : selected.category || "other", nextFolderId: folderId === ALL_FOLDERS ? undefined : folderId });
                }}
            />
            <ProjectAssetPreviewModal asset={previewAsset} personalAsset={previewAsset ? personalAssets.find((item) => item.id === previewAsset.id) : undefined} onClose={() => setPreviewAsset(null)} onDownload={() => previewAsset && downloadPreviewAsset(previewAsset)} onReplaceImage={() => { if (!previewAsset || previewAsset.category !== "character") return; setPreviewAsset(null); openImages(previewAsset); }} />
            <CharacterEditorModal open={Boolean(editorAsset)} editing={editorAsset !== "new"} form={form} loading={saveCharacter.isPending} onClose={() => setEditorAsset(null)} onSave={() => form.validateFields().then((values) => saveCharacter.mutate(values))} />
            <Modal className="workspace-modal workspace-modal-compact" title={folderEditor?.folder ? "重命名文件夹" : "新建文件夹"} open={Boolean(folderEditor)} okText={folderEditor?.folder ? "保存" : "创建"} cancelText="取消" okButtonProps={{ loading: createFolderMutation.isPending || renameFolderMutation.isPending }} onCancel={() => { setFolderEditor(null); setFolderName(""); }} onOk={saveFolder}>
                <div className="grid gap-2"><span className="text-[var(--fs-label)] text-foreground/48">位置：{folderEditor ? projectAssetFolderParentLabel(assetFolders, folderEditor.parentId) : ""}</span><Input autoFocus maxLength={60} value={folderName} placeholder="输入文件夹名称" onChange={(event) => setFolderName(event.target.value)} onPressEnter={saveFolder} /></div>
            </Modal>
            <AssetLibraryPickerModal
                open={Boolean(imageAsset)}
                items={imagePickerItems}
                categoryLabels={{ ...pickerCategoryLabels, ...externalAssetSources.categoryLabels }}
                folders={externalAssetSources.folders}
                footerNote={externalAssetSources.error || undefined}
                multiple={false}
                eyebrow="绑定图片"
                title={imageAsset?.title || "角色三视图"}
                confirmLabel={() => "绑定并生成新版本"}
                emptyTitle="没有可绑定的图片"
                emptyDescription="需要一张包含正面、侧面、背面的角色设定图。"
                onClose={() => setImageAsset(null)}
                onConfirm={async (ids) => {
                    if (!ids[0]) throw new Error("请选择一张三视图设定图");
                    await bindImagesMutation.mutateAsync(ids[0]);
                }}
            />
            <Modal className="workspace-modal workspace-modal-compact" title={`选择声音素材 · ${voiceAsset?.title || ""}`} open={Boolean(voiceAsset)} okText="绑定并生成新版本" cancelText="取消" okButtonProps={{ loading: bindVoiceMutation.isPending, disabled: !voiceProfileId }} onCancel={() => setVoiceAsset(null)} onOk={() => bindVoiceMutation.mutate()}><div className="grid gap-3"><Select loading={voices.isLoading} showSearch optionFilterProp="label" value={voiceProfileId || undefined} placeholder="选择声音" options={(voices.data?.profiles || []).map((voice) => ({ label: `${voice.name} · ${voice.language}`, value: voice.id }))} onChange={setVoiceProfileId} /><Input.TextArea rows={3} value={voiceInstructions} placeholder="表演指令，例如：克制、温暖、语速稍慢" onChange={(event) => setVoiceInstructions(event.target.value)} />{voiceAsset?.character && voiceAsset.character.voiceStatus !== "missing" ? <div className="flex items-center justify-between pt-1"><span className="text-[var(--fs-label)] text-foreground/45">当前绑定：{voiceAsset.character.voice?.profile.name || "声音素材不可用"}</span><Popconfirm title="解除当前声音绑定？" description="该操作会保留历史版本，并创建一个未绑定声音的新版本。" okText="解除" cancelText="取消" onConfirm={() => unbindVoiceMutation.mutate()}><Button type="text" danger size="small" loading={unbindVoiceMutation.isPending} icon={<VolumeX className="size-3.5" />}>解除声音</Button></Popconfirm></div> : null}</div></Modal>
        </div>
    );
}

function ProjectAssetFolderTree({ folders, assets, selectedId, onSelect }: { folders: ProjectAssetFolder[]; assets: ProjectAsset[]; selectedId: string; onSelect: (folderId: string) => void }) {
    const renderLevel = (parentId: string, depth: number, visited: ReadonlySet<string>): ReactNode => depth >= 8 ? null : folders
        .filter((folder) => (folder.parentId || "") === parentId)
        .map((folder) => {
            if (visited.has(folder.id)) return null;
            const count = assets.filter((asset) => asset.folderId === folder.id).length;
            const nextVisited = new Set(visited).add(folder.id);
            return <div key={folder.id}><button type="button" onClick={() => onSelect(folder.id)} className={`flex h-9 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[var(--fs-label)] ${selectedId === folder.id ? "bg-surface-active font-medium" : "text-foreground/52 hover:bg-surface-hover"}`} style={{ paddingLeft: `calc(var(--space-2) + ${depth} * var(--space-3))` }}><FolderOpen className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{folder.name}</span><span className="text-[var(--fs-micro)] tabular-nums text-foreground/36">{count}</span></button>{renderLevel(folder.id, depth + 1, nextVisited)}</div>;
        });
    return <div>{renderLevel("", 0, new Set())}</div>;
}

function ProjectAssetFolderCard({ folder, folders, assets, personalAssets, onOpen, onRename, onMove, onStyle, onTheme, onDelete, deleting }: { folder: ProjectAssetFolder; folders: ProjectAssetFolder[]; assets: ProjectAsset[]; personalAssets: Asset[]; onOpen: () => void; onRename: () => void; onMove: (parentId: string) => void; onStyle: (style: CanvasFolderStyle) => void; onTheme: (theme: CanvasFolderTheme) => void; onDelete: () => void; deleting: boolean }) {
    const directAssets = assets.filter((asset) => (asset.folderId || "") === folder.id);
    const totalCount = projectAssetFolderDescendantAssetCount(folders, assets, folder.id);
    const childFolderCount = folders.filter((item) => item.parentId === folder.id).length;
    const moveItems = projectAssetFolderMoveItems(folders, folder);
    const data: CanvasNodeData = {
        id: folder.id,
        type: CanvasNodeType.Frame,
        title: folder.name,
        position: { x: 0, y: 0 },
        width: 360,
        height: 280,
        metadata: {
            frame: { collapsed: true, expandedWidth: 760, expandedHeight: 520 },
            folder: { style: projectAssetFolderStyle(folder.style), theme: resolveCanvasFolderTheme(folder.theme), createdAt: folder.createdAt },
        },
    };
    const childNodes = directAssets.slice(0, 3).map((asset, index) => projectAssetCanvasPreviewNode(asset, personalAssets.find((item) => item.id === asset.id), index));
    return <article className="project-asset-folder-card" aria-label={`${folder.name} 文件夹，共 ${totalCount} 项`}>
        <button type="button" className="project-asset-folder-open" aria-label={`打开文件夹 ${folder.name}`} onClick={onOpen} />
        <div className="project-asset-folder-visual"><CanvasFolderPreview data={data} childNodes={childNodes} active={false} isDropTarget={false} readOnly onToggleCollapsed={onOpen} onTitleChange={() => undefined} onStyleChange={() => undefined} onThemeChange={() => undefined} /></div>
        <div className="project-asset-folder-card-footer"><span>{directAssets.length} 项内容{childFolderCount ? ` · ${childFolderCount} 个子文件夹` : ""}</span><Dropdown trigger={["click"]} menu={{ selectedKeys: [`style:${folder.style}`, `theme:${resolveCanvasFolderTheme(folder.theme)}`], items: [{ key: "rename", label: "重命名", icon: <Pencil className="size-3.5" /> }, { key: "move", label: "移动到", icon: <MoveRight className="size-3.5" />, children: moveItems }, { key: "style", label: "切换样式", children: [{ key: "style:glass", label: "流光玻璃" }, { key: "style:stacked", label: "内容陈列" }, { key: "style:midnight", label: "午夜封面" }, { key: "style:paper", label: "纸感收藏" }, { key: "style:cinema", label: "电影胶片" }, { key: "style:compact", label: "紧凑资料" }] }, { key: "theme", label: "切换主题", children: CANVAS_FOLDER_THEME_OPTIONS.map((item) => ({ key: `theme:${item.key}`, label: item.label })) }, { key: "delete", label: "删除空文件夹", icon: <Trash2 className="size-3.5" />, danger: true }], onClick: ({ key, domEvent }) => { domEvent.stopPropagation(); if (key === "rename") onRename(); else if (key.startsWith("move:")) onMove(key === "move:root" ? "" : key.slice(5)); else if (key.startsWith("style:")) onStyle(key.slice(6) as CanvasFolderStyle); else if (key.startsWith("theme:")) onTheme(key.slice(6) as CanvasFolderTheme); else if (key === "delete") onDelete(); } }}><button type="button" className="project-asset-folder-menu" disabled={deleting} aria-label={`${folder.name} 文件夹操作`} onClick={(event) => event.stopPropagation()}><MoreHorizontal className="size-4" /></button></Dropdown></div>
    </article>;
}

function projectAssetCanvasPreviewNode(asset: ProjectAsset, personalAsset: Asset | undefined, index: number): CanvasNodeData {
    const type = asset.mediaType === "image" || asset.category === "character" ? CanvasNodeType.Image : asset.mediaType === "video" ? CanvasNodeType.Video : asset.mediaType === "audio" ? CanvasNodeType.Audio : CanvasNodeType.Text;
    const characterCover = asset.character?.representations.find((item) => item.role === "turnaround_sheet") || asset.character?.representations.find((item) => item.role === "primary") || asset.character?.representations[0];
    const content = characterCover
        ? resourceFileUrl(characterCover.resourceId)
        : personalAsset?.kind === "image"
            ? personalAsset.data.dataUrl || personalAsset.coverUrl
            : personalAsset?.kind === "video" || personalAsset?.kind === "audio"
                ? personalAsset.data.url
                    : personalAsset?.kind === "text"
                        ? personalAsset.data.content
                    : projectAssetRemoteUrl(asset) || asset.previewText || "";
    return { id: asset.id, type, title: asset.title, position: { x: index * 24, y: index * 18 }, width: 240, height: 160, metadata: { content, assetId: asset.id } };
}

function projectAssetFolderStyle(style?: string): CanvasFolderStyle {
    return style === "glass" || style === "stacked" || style === "midnight" || style === "paper" || style === "cinema" || style === "compact" ? style : "glass";
}

function projectAssetRemoteUrl(asset: ProjectAsset) {
    const resourceId = resourceIdFromStorageKey(asset.storageKey);
    return resourceId ? resourceFileUrl(resourceId) : "";
}

function projectAssetFileExtension(mediaType: string) {
    if (mediaType === "image") return "png";
    if (mediaType === "video") return "mp4";
    if (mediaType === "audio") return "mp3";
    if (mediaType === "model") return "glb";
    return "txt";
}

function projectAssetFolderPath(folders: ProjectAssetFolder[], folderId: string) {
    if (!folderId || folderId === ALL_FOLDERS) return [];
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const result: ProjectAssetFolder[] = [];
    const seen = new Set<string>();
    let current = byId.get(folderId);
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        result.unshift(current);
        current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return result;
}

function projectAssetFolderLabel(folders: ProjectAssetFolder[], folder: ProjectAssetFolder) {
    return projectAssetFolderPath(folders, folder.id).map((item) => item.name).join(" / ");
}

function projectAssetFolderParentLabel(folders: ProjectAssetFolder[], parentId: string) {
    const path = parentId ? projectAssetFolderPath(folders, parentId).map((item) => item.name) : [];
    return ["素材库", ...path].join(" / ");
}

function projectAssetFolderMoveItems(folders: ProjectAssetFolder[], movingFolder: ProjectAssetFolder) {
    const blocked = new Set([movingFolder.id]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const folder of folders) {
            if (!folder.parentId || blocked.has(folder.id) || !blocked.has(folder.parentId)) continue;
            blocked.add(folder.id);
            changed = true;
        }
    }
    return [
        { key: "move:root", label: "素材库 / 根目录", disabled: !movingFolder.parentId },
        ...folders.filter((folder) => !blocked.has(folder.id)).map((folder) => ({ key: `move:${folder.id}`, label: projectAssetFolderLabel(folders, folder), disabled: movingFolder.parentId === folder.id })),
    ];
}

function projectAssetFolderDescendantAssetCount(folders: ProjectAssetFolder[], assets: ProjectAsset[], folderId: string) {
    const descendantIds = new Set([folderId]);
    let added = true;
    while (added) {
        added = false;
        for (const folder of folders) {
            if (!folder.parentId || descendantIds.has(folder.id) || !descendantIds.has(folder.parentId)) continue;
            descendantIds.add(folder.id);
            added = true;
        }
    }
    return assets.filter((asset) => asset.folderId && descendantIds.has(asset.folderId)).length;
}

function CharacterEditorModal({ open, editing, form, loading, onClose, onSave }: { open: boolean; editing: boolean; form: FormInstance<CharacterForm>; loading: boolean; onClose: () => void; onSave: () => void }) {
    const field = (key: CharacterFormKey) => characterFields.find(([name]) => name === key)!;
    const textArea = (key: CharacterFormKey, rows = 3) => <Form.Item name={key} label={field(key)[1]}><Input.TextArea rows={rows} placeholder={key === "appearance" ? "先描述用户能看到的稳定特征…" : undefined} /></Form.Item>;
    const input = (key: CharacterFormKey) => <Form.Item name={key} label={field(key)[1]}><Input /></Form.Item>;
    return <Modal className="workspace-modal workspace-modal-wide library-modal" title={null} open={open} forceRender okText={editing ? "保存角色设定" : "创建角色卡"} cancelText="取消" okButtonProps={{ loading }} onCancel={onClose} onOk={onSave} styles={{ body: { paddingTop: 0 } }}>
        <div className="mb-1 pb-4"><div className="text-[var(--fs-label)] font-medium text-foreground/52">角色设定</div><h2 className="mt-1 text-xl font-semibold">{editing ? "调整角色设定" : "建立一张角色卡"}</h2></div>
        <Form form={form} layout="vertical" requiredMark={false} className="pt-2"><Form.Item name="name" label="角色名称" rules={[{ required: true, message: "请输入角色名称" }]}><Input size="large" placeholder="例如：林默" /></Form.Item><Tabs items={[{ key: "identity", label: "身份与外观", forceRender: true, children: <div className="grid gap-x-5 sm:grid-cols-2">{input("role")}{input("aliases")}{textArea("appearance", 4)}{input("physique")}{input("clothing")}{input("props")}{textArea("consistencyPrompt", 4)}{textArea("multiViewPrompt", 3)}</div> }, { key: "performance", label: "表演与声音", forceRender: true, children: <div className="grid gap-x-5 sm:grid-cols-2">{textArea("personality", 4)}{input("voiceLanguage")}{input("voiceAge")}{input("voiceTimbre")}</div> }]} /></Form>
    </Modal>;
}

type CharacterFormKey = (typeof characterFields)[number][0];

function MediaAssetCard({ asset, personalAsset, folderItems, onOpen, onMove, onCategoryChange, onVersion, onRemove, loading }: { asset: ProjectAsset; personalAsset?: Asset; folderItems: Array<{ key: string; label: string }>; onOpen: () => void; onMove: (folderId: string) => void; onCategoryChange: (category: string) => void; onVersion: () => void; onRemove: () => void; loading: boolean }) {
    return <AssetLibraryCard className="project-asset-library-card"><AssetLibraryCardMedia className="relative aspect-[4/3] overflow-hidden bg-foreground/[.05]"><button type="button" className="project-asset-media-button" onClick={onOpen} aria-label={`查看资产：${asset.title}`}><ProjectAssetMedia asset={asset} personalAsset={personalAsset} /><div className="absolute inset-x-2 top-2 flex items-center justify-between"><StatusPill status={asset.status} /><span className="rounded bg-black/50 px-1.5 py-0.5 text-[var(--fs-micro)] text-white">{mediaLabel(asset.mediaType)}</span></div></button></AssetLibraryCardMedia><div className="p-2.5"><button type="button" className="project-asset-title-button" onClick={onOpen}><span className="min-w-0 truncate text-xs font-medium">{asset.title}</span><span className="shrink-0 text-[var(--fs-micro)] text-foreground/38">{formatTime(asset.updatedAt)}</span></button><div className="mt-1 flex items-center gap-1.5 text-[var(--fs-tiny)] text-foreground/42"><Dropdown trigger={["click"]} menu={{ selectedKeys: [asset.category], items: Object.entries(categoryLabels).filter(([value]) => value !== "character").map(([value, label]) => ({ key: value, label })), onClick: ({ key }) => onCategoryChange(key) }}><button type="button" disabled={loading} className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[var(--fs-tiny)] text-foreground/50 hover:bg-surface-hover"><span>{categoryLabel(asset.category)}</span><ChevronDown className="size-3" /></button></Dropdown><span>·</span><span>v{Math.max(1, asset.versionCount)}</span><Link2 className="ml-auto size-3.5 shrink-0 text-foreground/42" /></div><div className="mt-2 flex items-center justify-between gap-2 pt-1"><span className="text-[var(--fs-micro)] text-foreground/38">{mediaLabel(asset.mediaType)}</span><div className="flex items-center"><Dropdown trigger={["click"]} menu={{ selectedKeys: [asset.folderId || ""], items: folderItems, onClick: ({ key }) => onMove(key) }}><Button type="text" size="small" icon={<MoveRight className="size-3.5" />} loading={loading} aria-label={`移动 ${asset.title}`} /></Dropdown><Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={onVersion} aria-label={`为 ${asset.title} 创建版本`} /><Popconfirm title="移出项目资产？" okText="移出" cancelText="取消" onConfirm={onRemove}><Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} loading={loading} aria-label={`移出 ${asset.title}`} /></Popconfirm></div></div></div></AssetLibraryCard>;
}

function ProjectAssetMedia({ asset, personalAsset }: { asset: ProjectAsset; personalAsset?: Asset }) {
    if (personalAsset) return <AssetMediaPreview asset={personalAsset} alt={asset.title} className="h-full w-full bg-black object-cover" fallback={<div className="grid h-full place-items-center text-foreground/25"><MediaIcon kind={asset.mediaType} /></div>} />;
    const remoteUrl = projectAssetRemoteUrl(asset);
    if (asset.mediaType === "image" && remoteUrl) return <img src={remoteUrl} alt={asset.title} className="h-full w-full bg-black object-cover" />;
    if (asset.mediaType === "video" && remoteUrl) return <video src={remoteUrl} muted preload="metadata" className="h-full w-full bg-black object-cover" />;
    if (asset.mediaType === "text" && asset.previewText) return <p className="line-clamp-6 h-full overflow-hidden p-4 text-left text-xs leading-5 text-foreground/62">{asset.previewText}</p>;
    return <div className="grid h-full place-items-center text-foreground/25"><MediaIcon kind={asset.mediaType} /></div>;
}

function ProjectAssetPreviewModal({ asset, personalAsset, onClose, onDownload, onReplaceImage }: { asset: ProjectAsset | null; personalAsset?: Asset; onClose: () => void; onDownload: () => void; onReplaceImage: () => void }) {
    const characterCover = asset?.character?.representations.find((item) => item.role === "turnaround_sheet") || asset?.character?.representations.find((item) => item.role === "primary") || asset?.character?.representations[0];
    const remoteUrl = asset ? projectAssetRemoteUrl(asset) : "";
    const canDownload = Boolean(personalAsset && ["image", "video", "audio", "model"].includes(personalAsset.kind)) || Boolean(characterCover) || Boolean(remoteUrl);
    const previewKind = personalAsset?.kind || asset?.mediaType;
    const previewClass = asset?.category === "character" ? "is-character" : previewKind === "video" ? "is-video" : previewKind === "audio" ? "is-audio" : previewKind === "text" ? "is-text" : "is-image";
    return (
        <Modal className="workspace-modal workspace-modal-wide library-modal project-asset-preview-modal" title={asset?.category === "character" ? "角色卡预览" : "资产预览"} open={Boolean(asset)} onCancel={onClose} footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>关闭</Button>{asset?.category === "character" ? <Button onClick={onReplaceImage}>替换图片</Button> : null}{canDownload ? <Button type="primary" icon={<Download className="size-3.5" />} onClick={onDownload}>下载</Button> : null}</div>}>
            {asset ? <div className="project-asset-preview-layout">
                <div className={`project-asset-preview-stage ${previewClass}`}>
                    {asset.category === "character" ? characterCover ? <CachedResourceImage storageKey={`resource:${characterCover.resourceId}`} src={resourceFileUrl(characterCover.resourceId)} alt={asset.title} className="project-asset-preview-media" fallback={<div className="grid min-h-48 place-items-center text-foreground/35"><UserRound className="size-12" /></div>} /> : <div className="grid min-h-48 place-items-center text-foreground/35"><UserRound className="size-12" /></div> : personalAsset?.kind === "video" ? <video src={personalAsset.data.url} controls className="project-asset-preview-media" /> : personalAsset?.kind === "audio" ? <audio src={personalAsset.data.url} controls className="project-asset-preview-audio" /> : personalAsset?.kind === "image" ? <AssetMediaPreview asset={personalAsset} alt={asset.title} className="project-asset-preview-media" /> : personalAsset?.kind === "text" ? <p className="project-asset-preview-text">{personalAsset.data.content}</p> : asset.mediaType === "video" && remoteUrl ? <video src={remoteUrl} controls className="project-asset-preview-media" /> : asset.mediaType === "audio" && remoteUrl ? <audio src={remoteUrl} controls className="project-asset-preview-audio" /> : asset.mediaType === "image" && remoteUrl ? <img src={remoteUrl} alt={asset.title} className="project-asset-preview-media" /> : asset.mediaType === "text" && asset.previewText ? <p className="project-asset-preview-text">{asset.previewText}</p> : <div className="grid min-h-48 place-items-center text-foreground/35"><MediaIcon kind={asset.mediaType} /></div>}
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
