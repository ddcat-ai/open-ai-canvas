import { uploadImage } from "@/services/image-storage";
import { assetStorageUsageQueryKey, AssetStorageUsage } from "./asset-storage-usage";
import { readFileAsDataUrl, readImageMeta, formatBytes } from "@/lib/image-utils";
import { uploadMediaFile } from "@/services/file-storage";
import { exportAssets, readAssetPackage } from "./asset-transfer";
import { WorkspacePage, PageHeader, CollectionGrid, PaginationBar } from "@/components/layout/workspace-page";
import { Trash2, RotateCcw, Plus, Images, FolderOpen, FileUp, Upload, Download, MoreHorizontal, Search, LayoutGrid, FolderPlus, PencilLine, AlertTriangle, ShieldCheck } from "lucide-react";
import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { Select } from "@/components/ui/base/select";
import { AssetFilterGroup, AssetsBatchBar, AssetsEmptyState, AssetDrawer } from "./asset-library-panels";
import { DeleteButton } from "@/components/ui/base/buttons/delete-button";
import { cn } from "@/lib/utils";
import { WorkspaceNoResultsState, WorkspaceState } from "@/components/layout/workspace-state";
import { AssetCard } from "./asset-library-cards";
import { resourceStorageTitle, resourceStorageLabel } from "@/lib/canvas/resource-storage-status";
import { AssetBatchUploadModal } from "./asset-batch-upload-modal";
import { assetGridCardMinWidth, type AssetGridDensity, assetGridDensityOptions, parseAssetGridDensity } from "./asset-grid-density";
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Form, Popconfirm, Button, Dropdown, Input, Modal, Space, Tag, Typography, Progress } from "antd";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { translate } from "@/i18n";
import { ArkCertifyModal } from "./ark-certify-modal";
import { arkPortraitOverviewQueryKey, getArkPortraitOverview } from "@/services/api/ark-portraits";
import { useArkLibraryReconcile } from "@/hooks/use-ark-library-reconcile";
import { useCopyText } from "@/hooks/use-copy-text";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { arkLibraryProgressMap } from "@/lib/ark-assets";
import { ARK_ASSET_CATEGORY, ASSET_ASSIGNABLE_CATEGORY_OPTIONS, ASSET_CATEGORY_LABELS, ASSET_CATEGORY_OPTIONS, defaultAssetCategoryForKind, normalizeAssetCategory } from "@/lib/asset-category";
import { downloadBrowserMedia } from "@/services/browser-download";
import { flushAssetStorePersistence, useAssetStore, type AssetCategory, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { loadAssetLibraryPage, loadAssetsForUse, saveRemoteUserDataNow, localSavedRemotePendingMessage, deleteAssetsWithRemoteSync, deleteAssetWithRemoteSync } from "@/services/user-data-sync";
import { useUserStore } from "@/stores/use-user-store";
import { createAssetFolder, deleteAssetFolder, listAssetFolders, listRemoteAssetsPage, updateAssetFolder, type AssetFolder, moveRemoteAssetsToFolder } from "@/services/api/user-data";
import { assetCountMap, assetSearchText, readAssetGridDensity, assetKindIcons, assetCategoryIcons } from "./asset-library-format";
import { ASSET_GRID_DENSITY_KEY, type LibraryAsset } from "./asset-library-format";
import { selectAssetIds } from "./asset-library-selection";

export { ASSET_GRID_DENSITY_KEY, type LibraryAsset, assetKindIcons } from "./asset-library-format";

type AssetFormValues = {
    kind: AssetKind;
    category: AssetCategory;
    folderId?: string;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
    arkAssetId?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = [
    { get label() { return translate("library.assets.kind.all"); }, value: "all" },
    { get label() { return translate("library.assets.kind.text"); }, value: "text" },
    { get label() { return translate("library.assets.kind.image"); }, value: "image" },
    { get label() { return translate("library.assets.kind.video"); }, value: "video" },
    { get label() { return translate("library.assets.kind.audio"); }, value: "audio" },
    { get label() { return translate("library.assets.kind.model"); }, value: "model" },
    { get label() { return translate("library.assets.kind.entity"); }, value: "entity" },
];

const categoryOptions = [{ get label() { return translate("library.assets.allCategories"); }, value: "all" }, ...ASSET_CATEGORY_OPTIONS];
// 方舟认证分类只能由认证结果写入：未认证素材从可选分类里排除，已认证素材只展示锁定的方舟认证分类。
const arkLockedCategoryOptions = [{ label: ASSET_CATEGORY_LABELS[ARK_ASSET_CATEGORY], value: ARK_ASSET_CATEGORY }];
const ASSET_LIBRARY_QUERY_KEY = ["asset-library"] as const;
const ASSET_FOLDER_QUERY_KEY = ["asset-folders"] as const;
type AssetFolderFilter = "all" | "uncategorized" | string;

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [certifyingAsset, setCertifyingAsset] = useState<ImageAsset | null>(null);
    const queryClient = useQueryClient();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const modelInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);

    const updateAsset = useAssetStore((state) => state.updateAsset);
    const userId = useUserStore((state) => state.user?.id || "");
    const retentionDays = useUserStore((state) => state.runtimeLimits.recycleBinRetentionDays ?? 30);
    // 方舟审核由服务端定时刷新；有审核中的素材时降频轮询概览，让认证角标跟上结果。
    const arkQuery = useQuery({
        queryKey: arkPortraitOverviewQueryKey,
        queryFn: ({ signal }) => getArkPortraitOverview(signal),
        enabled: Boolean(userId),
        staleTime: 60_000,
        refetchInterval: (query) => (query.state.data?.groups.some((group) => group.owned && group.assets.some((asset) => asset.status === "processing")) ? 30_000 : false),
    });
    const arkEnabled = Boolean(arkQuery.data?.enabled);
    const arkProgress = useMemo(() => arkLibraryProgressMap(arkQuery.data), [arkQuery.data]);
    useArkLibraryReconcile(arkQuery.data);
    const [viewMode, setViewMode] = useState<"library" | "trash">("library");
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [categoryFilter, setCategoryFilter] = useState<AssetCategory | "all">("all");
    const [folderFilter, setFolderFilter] = useState<AssetFolderFilter>("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(40);
    const [gridDensity, setGridDensity] = useState<AssetGridDensity>(readAssetGridDensity);
    const [editingAsset, setEditingAsset] = useState<LibraryAsset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<LibraryAsset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<LibraryAsset | null>(null);
    const [archivingAsset, setArchivingAsset] = useState<LibraryAsset | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [selecting, setSelecting] = useState(false);
    const selectionAnchor = useRef<string | undefined>(undefined);
    const [batchWorking, setBatchWorking] = useState(false);
    const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
    const [batchArchiveOpen, setBatchArchiveOpen] = useState(false);
    const [batchUploadOpen, setBatchUploadOpen] = useState(false);
    const [folderEditor, setFolderEditor] = useState<AssetFolder | "new" | null>(null);
    const [folderName, setFolderName] = useState("");
    const [folderSaving, setFolderSaving] = useState(false);

    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imageUploading, setImageUploading] = useState(false);
    const [imageUploadProgress, setImageUploadProgress] = useState<{ phase: "uploading" | "confirming"; percent?: number } | null>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const debouncedKeyword = useDebouncedValue(keyword.trim(), 250);

    const foldersQuery = useQuery({
        queryKey: ASSET_FOLDER_QUERY_KEY,
        queryFn: () => listAssetFolders(),
        enabled: Boolean(userId),
    });
    const folders = foldersQuery.data?.folders || [];

    const allLibraryAssets = useMemo(() => assets, [assets]);
    const activeAssets = useMemo(() => allLibraryAssets.filter((asset) => asset.status !== "archived"), [allLibraryAssets]);
    const trashAssets = useMemo(() => allLibraryAssets.filter((asset) => asset.status === "archived"), [allLibraryAssets]);
    const validAssets = viewMode === "trash" ? trashAssets : activeAssets;
    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (categoryFilter !== "all" && (asset.category || "other") !== categoryFilter) return false;
            if (folderFilter === "uncategorized" && asset.folderId) return false;
            if (folderFilter !== "all" && folderFilter !== "uncategorized" && asset.folderId !== folderFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter, categoryFilter, folderFilter]);

    const assetPageQuery = useQuery({
        queryKey: [...ASSET_LIBRARY_QUERY_KEY, userId, page, pageSize, viewMode, kindFilter, categoryFilter, folderFilter, debouncedKeyword],
        queryFn: ({ signal }) => loadAssetLibraryPage({
            page,
            pageSize,
            status: viewMode === "trash" ? "archived" : "active",
            kind: kindFilter === "all" ? undefined : kindFilter,
            category: categoryFilter === "all" ? undefined : categoryFilter,
            folderId: folderFilter !== "all" && folderFilter !== "uncategorized" ? folderFilter : undefined,
            uncategorized: folderFilter === "uncategorized",
            query: debouncedKeyword || undefined,
            signal,
        }),
        enabled: Boolean(userId),
        placeholderData: keepPreviousData,
    });

    const localVisibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);
    // 远端成功且本页有可展示素材时用远端。真正的空结果保持空页。
    // 仅在「远端空、本地仍有筛选结果」或「远端总数>0 但本页全是被排除的 entity」时回退本地。
    const remotePageAssets = useMemo(() => assetPageQuery.data?.assets || [], [assetPageQuery.data?.assets]);
    const remoteTotal = assetPageQuery.data?.total ?? 0;
    const remoteReady = assetPageQuery.isSuccess && assetPageQuery.data !== undefined;
    const preferLocalUnsynced = remoteReady && remoteTotal === 0 && localVisibleAssets.length > 0;
    const remoteEntityOnlyPage = remoteReady && remotePageAssets.length === 0 && remoteTotal > 0;
    const useRemotePage = remoteReady && !preferLocalUnsynced && !remoteEntityOnlyPage && (remotePageAssets.length > 0 || remoteTotal === 0);
    const visibleAssets = useMemo(() => useRemotePage ? remotePageAssets : localVisibleAssets, [useRemotePage, remotePageAssets, localVisibleAssets]);
    const visibleAssetIds = useMemo(() => visibleAssets.map((asset) => asset.id), [visibleAssets]);
    const allFilteredSelected = visibleAssetIds.length > 0 && visibleAssetIds.every((id) => selectedIds.includes(id));
    const selectionMode = selecting || selectedIds.length > 0;
    const totalAssets = useRemotePage ? remoteTotal : filteredAssets.length;
    const kindCounts = useMemo(() => assetCountMap(kindOptions, useRemotePage ? assetPageQuery.data?.kindCounts : undefined, viewMode === "trash" ? trashAssets : activeAssets, (asset) => asset.kind), [activeAssets, assetPageQuery.data?.kindCounts, trashAssets, useRemotePage, viewMode]);
    const categoryCounts = useMemo(() => assetCountMap(categoryOptions, useRemotePage ? assetPageQuery.data?.categoryCounts : undefined, viewMode === "trash" ? trashAssets : activeAssets, (asset) => asset.category || "other"), [activeAssets, assetPageQuery.data?.categoryCounts, trashAssets, useRemotePage, viewMode]);
    const folderCounts = assetPageQuery.data?.folderCounts || {};

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(totalAssets / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [pageSize, totalAssets]);

    useEffect(() => {
        window.localStorage.setItem(ASSET_GRID_DENSITY_KEY, String(gridDensity));
    }, [gridDensity]);

    useEffect(() => {
        setSelectedIds([]);
        setSelecting(false);
        selectionAnchor.current = undefined;
    }, [userId, viewMode, keyword, kindFilter, categoryFilter, folderFilter]);

    const selectAsset = (id: string, selected: boolean, range = false) => {
        if (batchWorking || assetPageQuery.isFetching) return;
        setSelecting(true);
        const anchorId = range ? selectionAnchor.current : undefined;
        setSelectedIds((current) => selectAssetIds(current, visibleAssetIds, id, selected, anchorId));
        selectionAnchor.current = id;
    };

    const folderSelectOptions = useMemo(() => [
        { label: t("library.assets.uncategorized"), value: "" },
        ...folders.map((folder) => ({ label: folder.name, value: folder.id })),
    ], [folders, t]);

    const invalidateAssetLibrary = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ASSET_LIBRARY_QUERY_KEY }),
            queryClient.invalidateQueries({ queryKey: ASSET_FOLDER_QUERY_KEY }),
        ]);
    };

    const saveFolder = async () => {
        const name = folderName.trim();
        if (!name || !folderEditor) return;
        setFolderSaving(true);
        try {
            if (folderEditor === "new") await createAssetFolder(name);
            else await updateAssetFolder(folderEditor.id, name);
            setFolderEditor(null);
            setFolderName("");
            await invalidateAssetLibrary();
            message.success(folderEditor === "new" ? t("library.assets.folder.created") : t("library.assets.folder.renamed"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.assets.folder.saveFailed"));
        } finally {
            setFolderSaving(false);
        }
    };

    const removeFolder = async (folder: AssetFolder) => {
        try {
            await deleteAssetFolder(folder.id);
            for (const asset of useAssetStore.getState().assets) {
                if (asset.folderId === folder.id) updateAsset(asset.id, { folderId: undefined });
            }
            await flushAssetStorePersistence();
            if (folderFilter === folder.id) setFolderFilter("all");
            setPage(1);
            await invalidateAssetLibrary();
            message.success(t("library.assets.folder.deleted", { name: folder.name }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.assets.folder.deleteFailed"));
            throw error;
        }
    };

    const moveAssetsToFolder = async (assetIds: string[], folderId: string) => {
        if (!assetIds.length) return;
        try {
            await moveRemoteAssetsToFolder(assetIds, folderId);
            assetIds.forEach((id) => updateAsset(id, { folderId: folderId || undefined }));
            await flushAssetStorePersistence();
            setSelectedIds([]);
            await invalidateAssetLibrary();
            message.success(t("library.assets.moved", { count: assetIds.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.assets.moveFailed"));
        }
    };

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setImageFile(null);
        setImageUploading(false);
        setImageUploadProgress(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", category: "other", folderId: folderFilter !== "all" && folderFilter !== "uncategorized" ? folderFilter : "", title: "", coverUrl: "", tags: [], source: "手动添加", note: "", content: "", arkAssetId: "" });
        setIsAssetOpen(true);
    };

    const openEdit = async (asset: LibraryAsset) => {
        let editableAsset = useAssetStore.getState().assets.find((item) => item.id === asset.id);
        // 服务端会直接改写素材（方舟认证通过后移入「方舟认证」分类）；列表里的版本更新时先刷新本机副本，避免拿旧版本编辑。
        const remoteNewer = Boolean(editableAsset && Date.parse(asset.updatedAt) > Date.parse(editableAsset.updatedAt));
        if (!editableAsset || remoteNewer) {
            try {
                // 分页卡片是轻量 DTO，编辑前补齐完整记录，避免保存时覆盖远端 metadata。
                await loadAssetsForUse([asset.id], remoteNewer ? { refresh: true } : undefined);
                editableAsset = useAssetStore.getState().assets.find((item) => item.id === asset.id);
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("library.assets.detailFailed"));
                return;
            }
        }
        if (!editableAsset) {
            message.error(t("library.assets.detailFailed"));
            return;
        }
        setEditingAsset(editableAsset);
        setImageFile(null);
        setImageUploading(false);
        setImageUploadProgress(null);
        setFormKind(editableAsset.kind);
        setImageDraft(editableAsset.kind === "image" ? editableAsset.data : null);
        form.setFieldsValue({
            kind: editableAsset.kind,
            category: editableAsset.category || "other",
            folderId: editableAsset.folderId || "",
            title: editableAsset.title,
            coverUrl: editableAsset.coverUrl,
            tags: editableAsset.tags || [],
            source: editableAsset.source,
            note: editableAsset.note,
            content: editableAsset.kind === "text" ? editableAsset.data.content : "",
            arkAssetId: editableAsset.arkAssetId || "",
        });
        setIsAssetOpen(true);
    };

    const ensureAssetsInStore = async (assetIds: string[]) => {
        const missingIds = assetIds.filter((id) => !useAssetStore.getState().assets.some((asset) => asset.id === id));
        if (missingIds.length) await loadAssetsForUse(missingIds);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        let imageData = imageDraft;
        if (values.kind === "image" && imageFile) {
            setImageUploading(true);
            setImageUploadProgress({ phase: "uploading", percent: 0 });
            try {
                const image = await uploadImage(imageFile);
                setImageUploadProgress({ phase: "confirming" });
                imageData = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
                setImageDraft(imageData);
                setImageFile(null);
                void queryClient.invalidateQueries({ queryKey: assetStorageUsageQueryKey });
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("library.assets.imageUploadFailed"));
                return;
            } finally {
                setImageUploading(false);
                setImageUploadProgress(null);
            }
        }

        // 方舟认证绑定认证时的图片文件：换图后认证失效，恢复认证前的分类，之后可以重新提交认证。
        const certification = editingAsset?.arkCertification;
        const previousStorageKey = editingAsset?.kind === "image" ? editingAsset.data.storageKey : undefined;
        const certificationLost = Boolean(certification && values.kind === "image" && imageData && imageData.storageKey !== previousStorageKey);
        const keptCertification = certification && !certificationLost ? certification : undefined;
        const restoredCategory = normalizeAssetCategory(certification?.previousCategory, defaultAssetCategoryForKind(values.kind));
        const base = {
            title: values.title.trim(),
            category: certificationLost ? (restoredCategory === ARK_ASSET_CATEGORY ? defaultAssetCategoryForKind(values.kind) : restoredCategory) : keptCertification ? ARK_ASSET_CATEGORY : values.category,
            folderId: values.folderId || undefined,
            status: editingAsset?.status || ("confirmed" as const),
            primaryVersionId: editingAsset?.primaryVersionId,
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageData ? imageData.dataUrl : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            arkAssetId: keptCertification ? editingAsset?.arkAssetId : certificationLost ? undefined : values.arkAssetId?.trim() || undefined,
            arkCertification: keptCertification,
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageData) {
                message.error(t("library.assets.batch.chooseImages"));
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageData };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        await flushAssetStorePersistence();
        try {
            await saveRemoteUserDataNow([]);
            await invalidateAssetLibrary();
            message.success(editingAsset ? t("library.assets.updated") : t("library.assets.saved"));
        } catch (error) {
            message.warning(localSavedRemotePendingMessage(editingAsset ? t("library.assets.updatedLocal") : t("library.assets.savedLocal"), error));
        }
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/") || imageUploading) return;
        try {
            const dataUrl = await readFileAsDataUrl(file);
            const meta = await readImageMeta(dataUrl);
            setImageFile(file);
            const draft = { dataUrl, storageKey: "", width: meta.width, height: meta.height, bytes: file.size, mimeType: file.type || meta.mimeType };
            setImageDraft(draft);
            if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", dataUrl);
            if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.assets.imageReadFailed"));
        }
    };

    const readModelFile = async (file?: File) => {
        if (!file || !/\.(glb|gltf)$/i.test(file.name)) return;
        const uploaded = await uploadMediaFile(file, "model");
        void queryClient.invalidateQueries({ queryKey: assetStorageUsageQueryKey });
        addAsset({
            kind: "model",
            title: file.name.replace(/\.(glb|gltf)$/i, ""),
            coverUrl: "",
            tags: ["3D模型"],
            source: "手动上传",
            data: { url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, fileName: file.name },
            metadata: { source: "manual" },
        });
        // 直传失败时文件只落在本机，云端同步会重传；此时不能说成"已保存"。
        if (uploaded.pendingRemoteUpload) message.warning(uploaded.remoteUploadError ? t("library.assets.modelPendingWithError", { error: uploaded.remoteUploadError }) : t("library.assets.modelPending"));
        else message.success(t("library.assets.modelSaved"));
    };

    const copyAssetText = async (asset: LibraryAsset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("library.assets.textCopied"));
    };

    const downloadImage = async (asset: LibraryAsset) => {
        if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "model") return;
        const url = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        const extension = asset.kind === "model" ? asset.data.fileName.split(".").pop() || "glb" : asset.data.mimeType.split("/")[1] || "png";
        try {
            await downloadBrowserMedia({ storageKey: asset.data.storageKey, url, fileName: `${asset.title || "asset"}.${extension}` });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.assets.downloadFailed"));
        }
    };

    const collectAllAssetIds = async (status: "active" | "archived") => {
        if (!userId)
            return useAssetStore
                .getState()
                .assets.filter((asset) => (asset.status === "archived") === (status === "archived"))
                .map((asset) => asset.id);
        // 先提交本机待保存素材，再固定完整集合；删除期间不继续翻页，避免页偏移漏项。
        await flushAssetStorePersistence();
        await saveRemoteUserDataNow([]);
        const ids = new Set<string>();
        for (let currentPage = 1; ; currentPage++) {
            if (useUserStore.getState().user?.id !== userId) throw new Error(t("library.assets.accountSwitched"));
            const result = await listRemoteAssetsPage({ page: currentPage, pageSize, status });
            if (useUserStore.getState().user?.id !== userId) throw new Error(t("library.assets.accountSwitched"));
            for (const asset of result.assets) ids.add(asset.id);
            if (!result.hasMore) return [...ids];
        }
    };

    const exportAllAssets = async () => {
        if (batchWorking) return;
        setBatchWorking(true);
        try {
            const ids = await collectAllAssetIds(viewMode === "trash" ? "archived" : "active");
            if (!ids.length) {
                message.warning(t("library.assets.nothingToExport"));
                return;
            }
            await loadAssetsForUse(ids);
            const byId = new Map(useAssetStore.getState().assets.map((asset) => [asset.id, asset]));
            await exportAssets(ids.map((id) => byId.get(id)!));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.assets.exportFailed"));
        } finally {
            setBatchWorking(false);
        }
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                // 方舟认证属于原素材与原账号，导入的副本不带认证：去掉认证记录与平台写入的方舟素材 ID，并恢复认证前的分类。
                if (asset.arkCertification || asset.category === ARK_ASSET_CATEGORY) {
                    const restored = normalizeAssetCategory(asset.arkCertification?.previousCategory, defaultAssetCategoryForKind(asset.kind));
                    payload.category = restored === ARK_ASSET_CATEGORY ? defaultAssetCategoryForKind(asset.kind) : restored;
                    if (asset.arkCertification) delete payload.arkAssetId;
                    delete payload.arkCertification;
                }
                addAsset(payload as Parameters<typeof addAsset>[0]);
            });
            message.success(t("library.assets.imported", { count: importedAssets.length }));
        } catch {
            message.error(t("library.assets.importFailed"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const changeAssetStatus = async (ids: string[], status: "archived" | "confirmed") => {
        if (!ids.length || batchWorking) return;
        const assetIds = [...ids];
        const archiving = status === "archived";
        let locallyUpdated = false;
        setBatchWorking(true);
        try {
            await ensureAssetsInStore(assetIds);
            for (const id of assetIds) updateAsset(id, { status });
            await flushAssetStorePersistence();
            locallyUpdated = true;
            await saveRemoteUserDataNow([]);
            setSelectedIds((current) => current.filter((id) => !assetIds.includes(id)));
            setArchivingAsset(null);
            setBatchArchiveOpen(false);
            message.success(t(archiving ? "library.assets.status.archived" : "library.assets.status.restored", { count: assetIds.length }));
            void invalidateAssetLibrary();
        } catch (error) {
            if (locallyUpdated) message.warning(localSavedRemotePendingMessage(t(archiving ? "library.assets.status.archivedLocal" : "library.assets.status.restoredLocal"), error));
            else message.error(error instanceof Error ? error.message : t(archiving ? "library.assets.status.archiveFailed" : "library.assets.status.restoreFailed"));
        } finally {
            setBatchWorking(false);
        }
    };

    const emptyTrash = async () => {
        if (batchWorking) return;
        setBatchWorking(true);
        let deletedCount = 0;
        try {
            const ids = await collectAllAssetIds("archived");
            if (!ids.length) {
                message.info(t("library.assets.trash.alreadyEmpty"));
                return;
            }
            for (let offset = 0; offset < ids.length; offset += pageSize) {
                if (useUserStore.getState().user?.id !== userId) throw new Error(t("library.assets.accountSwitched"));
                const batch = ids.slice(offset, offset + pageSize);
                await deleteAssetsWithRemoteSync(batch);
                deletedCount += batch.length;
            }
            setSelectedIds([]);
            message.success(t("library.assets.trash.emptied", { count: deletedCount }));
            void invalidateAssetLibrary();
        } catch (error) {
            const reason = error instanceof Error ? error.message : t("library.assets.trash.emptyFailed");
            if (deletedCount) message.warning(t("library.assets.trash.partial", { count: deletedCount, reason }));
            else message.error(reason);
        } finally {
            setBatchWorking(false);
        }
    };

    const confirmDelete = async () => {
        if (!deletingAsset) return;
        try {
            await deleteAssetWithRemoteSync(deletingAsset.id);
            message.success(t("library.assets.deleted"));
            setDeletingAsset(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.assets.deleteFailed"));
        }
    };

    const exportSelectedAssets = async () => {
        if (!selectedIds.length || batchWorking) return;
        const ids = [...selectedIds];
        setBatchWorking(true);
        try {
            await loadAssetsForUse(ids);
            const byId = new Map(useAssetStore.getState().assets.map((asset) => [asset.id, asset]));
            await exportAssets(ids.map((id) => byId.get(id)!));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.assets.exportFailed"));
        } finally {
            setBatchWorking(false);
        }
    };

    const confirmBatchDelete = async () => {
        if (!selectedIds.length || batchWorking) return;
        const ids = [...selectedIds];
        setBatchWorking(true);
        try {
            await deleteAssetsWithRemoteSync(ids);
            message.success(t("library.assets.batchDeleted", { count: ids.length }));
            setSelectedIds([]);
            setBatchDeleteOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.assets.batchDeleteFailed"));
        } finally {
            setBatchWorking(false);
        }
    };

    return (
        <>
            <WorkspacePage grid className="library-page assets-library-page canvas-library-page">
                <div className="studio-band">
                    <PageHeader
                        title={viewMode === "trash" ? t("library.assets.page.trashTitle") : t("library.assets.page.title")}
                        description={viewMode === "trash" ? t("library.assets.page.trashDescription") : t("library.assets.page.description")}
                        meta={<span className="app-projects-header-meta assets-header-meta">{t("library.assets.page.count", { count: totalAssets })}</span>}
                        actions={
                            <div className="assets-header-actions">
                                <AssetStorageUsage />
                                <div className="assets-header-action-buttons">
                                    {viewMode === "trash" ? (
                                        <>
                                            {userId || trashAssets.length > 0 ? (
                                                <Popconfirm
                                                    title={t("library.assets.trash.confirmTitle")}
                                                    description={t("library.assets.trash.confirmDescription")}
                                                    onConfirm={() => void emptyTrash()}
                                                    okText={t("library.assets.trash.confirmOk")}
                                                    okButtonProps={{ danger: true }}
                                                    cancelText={t("common.cancel")}
                                                >
                                                    <Button danger loading={batchWorking} icon={<Trash2 className="size-3.5" />}>
                                                        {t("library.assets.trash.empty")}
                                                    </Button>
                                                </Popconfirm>
                                            ) : null}
                                            <Button
                                                icon={<RotateCcw className="size-3.5" />}
                                                onClick={() => {
                                                    setViewMode("library");
                                                    setPage(1);
                                                    setSelectedIds([]);
                                                }}
                                            >
                                                {t("library.assets.page.backToLibrary")}
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button type="primary" icon={<Plus />} onClick={openCreate}>{t("library.assets.page.create")}</Button>
                                            <Button icon={<Images />} onClick={() => setBatchUploadOpen(true)}>{t("library.assets.page.uploadImages")}</Button>
                                            {arkEnabled ? (
                                                <Button icon={<ShieldCheck />} onClick={() => navigate("/settings?section=ark-assets")}>
                                                    {t("library.assets.page.ark")}
                                                </Button>
                                            ) : null}
                                            <Dropdown trigger={["click"]} menu={{ items: [
                                                { key: "eagle", icon: <FolderOpen />, label: t("library.assets.page.eagle"), onClick: () => navigate("/plugins/eagle") },
                                                { key: "package", icon: <FileUp />, label: t("library.assets.page.importPackage"), onClick: () => assetInputRef.current?.click() },
                                                { key: "model", icon: <Upload />, label: t("library.assets.page.uploadModel"), onClick: () => modelInputRef.current?.click() },
                                                { key: "export", icon: <Download />, label: t("library.assets.page.exportAll"), onClick: () => void exportAllAssets() },
                                            ] }}>
                                                <Button type="text" aria-label={t("library.assets.page.moreActions")} icon={<MoreHorizontal />} />
                                            </Dropdown>
                                        </>
                                    )}
                                </div>
                            </div>
                        }
                    />
                    <CollectionToolbar
                        active={Boolean(keyword || kindFilter !== "all" || categoryFilter !== "all" || folderFilter !== "all")}
                        onReset={() => {
                            setKeyword("");
                            setKindFilter("all");
                            setCategoryFilter("all");
                            setFolderFilter("all");
                            setPage(1);
                        }}
                    >
                        <Input
                            allowClear
                            className="w-full sm:w-80"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder={t("library.assets.page.searchPlaceholder")}
                            onChange={(event) => {
                                setPage(1);
                                setKeyword(event.target.value);
                            }}
                            />
                            <Select
                                aria-label={t("library.assets.page.density")}
                                value={gridDensity}
                                className="w-full sm:w-32"
                                prefix={<LayoutGrid aria-hidden className="size-3.5" />}
                                options={assetGridDensityOptions}
                                onChange={(value) => setGridDensity(parseAssetGridDensity(value))}
                            />
                            <Button aria-pressed={selectionMode} onClick={() => {
                                setSelecting(!selectionMode);
                                setSelectedIds([]);
                                selectionAnchor.current = undefined;
                            }} disabled={batchWorking}>
                                {selectionMode ? t("library.assets.page.exitSelection") : t("library.assets.page.batchSelect")}
                            </Button>
                        </CollectionToolbar>
                </div>

                <div className="collection-content assets-collection-content">
                    <div className="assets-collection-layout">
                        <aside className="assets-collection-filters" aria-label={t("library.assets.page.filters")}>
                            <div className="assets-collection-filter-scroll">
                            <AssetFilterGroup
                                title={t("library.assets.page.kindFilter")}
                                options={kindOptions}
                                value={viewMode === "library" ? kindFilter : ""}
                                counts={kindCounts}
                                onChange={(value) => {
                                    setViewMode("library");
                                    setKindFilter(value as AssetKind | "all");
                                    setPage(1);
                                }}
                            />
                            <AssetFilterGroup
                                title={t("library.assets.batch.category")}
                                options={categoryOptions}
                                icons={assetCategoryIcons}
                                value={viewMode === "library" ? categoryFilter : ""}
                                counts={categoryCounts}
                                onChange={(value) => {
                                    setViewMode("library");
                                    setCategoryFilter(value as AssetCategory | "all");
                                    setPage(1);
                                }}
                            />
                            <section className="collection-filter-group assets-folder-filter">
                                <div className="collection-folder-heading">
                                    <span className="collection-filter-label">{t("library.assets.page.myFolders")}</span>
                                    <button type="button" className="assets-folder-add" title={t("library.assets.folder.create")} aria-label={t("library.assets.folder.create")} onClick={() => { setFolderName(""); setFolderEditor("new"); }}><FolderPlus className="size-3.5" /></button>
                                </div>
                                <div className="collection-folder-list">
                                    <button type="button" aria-pressed={folderFilter === "all"} className={`assets-filter-item ${folderFilter === "all" ? "is-active" : ""}`} onClick={() => { setFolderFilter("all"); setPage(1); }}>
                                        <span className="assets-filter-item-label">{t("library.assets.kind.all")}</span><span className="assets-filter-count">{activeAssets.length}</span>
                                    </button>
                                    <button type="button" aria-pressed={folderFilter === "uncategorized"} className={`assets-filter-item ${folderFilter === "uncategorized" ? "is-active" : ""}`} onClick={() => { setFolderFilter("uncategorized"); setPage(1); }}>
                                        <span className="assets-filter-item-label">{t("library.assets.uncategorized")}</span><span className="assets-filter-count">{folderCounts[""] ?? activeAssets.filter((asset) => !asset.folderId).length}</span>
                                    </button>
                                    {folders.map((folder) => (
                                        <div key={folder.id} className="assets-folder-row">
                                            <button type="button" aria-pressed={folderFilter === folder.id} className={`assets-filter-item min-w-0 flex-1 ${folderFilter === folder.id ? "is-active" : ""}`} onClick={() => { setFolderFilter(folder.id); setPage(1); }}>
                                                <span className="assets-filter-item-label min-w-0 truncate">{folder.name}</span><span className="assets-filter-count">{folderCounts[folder.id] ?? activeAssets.filter((asset) => asset.folderId === folder.id).length}</span>
                                            </button>
                                            <button type="button" className="product-icon-button" aria-label={t("library.assets.folder.renameLabel", { name: folder.name })} onClick={() => { setFolderName(folder.name); setFolderEditor(folder); }}><PencilLine /></button>
                                            <DeleteButton label={t("library.assets.folder.deleteLabel", { name: folder.name })} description={t("library.assets.folder.deleteDescription")} onConfirm={() => removeFolder(folder)} />
                                        </div>
                                    ))}
                                </div>
                            </section>
                            </div>
                            <div className="collection-trash-entry">
                                <button
                                    type="button"
                                    aria-pressed={viewMode === "trash"}
                                    className={cn(
                                        "assets-filter-item w-full transition-colors",
                                        viewMode === "trash" ? "is-active !bg-amber-500/15 !text-amber-600 dark:!text-amber-400 font-semibold shadow-sm" : "text-foreground/65 hover:text-foreground",
                                    )}
                                    onClick={() => {
                                        if (viewMode === "trash") {
                                            setViewMode("library");
                                        } else {
                                            setViewMode("trash");
                                            setKindFilter("all");
                                            setCategoryFilter("all");
                                        }
                                        setPage(1);
                                        setSelectedIds([]);
                                    }}
                                >
                                    <span className="assets-filter-item-label flex items-center gap-2">
                                        <Trash2 className="size-3.5" />
                                        <span>{t("library.picker.recycleBin")}</span>
                                    </span>
                                    <span className="assets-filter-count">{trashAssets.length}</span>
                                </button>
                            </div>
                        </aside>
                        <section className="min-w-0">
                            {viewMode === "trash" ? (
                                <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-300">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                                        <span>{retentionDays > 0 ? t("library.assets.trash.retention", { days: retentionDays }) : t("library.assets.trash.retentionForever")}</span>
                                    </div>
                                </div>
                            ) : null}
                            {selectionMode ? (
                                <AssetsBatchBar
                                    count={selectedIds.length}
                                    isTrash={viewMode === "trash"}
                                    allSelected={allFilteredSelected}
                                    busy={batchWorking}
                                    pageLoading={assetPageQuery.isFetching}
                                    onSelectAll={() => setSelectedIds((current) => Array.from(new Set([...current, ...visibleAssetIds])))}
                                    onClear={() => { setSelectedIds([]); selectionAnchor.current = undefined; }}
                                    onExport={() => void exportSelectedAssets()}
                                    onRestore={() => void changeAssetStatus(selectedIds, "confirmed")}
                                    onArchive={() => setBatchArchiveOpen(true)}
                                    onDelete={() => setBatchDeleteOpen(true)}
                                />
                            ) : null}
                            {validAssets.length === 0 && totalAssets === 0 ? (
                                viewMode === "trash" ? (
                                    <WorkspaceState icon="assets" compact title={t("library.picker.recycleBinEmpty")} description={t("library.assets.trash.emptyDescription")} />
                                ) : (
                                    <AssetsEmptyState onNew={openCreate} onImport={() => assetInputRef.current?.click()} onGoCanvas={() => navigate("/canvas")} />
                                )
                            ) : (
                                <>
                                    {visibleAssets.length === 0 ? (
                                        <WorkspaceNoResultsState
                                            icon="assets"
                                            compact
                                            query={keyword}
                                            description={t("library.assets.page.noResults")}
                                            onClear={() => {
                                                setKeyword("");
                                                setKindFilter("all");
                                                setCategoryFilter("all");
                                                setFolderFilter("all");
                                                setPage(1);
                                            }}
                                        />
                                    ) : (
                                        <CollectionGrid className="library-grid assets-library-grid" style={{ "--collection-grid-min-width": `${assetGridCardMinWidth[gridDensity]}px` } as React.CSSProperties}>
                                            {visibleAssets.map((asset) => (
                                                <AssetCard
                                                    key={asset.id}
                                                    asset={asset}
                                                    selected={selectedIds.includes(asset.id)}
                                                    selectionMode={selectionMode}
                                                    isTrash={viewMode === "trash"}
                                                    retentionDays={retentionDays}
                                                    onSelect={(selected, range) => selectAsset(asset.id, selected, range)}
                                                    onOpen={() => setPreviewAsset(asset)}
                                                    onEdit={() => void openEdit(asset)}
                                                    onCopy={copyAssetText}
                                                    onDownload={downloadImage}
                                                    onRestore={() => void changeAssetStatus([asset.id], "confirmed")}
                                                    onArchive={() => setArchivingAsset(asset)}
                                                    onDelete={() => setDeletingAsset(asset)}
                                                    folderOptions={folderSelectOptions}
                                                    onMoveToFolder={(folderId) => void moveAssetsToFolder([asset.id], folderId)}
                                                    arkProgress={arkEnabled ? arkProgress.get(asset.id) : undefined}
                                                />
                                            ))}
                                        </CollectionGrid>
                                    )}
                                    <PaginationBar
                                        current={page}
                                        pageSize={pageSize}
                                        total={totalAssets}
                                        pageSizeOptions={[40, 80, 120]}
                                        onChange={(nextPage, nextPageSize) => {
                                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                                            setPageSize(nextPageSize);
                                        }}
                                    />
                                </>
                            )}
                        </section>
                    </div>
                </div>
            </WorkspacePage>

            <ArkCertifyModal asset={certifyingAsset} onClose={() => setCertifyingAsset(null)} />
            <Modal
                className="workspace-modal workspace-modal-wide library-modal"
                title={editingAsset ? t("library.assets.form.editTitle") : t("library.assets.page.create")}
                open={isAssetOpen}
                onCancel={() => {
                    if (!imageUploading) setIsAssetOpen(false);
                }}
                onOk={() => void saveAsset()}
                okText={imageUploading ? t("library.assets.form.uploading") : t("common.save")}
                cancelText={t("common.cancel")}
                confirmLoading={imageUploading}
                cancelButtonProps={{ disabled: imageUploading }}
                closable={!imageUploading}
                destroyOnHidden
            >
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", category: "other", tags: [] }}>
                        <Form.Item name="kind" label={t("library.assets.form.kind")}>
                            <Select
                                options={[
                                    { label: t("library.assets.kind.text"), value: "text" },
                                    { label: t("library.assets.kind.image"), value: "image" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="category" label={t("library.assets.batch.category")} extra={editingAsset?.category === ARK_ASSET_CATEGORY ? t("library.assets.form.arkCategoryLocked") : undefined}>
                            <Select disabled={editingAsset?.category === ARK_ASSET_CATEGORY} options={editingAsset?.category === ARK_ASSET_CATEGORY ? arkLockedCategoryOptions : ASSET_ASSIGNABLE_CATEGORY_OPTIONS} />
                        </Form.Item>
                        <Form.Item name="title" label={t("library.assets.form.title")} rules={[{ required: true, message: t("library.assets.form.titleRequired") }]}>
                            <Input placeholder={t("library.assets.form.titlePlaceholder")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={t("library.assets.form.coverUrl")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("library.assets.form.coverUrlPlaceholder")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {t("library.assets.form.upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={t("library.assets.form.tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("library.assets.form.tagsPlaceholder")} />
                        </Form.Item>
                        <Form.Item
                            name="arkAssetId"
                            label={t("library.assets.form.arkAssetId")}
                            extra={editingAsset?.arkCertification ? t("library.ark.detail.hint") : undefined}
                            rules={[{ pattern: /^asset-[A-Za-z0-9-]+$/, message: t("library.assets.form.arkAssetIdInvalid") }]}
                        >
                            <Input autoComplete="off" allowClear disabled={Boolean(editingAsset?.arkCertification)} placeholder={t("library.assets.form.arkAssetIdPlaceholder")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("library.assets.form.source")}>
                                <Input placeholder={t("library.assets.form.sourcePlaceholder")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("library.assets.form.note")}>
                                <Input placeholder={t("library.assets.form.optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("library.assets.form.content")} rules={[{ required: true, message: t("library.assets.form.contentRequired") }]}>
                                <Input.TextArea rows={8} placeholder={t("library.assets.form.contentPlaceholder")} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={t("library.assets.form.image")} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button disabled={imageUploading} icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {imageUploading ? t("library.assets.form.imageUploading") : t("library.assets.form.chooseImage")}
                                    </Button>
                                    {imageFile ? (
                                        <Tag color="gold" className="ml-3">
                                            {t("library.assets.form.pendingUpload")}
                                        </Tag>
                                    ) : null}
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs" title={resourceStorageTitle(imageDraft.storageKey)}>
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)} · {resourceStorageLabel(imageDraft.storageKey)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("library.assets.form.noImage")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="lg:pl-4">
                        <Typography.Text strong className="text-xs">
                            {t("library.assets.form.preview")}
                        </Typography.Text>
                        <div className="mt-2 overflow-hidden rounded-md bg-stone-100 dark:bg-stone-900">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <div className={`asset-preview-uploading ${imageUploading ? "is-uploading" : ""}`}>
                                    <img src={coverUrl || imageDraft?.dataUrl} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
                                    {imageUploading && imageUploadProgress ? (
                                        <div className="asset-preview-uploading-panel">
                                            <div className="asset-preview-uploading-copy">
                                                <span>{imageUploadProgress.phase === "confirming" ? t("library.assets.form.confirming") : t("library.assets.form.uploadingCloud")}</span>
                                                {typeof imageUploadProgress.percent === "number" ? <strong>{imageUploadProgress.percent}%</strong> : null}
                                            </div>
                                            <Progress percent={imageUploadProgress.percent} showInfo={false} size="small" status="active" />
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || t("library.assets.form.noCover")}</div>
                            )}
                            <div className="bg-background p-3">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("library.picker.untitled")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{t("library.assets.form.noTags")}</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetDrawer
                asset={previewAsset}
                onClose={() => setPreviewAsset(null)}
                onCopy={copyAssetText}
                onDownload={downloadImage}
                ark={
                    arkEnabled && previewAsset
                        ? {
                              progress: arkProgress.get(previewAsset.id),
                              onCertify: (asset) => setCertifyingAsset(asset),
                              onManage: () => navigate("/settings?section=ark-assets"),
                          }
                        : undefined
                }
            />

            <AssetBatchUploadModal open={batchUploadOpen} defaultFolderId={folderFilter !== "all" && folderFilter !== "uncategorized" ? folderFilter : ""} folders={folders} onClose={() => setBatchUploadOpen(false)} onComplete={async () => { setBatchUploadOpen(false); await invalidateAssetLibrary(); }} />

            <Modal
                className="library-modal library-confirm-modal"
                title={folderEditor === "new" ? t("library.assets.folder.create") : t("library.assets.folder.rename")}
                open={Boolean(folderEditor)}
                confirmLoading={folderSaving}
                onCancel={() => { if (!folderSaving) setFolderEditor(null); }}
                onOk={() => void saveFolder()}
                okText={t("common.save")}
                cancelText={t("common.cancel")}
            >
                <Input autoFocus value={folderName} maxLength={40} placeholder={t("library.assets.folder.namePlaceholder")} onChange={(event) => setFolderName(event.target.value)} onPressEnter={() => void saveFolder()} />
            </Modal>

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />
            <input
                ref={modelInputRef}
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                className="hidden"
                onChange={(event) => {
                    void readModelFile(event.target.files?.[0]);
                    event.currentTarget.value = "";
                }}
            />

            <Modal
                className="library-modal library-confirm-modal"
                title={t("library.assets.archive.title")}
                open={Boolean(archivingAsset)}
                onCancel={() => { if (!batchWorking) setArchivingAsset(null); }}
                onOk={() => {
                    if (archivingAsset) {
                        void changeAssetStatus([archivingAsset.id], "archived");
                    }
                }}
                confirmLoading={batchWorking}
                cancelButtonProps={{ disabled: batchWorking }}
                okText={t("library.assets.archive.ok")}
                cancelText={t("common.cancel")}
            >
                {t("library.assets.archive.confirm", { name: archivingAsset?.title })}
            </Modal>
            <Modal
                className="library-modal library-confirm-modal"
                title={t("library.assets.archive.batchTitle")}
                open={batchArchiveOpen}
                onCancel={() => { if (!batchWorking) setBatchArchiveOpen(false); }}
                onOk={() => void changeAssetStatus(selectedIds, "archived")}
                confirmLoading={batchWorking}
                cancelButtonProps={{ disabled: batchWorking }}
                okText={t("library.assets.archive.ok")}
                cancelText={t("common.cancel")}
            >
                {t("library.assets.archive.batchConfirm", { count: selectedIds.length })}
            </Modal>
            <Modal
                className="library-modal library-confirm-modal"
                title={t("library.assets.delete.title")}
                open={Boolean(deletingAsset)}
                onCancel={() => setDeletingAsset(null)}
                onOk={() => void confirmDelete()}
                okText={t("library.picker.deletePermanently")}
                okButtonProps={{ danger: true }}
                cancelText={t("common.cancel")}
            >
                {t("library.assets.delete.confirm", { name: deletingAsset?.title })}
            </Modal>
            <Modal
                className="library-modal library-confirm-modal"
                title={t("library.assets.delete.batchTitle")}
                open={batchDeleteOpen}
                onCancel={() => { if (!batchWorking) setBatchDeleteOpen(false); }}
                onOk={() => void confirmBatchDelete()}
                confirmLoading={batchWorking}
                cancelButtonProps={{ disabled: batchWorking }}
                okText={t("library.picker.deletePermanently")}
                okButtonProps={{ danger: true }}
                cancelText={t("common.cancel")}
            >
                {t("library.assets.delete.batchConfirm", { count: selectedIds.length })}
            </Modal>
        </>
    );
}
