import { App, Button, Dropdown, Popconfirm } from "antd";
import { useTranslation } from "react-i18next";
import type { MenuProps } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { Check, ChevronDown, FileText, FolderOpen, HardDrive, Image as ImageIcon, LoaderCircle, Music2, Puzzle, RotateCcw, Search, Trash2, Upload, UserRound, Video, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useUserStore } from "@/stores/use-user-store";

import { AssetMediaPreview } from "@/components/asset-media-preview";
import { AudioPlayButton, AudioWaveArt, CharacterAssetCover } from "@/components/assets/asset-rich-cover";
import { AssetLibraryCard } from "@/components/assets/asset-library-card";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { PaginationBar } from "@/components/layout/workspace-page";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n";
import type { ExternalAssetPickerReference } from "@/lib/plugins/plugin-types";
import { flushAssetStorePersistence, useAssetStore, type Asset } from "@/stores/use-asset-store";
import { deleteAssetsWithRemoteSync, loadAssetLibraryPage, localSavedRemotePendingMessage, saveRemoteUserDataNow } from "@/services/user-data-sync";

import "./asset-library-picker-modal.css";

export type AssetPickerMediaKind = "image" | "video" | "audio" | "text";

export const ASSET_PICKER_MEDIA_KIND_LABELS: Record<AssetPickerMediaKind, string> = {
    get image() {
        return translate("library.picker.kind.image");
    },
    get video() {
        return translate("library.picker.kind.video");
    },
    get audio() {
        return translate("library.picker.kind.audio");
    },
    get text() {
        return translate("library.picker.kind.text");
    },
};

const DEFAULT_MEDIA_KINDS: AssetPickerMediaKind[] = ["image", "video", "audio"];
const PICKER_SKELETON_CARDS = 8;

export type AssetLibraryPickerItem = {
    id: string;
    title: string;
    category: string;
    archived?: boolean;
    kindLabel: string;
    /** 媒体类型筛选依据；缺省时按本地素材或插件素材的 kind 推断。 */
    mediaKind?: AssetPickerMediaKind;
    asset?: Asset;
    imageUrl?: string;
    imageStorageKey?: string;
    imageFit?: "cover" | "contain";
    description?: string;
    searchText?: string;
    disabledReason?: string;
    folderId?: string;
    external?: ExternalAssetPickerReference;
};

export type AssetLibraryPickerFolder = {
    id: string;
    parentId?: string;
    name: string;
};

type Props = {
    remoteLibrary?: boolean;
    remoteKind?: string;
    /** 远端素材库里的角色卡是否展示并可选（插入画布时会作为角色卡节点）。 */
    allowCharacters?: boolean;
    /** 调用方能处理 onConfirm 的 pickedItems 时设为 true：远端分页里不在本地缓存的素材也可选。 */
    acceptRemoteItems?: boolean;
    /** 远端条目不依赖本地缓存，仍需按调用方当前能力校验。 */
    remoteItemDisabledReason?: (asset: Asset) => string | undefined;
    /** 左侧「媒体类型」筛选项；只有一种类型或已由 remoteKind 固定时不展示该分组。 */
    mediaKinds?: AssetPickerMediaKind[];
    open: boolean;
    items: AssetLibraryPickerItem[];
    categoryLabels: Record<string, string>;
    initialCategory?: string;
    initialFolderId?: string;
    folders?: AssetLibraryPickerFolder[];
    initialSelectedIds?: Iterable<string>;
    multiple?: boolean;
    title?: string;
    eyebrow?: string;
    confirmLabel?: (count: number) => string;
    emptyTitle?: string;
    emptyDescription?: string;
    footerNote?: string;
    loading?: boolean;
    pagination?: { current: number; pageSize: number; total: number; onChange: (page: number, pageSize: number) => void };
    folderActionLabel?: string;
    folderActionSource?: "local" | "all";
    upload?: {
        accept: string;
        description: string;
        onUpload: (files: FileList) => Promise<string[]>;
        external?: {
            accept: string;
            description: string;
            onUpload: (files: FileList, folderId?: string) => Promise<AssetLibraryPickerItem[]>;
        };
    };
    onClose: () => void;
    /** pickedItems 包含远端分页里选中的条目（它们不在调用方传入的 items 里）。 */
    onConfirm: (ids: string[], pickedItems?: AssetLibraryPickerItem[]) => Promise<void> | void;
    onFolderAction?: (folderId: string) => Promise<void> | void;
};

export function AssetLibraryPickerModal({
    remoteLibrary = false,
    remoteKind,
    allowCharacters = false,
    acceptRemoteItems = false,
    remoteItemDisabledReason,
    mediaKinds = DEFAULT_MEDIA_KINDS,
    open,
    items,
    categoryLabels,
    initialCategory = "all",
    initialFolderId = "all",
    folders = [],
    initialSelectedIds,
    multiple = true,
    title = translate("library.picker.title"),
    eyebrow = translate("library.picker.eyebrow"),
    confirmLabel = (count) => (count ? translate("library.picker.confirmWithCount", { count }) : translate("library.picker.confirm")),
    emptyTitle = translate("library.picker.emptyTitle"),
    emptyDescription = translate("library.picker.emptyDescription"),
    footerNote,
    loading = false,
    pagination,
    folderActionLabel = translate("library.picker.folderAction"),
    folderActionSource = "all",
    upload,
    onClose,
    onConfirm,
    onFolderAction,
}: Props) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [category, setCategory] = useState(initialCategory);
    const [mediaKind, setMediaKind] = useState<AssetPickerMediaKind | "all">("all");
    const [folderId, setFolderId] = useState(initialFolderId);
    const [source, setSource] = useState<"local" | "plugin">("local");
    const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [uploadedItems, setUploadedItems] = useState<AssetLibraryPickerItem[]>([]);
    const [working, setWorking] = useState(false);
    const [uploadingCount, setUploadingCount] = useState(0);
    const [error, setError] = useState("");
    const userId = useUserStore((state) => state.user?.id);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const [remotePage, setRemotePage] = useState(1);
    const [remotePageSize, setRemotePageSize] = useState(40);
    const [remoteKeyword, setRemoteKeyword] = useState("");
    const remoteEnabled = remoteLibrary && Boolean(userId) && source === "local";
    useEffect(() => {
        const timer = window.setTimeout(() => setRemoteKeyword(keyword.trim()), 250);
        return () => window.clearTimeout(timer);
    }, [keyword]);
    useEffect(() => setRemotePage(1), [category, mediaKind, remoteKeyword, open]);
    // remoteKind 是调用方写死的能力约束；媒体类型筛选只在没有该约束时参与服务端查询。
    const remoteQueryKind = remoteKind || (mediaKind === "all" ? undefined : mediaKind);
    const remoteQuery = useQuery({
        queryKey: ["asset-picker", userId, remotePage, remotePageSize, category, remoteKeyword, remoteQueryKind],
        queryFn: ({ signal }) =>
            loadAssetLibraryPage({
                page: remotePage,
                pageSize: remotePageSize,
                kind: remoteQueryKind,
                category: category === "all" || category === "archived" || category === remoteQueryKind ? undefined : category,
                status: category === "archived" ? "archived" : "active",
                query: remoteKeyword,
                signal,
            }),
        enabled: remoteEnabled && open && sessionHydrated,
        // 切分类/翻页时保留上一页，避免加载间隙退回本地数据源、左侧分类被重置（点"角色"闪一下又跳回全部）。
        placeholderData: keepPreviousData,
    });
    // 调用方的 items 只是本地缓存，不代表可插入集合（分页结果大多不在缓存里）。能接收 pickedItems 的
    // 调用方（acceptRemoteItems）允许直接选远端条目；其余调用方保持"不在 items 里就不可选"的旧约束。
    const remoteItems = useMemo<AssetLibraryPickerItem[]>(
        () =>
            (remoteQuery.data?.assets || [])
                .filter((asset) => asset.kind !== "model" && (asset.kind !== "entity" || (allowCharacters && asset.category === "character")))
                .map((asset) =>
                    remoteAssetToPickerItem(
                        asset,
                        items.find((item) => item.id === asset.id),
                        acceptRemoteItems,
                        remoteItemDisabledReason?.(asset),
                    ),
                ),
        [acceptRemoteItems, allowCharacters, remoteItemDisabledReason, remoteQuery.data, items],
    );
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const gridWrapRef = useRef<HTMLDivElement>(null);
    const pickedRemoteRef = useRef(new Map<string, AssetLibraryPickerItem>());
    const initialSelectedIdsRef = useRef(initialSelectedIds);
    const itemsRef = useRef(items);
    initialSelectedIdsRef.current = initialSelectedIds;
    const allItems = useMemo(() => {
        const known = new Set(items.map((item) => item.id));
        return [...items, ...uploadedItems.filter((item) => !known.has(item.id))];
    }, [items, uploadedItems]);
    itemsRef.current = allItems;
    const localItems = useMemo(() => allItems.filter((item) => !item.external), [allItems]);
    // 远端成功且有可展示素材时用远端。真正的空结果保持空列表。
    // 仅在远端空而本地仍有素材、或远端总数>0 但本页全被排除时回退本地，避免合法空搜索被缓存铺满。
    const remoteTotal = remoteQuery.data?.total ?? 0;
    const remoteReady = remoteEnabled && remoteQuery.isSuccess;
    const preferLocalUnsynced = remoteReady && remoteTotal === 0 && localItems.length > 0;
    const remoteEntityOnlyPage = remoteReady && remoteItems.length === 0 && remoteTotal > 0;
    const useRemoteItems = remoteReady && !preferLocalUnsynced && !remoteEntityOnlyPage && (remoteItems.length > 0 || remoteTotal === 0);
    const effectivePagination = useRemoteItems
        ? {
              current: remotePage,
              pageSize: remotePageSize,
              total: remoteTotal,
              onChange: (page: number, pageSize: number) => {
                  setRemotePage(page);
                  setRemotePageSize(pageSize);
              },
          }
        : pagination;
    const pluginItems = useMemo(() => allItems.filter((item) => Boolean(item.external)), [allItems]);
    const hasPluginSource = useMemo(() => Object.keys(categoryLabels).some((value) => value.startsWith("external:")) || pluginItems.some((item) => item.category.startsWith("external:")), [categoryLabels, pluginItems]);
    // 媒体类型在分类之前收窄数据源，让左侧分类计数、网格和分页始终描述同一批素材。
    const sourceItems = useMemo(() => {
        const base = source === "plugin" ? pluginItems : useRemoteItems ? remoteItems : localItems;
        if (mediaKind === "all") return base;
        return base.filter((item) => pickerItemMediaKind(item) === mediaKind);
    }, [localItems, mediaKind, pluginItems, useRemoteItems, remoteItems, source]);
    const activeSourceItems = useMemo(() => sourceItems.filter((item) => !item.archived), [sourceItems]);
    const archivedItems = useMemo(() => sourceItems.filter((item) => item.archived), [sourceItems]);
    const mediaKindOptions = useMemo(() => (remoteKind ? [] : Array.from(new Set(mediaKinds))), [mediaKinds, remoteKind]);
    const sourceFolders = source === "plugin" ? folders : [];
    const showCategories = source === "local" || !sourceFolders.length;
    const normalCategories = useMemo(
        () =>
            useRemoteItems
                ? Object.keys(categoryLabels).filter((value) => value !== "archived" && !value.startsWith("external:"))
                : ["all", ...Array.from(new Set(activeSourceItems.map((item) => item.category || "other"))).filter((value) => value !== "all")],
        [activeSourceItems, categoryLabels, useRemoteItems],
    );
    const archivedCount = archivedItems.length;
    const isRecycleBin = category === "archived";

    const visibleItems = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return sourceItems.filter((item) => {
            if (category === "archived") {
                if (!item.archived) return false;
            } else if (item.archived || (category !== "all" && item.category !== category)) {
                return false;
            }
            if (folderId !== "all" && (item.folderId || "") !== folderId) return false;
            return useRemoteItems || !query || [item.title, item.searchText || "", item.description || ""].join(" ").toLowerCase().includes(query);
        });
    }, [category, folderId, keyword, sourceItems, useRemoteItems]);
    const selectedIds = useMemo(
        () =>
            Array.from(selected).filter((id) => {
                const item = allItems.find((entry) => entry.id === id);
                return !item?.disabledReason;
            }),
        [allItems, selected],
    );
    const archivedSelectedIds = useMemo(() => selectedIds.filter((id) => allItems.find((item) => item.id === id)?.archived), [allItems, selectedIds]);

    useEffect(() => {
        if (!open) return;

        setFolderId(initialFolderId);
        setCategory(initialCategory);
        setMediaKind("all");
        setSource("local");
        setKeyword("");
        setUploadedItems([]);
        pickedRemoteRef.current.clear();
        const selectableIds = new Set(itemsRef.current.filter((item) => !item.disabledReason).map((item) => item.id));
        setSelected(new Set(Array.from(initialSelectedIdsRef.current || []).filter((id) => selectableIds.has(id))));
        setWorking(false);
        setUploadingCount(0);
        setError("");
    }, [initialCategory, initialFolderId, open]);

    useEffect(() => {
        if (category === "all" || category === "archived" || normalCategories.includes(category)) return;
        // 远端分页还在加载时分类列表是临时的，不能据此把用户刚点的分类改回"全部"。
        if (remoteEnabled && (remoteQuery.isFetching || !remoteQuery.isSuccess)) return;
        setCategory("all");
    }, [normalCategories, category, remoteEnabled, remoteQuery.isFetching, remoteQuery.isSuccess]);

    useEffect(() => {
        if (hasPluginSource || source === "local") return;
        setSource("local");
    }, [hasPluginSource, source]);

    useEffect(() => {
        if (mediaKind === "all" || mediaKindOptions.includes(mediaKind)) return;
        setMediaKind("all");
    }, [mediaKind, mediaKindOptions]);

    const selectSource = (nextSource: "local" | "plugin") => {
        if (nextSource === "plugin" && !hasPluginSource) return;
        setSource(nextSource);
        setCategory("all");
        setFolderId("all");
        setError("");
    };

    const toggle = (item: AssetLibraryPickerItem) => {
        if (item.disabledReason || working) return;
        // 远端分页条目翻页后就不在列表里了；选中时记下来，确认时仍能转成插入内容。
        if (item.asset && !allItems.some((known) => known.id === item.id)) pickedRemoteRef.current.set(item.id, item);
        setError("");
        setSelected((current) => {
            if (!multiple) return current.has(item.id) ? new Set() : new Set([item.id]);
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
        });
    };

    const confirm = async () => {
        if (!selectedIds.length || working) return;
        setWorking(true);
        setError("");
        try {
            const known = new Set(allItems.map((item) => item.id));
            await onConfirm(selectedIds, [...allItems, ...[...pickedRemoteRef.current.values()].filter((item) => !known.has(item.id))]);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("library.picker.actionFailed"));
        } finally {
            setWorking(false);
        }
    };

    const handleRestoreSelected = async () => {
        if (!archivedSelectedIds.length) return;
        setWorking(true);
        try {
            for (const id of archivedSelectedIds) {
                useAssetStore.getState().updateAsset(id, { status: "confirmed" });
            }
            await flushAssetStorePersistence();
            await saveRemoteUserDataNow([]);
            setSelected(new Set());
            message.success(t("library.picker.restored", { count: archivedSelectedIds.length }));
            setCategory("all");
        } catch (error) {
            message.warning(localSavedRemotePendingMessage(t("library.picker.restoredLocal"), error));
        } finally {
            setWorking(false);
            if (remoteEnabled) void remoteQuery.refetch();
        }
    };

    const handleDeleteSelected = async () => {
        if (!archivedSelectedIds.length) return;
        setWorking(true);
        try {
            await deleteAssetsWithRemoteSync(archivedSelectedIds);
            setSelected(new Set());
            message.success(t("library.picker.deleted", { count: archivedSelectedIds.length }));
        } catch (err) {
            message.error(err instanceof Error ? err.message : t("library.picker.deleteFailed"));
        } finally {
            setWorking(false);
        }
    };

    const handleEmptyRecycleBin = async () => {
        const toDelete = archivedItems;
        if (!toDelete.length) return;
        setWorking(true);
        try {
            await deleteAssetsWithRemoteSync(toDelete.map((item) => item.id));
            setSelected(new Set());
            message.success(remoteEnabled ? t("library.picker.deletedPage", { count: toDelete.length }) : t("library.picker.deletedRecycleBin", { count: toDelete.length }));
            setCategory("all");
        } catch (err) {
            message.error(err instanceof Error ? err.message : t("library.picker.emptyRecycleBinFailed"));
        } finally {
            setWorking(false);
        }
    };

    const handleUpload = async (files: FileList | null) => {
        if (!files?.length || working || (source === "local" && !upload) || (source === "plugin" && !upload?.external)) return;
        setWorking(true);
        setError("");
        setUploadingCount(files.length);
        try {
            if (source === "plugin") {
                const uploaded = await upload!.external!.onUpload(files, folderId === "all" ? undefined : folderId);
                setUploadedItems((current) => [...current, ...uploaded]);
                const ids = uploaded.map((item) => item.id);
                if (ids.length) setSelected((current) => new Set(multiple ? [...current, ...ids] : ids.slice(-1)));
            } else {
                const ids = await upload!.onUpload(files);
                if (ids.length) setSelected((current) => new Set(multiple ? [...current, ...ids] : ids.slice(-1)));
            }
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("library.picker.uploadFailed"));
        } finally {
            if (uploadInputRef.current) uploadInputRef.current.value = "";
            setWorking(false);
            setUploadingCount(0);
        }
    };

    const runFolderAction = async () => {
        if (!onFolderAction || folderId === "all" || working) return;
        setWorking(true);
        setError("");
        try {
            await onFolderAction(folderId);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("library.picker.folderActionFailed"));
        } finally {
            setWorking(false);
        }
    };

    // 远端模式下列表是分页的，按当前页数会把"角色 4"之类的数字算错；未叠加类型筛选时用服务端分类计数。
    const remoteCategoryCounts = useRemoteItems && mediaKind === "all" && !remoteKind ? remoteQuery.data?.categoryCounts : undefined;
    const countFor = (value: string) => {
        if (remoteCategoryCounts) return value === "all" ? Object.values(remoteCategoryCounts).reduce((sum, count) => sum + count, 0) : remoteCategoryCounts[value] || 0;
        return value === "all" ? activeSourceItems.length : activeSourceItems.filter((item) => item.category === value).length;
    };
    const sourceLabel = source === "plugin" ? t("library.picker.sourcePlugin") : t("library.picker.sourceLocal");
    const sourceMenuItems: MenuProps["items"] = [
        {
            key: "local",
            icon: <HardDrive aria-hidden="true" />,
            label: (
                <span className="asset-picker-source-menu-label">
                    <span>{t("library.picker.sourceLocal")}</span>
                    <em>{localItems.filter((item) => !item.archived).length}</em>
                </span>
            ),
        },
        ...(hasPluginSource
            ? [
                  {
                      key: "plugin",
                      icon: <Puzzle aria-hidden="true" />,
                      label: (
                          <span className="asset-picker-source-menu-label">
                              <span>{t("library.picker.sourcePlugin")}</span>
                              <em>{pluginItems.length}</em>
                          </span>
                      ),
                  },
              ]
            : []),
    ];
    const activeUpload = isRecycleBin ? undefined : source === "plugin" ? upload?.external : upload;
    const uploading = uploadingCount > 0;
    const refreshing = useRemoteItems && remoteQuery.isFetching;
    // 已选条目可能来自之前的分页或刚上传的素材，托盘按 ID 在所有已知来源里找回缩略图。
    const itemById = new Map<string, AssetLibraryPickerItem>();
    for (const item of [...pickedRemoteRef.current.values(), ...remoteItems, ...allItems]) itemById.set(item.id, item);
    const trayItems = selectedIds.map((id) => itemById.get(id)).filter((item): item is AssetLibraryPickerItem => Boolean(item));
    const totalCount = effectivePagination ? effectivePagination.total : visibleItems.length;
    const footerHint = remoteEnabled && remoteQuery.isError ? t("library.picker.remoteUnavailable") : footerNote;
    // 已按分类筛选时卡片上的分类都一样，只在混合列表里显示。
    const showCardCategory = category === "all" || isRecycleBin;
    const currentPage = effectivePagination?.current;
    useEffect(() => {
        gridWrapRef.current?.scrollTo({ top: 0 });
    }, [currentPage]);

    return (
        <AppModal
            centered
            open={open}
            footer={null}
            title={null}
            destroyOnHidden
            closable={!working}
            mask={{ closable: !working }}
            keyboard={!working}
            onCancel={() => {
                if (!working) onClose();
            }}
            className="workspace-modal workspace-modal-wide asset-library-picker-modal"
            flush
        >
            <div className="asset-picker-shell" data-canvas-no-zoom>
                <header className="asset-picker-toolbar">
                    <span className="asset-picker-heading-icon" aria-hidden="true">
                        {isRecycleBin ? <Trash2 /> : <FolderOpen />}
                    </span>
                    <div className="asset-picker-heading">
                        <div className="asset-picker-heading-copy">
                            <span>{eyebrow}</span>
                            <Dropdown
                                trigger={["click"]}
                                placement="bottomLeft"
                                rootClassName="asset-picker-source-dropdown"
                                onOpenChange={setSourceMenuOpen}
                                menu={{
                                    selectedKeys: [source],
                                    items: sourceMenuItems,
                                    onClick: ({ key }) => {
                                        if (key === "local" || key === "plugin") selectSource(key);
                                    },
                                }}
                            >
                                <button type="button" className="asset-picker-title-trigger" aria-haspopup="menu" aria-expanded={sourceMenuOpen} aria-label={t("library.picker.sourceLabel", { source: sourceLabel })}>
                                    <strong>{isRecycleBin ? t("library.picker.recycleBin") : title}</strong>
                                    <ChevronDown aria-hidden="true" />
                                </button>
                            </Dropdown>
                        </div>
                    </div>
                    <label className="asset-picker-search">
                        <Search aria-hidden />
                        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t("library.picker.searchPlaceholder")} aria-label={t("library.picker.search")} />
                    </label>
                </header>
                <div className="asset-picker-body">
                    <nav className="asset-picker-categories" aria-label={t("library.picker.categories")}>
                        {mediaKindOptions.length > 1 && !isRecycleBin ? (
                            <>
                                <span className="asset-picker-nav-label">{t("library.picker.mediaKind")}</span>
                                {(["all", ...mediaKindOptions] as const).map((value) => (
                                    <button key={value} type="button" className={cn("assets-filter-item", mediaKind === value && "is-active")} aria-pressed={mediaKind === value} onClick={() => setMediaKind(value)}>
                                        <span className="assets-filter-item-label">{value === "all" ? t("library.picker.allKinds") : ASSET_PICKER_MEDIA_KIND_LABELS[value]}</span>
                                    </button>
                                ))}
                            </>
                        ) : null}
                        {sourceFolders.length ? (
                            <>
                                <span className="asset-picker-nav-label">{t("library.picker.folders")}</span>
                                <button type="button" className={cn("assets-filter-item", folderId === "all" && "is-active")} aria-pressed={folderId === "all"} onClick={() => setFolderId("all")}>
                                    <span className="assets-filter-item-label">{t("library.picker.allFolders")}</span>
                                    <span className="assets-filter-count">{sourceItems.length}</span>
                                </button>
                                {renderPickerFolders(sourceFolders, activeSourceItems, folderId, setFolderId)}
                            </>
                        ) : null}
                        {showCategories ? (
                            <>
                                <span className="asset-picker-nav-label">{t("library.picker.category")}</span>
                                {normalCategories.map((value) => (
                                    <button key={value} type="button" className={cn("assets-filter-item", category === value && "is-active")} aria-pressed={category === value} onClick={() => setCategory(value)}>
                                        <span className="assets-filter-item-label">{categoryLabels[value] || (value === "all" ? t("library.picker.allAssets") : t("library.picker.other"))}</span>
                                        <span className="assets-filter-count">{countFor(value)}</span>
                                    </button>
                                ))}
                                {archivedCount > 0 || remoteEnabled ? (
                                    <div className="asset-picker-recycle">
                                        <button type="button" className={cn("assets-filter-item", category === "archived" && "is-active")} aria-pressed={category === "archived"} onClick={() => setCategory("archived")}>
                                            <span className="assets-filter-item-label flex items-center gap-2">
                                                <Trash2 className="size-3.5" />
                                                <span>{t("library.picker.recycleBin")}</span>
                                            </span>
                                            <span className="assets-filter-count">{archivedCount}</span>
                                        </button>
                                    </div>
                                ) : null}
                            </>
                        ) : null}
                    </nav>
                    <div className="asset-picker-main">
                        <div ref={gridWrapRef} className="asset-picker-grid-wrap" data-canvas-wheel-scroll>
                            {remoteEnabled && remoteQuery.isError && !localItems.length ? (
                                <div className="asset-picker-empty" role="alert">
                                    <FolderOpen />
                                    <strong>{t("library.picker.loadFailedTitle")}</strong>
                                    <span>{t("library.picker.loadFailedDescription")}</span>
                                    <Button onClick={() => void remoteQuery.refetch()}>{t("common.retry")}</Button>
                                </div>
                            ) : loading || (refreshing && !visibleItems.length) ? (
                                // 首次读取或切换后还没有可显示的条目：骨架卡片占位，不再整块换成转圈。
                                <div className="asset-picker-grid" aria-busy="true" aria-label={t("library.picker.loadingTitle")}>
                                    {Array.from({ length: PICKER_SKELETON_CARDS }, (_, index) => (
                                        <PickerCardSkeleton key={index} />
                                    ))}
                                </div>
                            ) : visibleItems.length ? (
                                // 翻页、切分类时保留上一屏并调暗，新数据到达后替换，不闪空白。
                                <div className="asset-picker-grid" data-refreshing={refreshing || undefined} aria-busy={refreshing || undefined}>
                                    {visibleItems.map((item) => (
                                        <PickerCard key={item.id} item={item} categoryLabel={showCardCategory ? categoryLabels[item.category] : undefined} selected={selected.has(item.id)} onToggle={() => toggle(item)} />
                                    ))}
                                </div>
                            ) : (
                                <div className="asset-picker-empty">
                                    <FolderOpen />
                                    <strong>{isRecycleBin ? t("library.picker.recycleBinEmpty") : emptyTitle}</strong>
                                    <span>{isRecycleBin ? t("library.picker.recycleBinDescription") : activeUpload ? t("library.picker.emptyUploadDescription") : emptyDescription}</span>
                                </div>
                            )}
                        </div>
                        {effectivePagination ? (
                            // 分页条固定在网格下方，长列表不用滚到底才能翻页。
                            <PaginationBar
                                alwaysShow
                                className="asset-picker-pagination"
                                current={effectivePagination.current}
                                pageSize={effectivePagination.pageSize}
                                total={effectivePagination.total}
                                itemLabel={t("library.picker.itemUnit")}
                                pageSizeOptions={[20, 40, 80]}
                                onChange={effectivePagination.onChange}
                            />
                        ) : null}
                    </div>
                </div>
                <footer className="asset-picker-footer">
                    {activeUpload ? (
                        <>
                            <input ref={uploadInputRef} type="file" hidden accept={activeUpload.accept} multiple={multiple} onChange={(event) => void handleUpload(event.target.files)} />
                            <button type="button" className="asset-picker-upload" onClick={() => uploadInputRef.current?.click()} disabled={working} aria-busy={uploading} title={uploading ? undefined : activeUpload.description}>
                                {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
                                <span>
                                    <strong>{uploading ? t("library.picker.uploading", { count: uploadingCount }) : t("library.picker.upload")}</strong>
                                    <small>{uploading ? t("library.picker.uploadingHint") : activeUpload.description}</small>
                                </span>
                            </button>
                        </>
                    ) : null}
                    <div className="asset-picker-tray" role="group" aria-label={t("library.picker.count", { selected: selectedIds.length, total: totalCount })}>
                        {trayItems.length ? (
                            trayItems.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className="asset-picker-tray-item"
                                    title={item.title}
                                    aria-label={item.title}
                                    disabled={working}
                                    onClick={() =>
                                        setSelected((current) => {
                                            const next = new Set(current);
                                            next.delete(item.id);
                                            return next;
                                        })
                                    }
                                >
                                    <PickerThumb item={item} />
                                    <span className="asset-picker-tray-remove" aria-hidden="true">
                                        <X />
                                    </span>
                                </button>
                            ))
                        ) : footerHint ? (
                            <span className="asset-picker-footer-note">{footerHint}</span>
                        ) : null}
                    </div>
                    <span className="asset-picker-count">{t("library.picker.count", { selected: selectedIds.length, total: totalCount })}</span>
                    {error ? (
                        <span className="asset-picker-footer-error" role="alert">
                            {error}
                        </span>
                    ) : null}
                    <div className="asset-picker-actions">
                        {isRecycleBin ? (
                            <>
                                <Popconfirm
                                    title={remoteEnabled ? t("library.picker.confirmDeletePage") : t("library.picker.confirmEmptyRecycleBin")}
                                    description={t("library.picker.deleteDescription")}
                                    onConfirm={handleEmptyRecycleBin}
                                    okText={t("common.delete")}
                                    okButtonProps={{ danger: true }}
                                    cancelText={t("common.cancel")}
                                >
                                    <Button type="text" danger disabled={working || !archivedCount}>
                                        {remoteEnabled ? t("library.picker.deletePage") : t("library.picker.emptyRecycleBin")}
                                    </Button>
                                </Popconfirm>
                                <Popconfirm title={t("library.picker.confirmDeleteSelected")} onConfirm={handleDeleteSelected} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                                    <Button type="text" danger disabled={working || !archivedSelectedIds.length}>
                                        {t("library.picker.deletePermanently")}
                                    </Button>
                                </Popconfirm>
                                <Button type="text" onClick={onClose} disabled={working}>
                                    {t("common.close")}
                                </Button>
                                <Button type="primary" icon={<RotateCcw className="size-3.5" />} disabled={working || !archivedSelectedIds.length} loading={working} onClick={handleRestoreSelected}>
                                    {archivedSelectedIds.length ? t("library.picker.restoreSelectedWithCount", { count: archivedSelectedIds.length }) : t("library.picker.restoreSelected")}
                                </Button>
                            </>
                        ) : (
                            <>
                                {onFolderAction && folderId !== "all" && (folderActionSource !== "local" || source === "local") ? (
                                    <Button type="text" icon={<FolderOpen />} disabled={working} onClick={() => void runFolderAction()}>
                                        {folderActionLabel}
                                    </Button>
                                ) : null}
                                <Button type="text" onClick={onClose} disabled={working}>
                                    {t("common.cancel")}
                                </Button>
                                <Button type="primary" icon={<Check />} disabled={working || !selectedIds.length} loading={working && !uploading} onClick={() => void confirm()}>
                                    {confirmLabel(selectedIds.length)}
                                </Button>
                            </>
                        )}
                    </div>
                </footer>
            </div>
        </AppModal>
    );
}

export function remoteAssetToPickerItem(asset: Asset, known: AssetLibraryPickerItem | undefined, acceptRemoteItems: boolean, disabledReason?: string): AssetLibraryPickerItem {
    return {
        id: asset.id,
        title: asset.title,
        category: asset.category || "other",
        archived: asset.status === "archived",
        kindLabel: translate(
            asset.kind === "image"
                ? "library.picker.kind.image"
                : asset.kind === "video"
                  ? "library.picker.kind.video"
                  : asset.kind === "audio"
                    ? "library.picker.kind.audio"
                    : asset.kind === "entity"
                      ? "library.picker.kind.character"
                      : "library.picker.kind.text",
        ),
        searchText: (asset.tags ?? []).join(" "),
        ...known,
        disabledReason: known?.disabledReason || (!known && !acceptRemoteItems ? translate("library.picker.notApplicable") : disabledReason),
        asset,
    };
}

// 角色卡、3D 模型等非媒体条目没有媒体类型，媒体筛选生效时不参与匹配。
export function pickerItemMediaKind(item: AssetLibraryPickerItem): AssetPickerMediaKind | undefined {
    if (item.mediaKind) return item.mediaKind;
    const kind = item.external?.item.kind || item.asset?.kind;
    return kind === "image" || kind === "video" || kind === "audio" || kind === "text" ? kind : undefined;
}

type PickerMediaState = "loading" | "loaded" | "error";

function PickerCard({ item, categoryLabel, selected, onToggle }: { item: AssetLibraryPickerItem; categoryLabel?: string; selected: boolean; onToggle: () => void }) {
    const { t } = useTranslation();
    const disabled = Boolean(item.disabledReason);
    const hasImage = Boolean(item.imageUrl || item.imageStorageKey);
    const drawnCover = item.asset?.kind === "entity" || (item.asset?.kind === "audio" && !hasImage);
    // 图片和视频首帧到达前显示扫光，到达后淡入；角色卡和波形是本地绘制的封面，不需要等待。
    // 没有可加载媒体时组件直接渲染占位图标，CSS 会按占位元素关闭扫光。
    const [mediaState, setMediaState] = useState<PickerMediaState>(drawnCover ? "loaded" : "loading");
    const markLoaded = () => setMediaState("loaded");
    const markFailed = () => setMediaState("error");
    const fallback = <span className="asset-picker-card-fallback">{kindIcon(item)}</span>;
    const meta = item.description || categoryLabel;
    return (
        <AssetLibraryCard selected={selected} className={cn("asset-picker-card", disabled && "is-disabled")}>
            <button type="button" className="asset-picker-card-action" onClick={onToggle} disabled={disabled} aria-pressed={selected} title={item.disabledReason || item.title}>
                <span className="asset-picker-card-media" data-state={mediaState}>
                    {item.asset?.kind === "entity" ? (
                        <CharacterAssetCover asset={item.asset} />
                    ) : item.asset?.kind === "audio" && !hasImage ? (
                        <AudioWaveArt seed={item.asset.id} />
                    ) : hasImage ? (
                        <CachedResourceImage
                            storageKey={item.imageStorageKey}
                            src={item.imageUrl}
                            alt={item.title}
                            loading="lazy"
                            decoding="async"
                            className={item.imageFit === "contain" ? "is-contain" : undefined}
                            fallback={fallback}
                            loadingFallback={null}
                            onLoad={markLoaded}
                            onError={markFailed}
                        />
                    ) : (
                        <AssetMediaPreview asset={item.asset} alt={item.title} fallback={fallback} loadingFallback={null} onLoad={markLoaded} onError={markFailed} />
                    )}
                    <span className="asset-picker-card-kind" aria-hidden="true">
                        {kindIcon(item)}
                        <span>{item.kindLabel}</span>
                    </span>
                    <span className="asset-picker-card-check" aria-hidden="true">
                        <Check strokeWidth={3} />
                    </span>
                    {item.disabledReason ? <span className="asset-picker-card-lock">{item.disabledReason}</span> : null}
                </span>
                <span className="asset-picker-card-copy">
                    <strong>{item.title || t("library.picker.untitled")}</strong>
                    {meta ? <span>{meta}</span> : null}
                </span>
            </button>
            {item.asset?.kind === "audio" && !disabled ? (
                // 与封面同尺寸的覆盖层：试听按钮落在封面左下角，又不嵌套在选择按钮里。
                <span className="asset-picker-card-overlay">
                    <AudioPlayButton asset={item.asset} className="pointer-events-auto absolute bottom-2 left-2 !size-8" />
                </span>
            ) : null}
        </AssetLibraryCard>
    );
}

function PickerCardSkeleton() {
    return (
        <div className="asset-picker-card is-skeleton" aria-hidden="true">
            <span className="asset-picker-card-media" data-state="loading" />
            <span className="asset-picker-card-copy">
                <span className="asset-picker-skeleton-line" />
                <span className="asset-picker-skeleton-line is-sm" />
            </span>
        </div>
    );
}

/** 底部已选托盘的小缩略图：只取静态封面，视频和音频没有封面时显示类型图标。 */
function PickerThumb({ item }: { item: AssetLibraryPickerItem }) {
    const asset = item.asset;
    const src = item.imageUrl || asset?.coverUrl || (asset?.kind === "image" ? asset.data.dataUrl : "") || "";
    const storageKey = item.imageStorageKey || (asset?.kind === "image" ? asset.data.storageKey : asset?.kind === "entity" ? asset.data.coverStorageKey : undefined);
    const fallback = <span className="asset-picker-tray-fallback">{kindIcon(item)}</span>;
    if (!src && !storageKey) return fallback;
    return <CachedResourceImage storageKey={storageKey} src={src} alt="" loading="lazy" decoding="async" draggable={false} fallback={fallback} loadingFallback={null} />;
}

function renderPickerFolders(folders: AssetLibraryPickerFolder[], items: AssetLibraryPickerItem[], selectedId: string, onSelect: (folderId: string) => void, parentId = "", depth = 0, visited: ReadonlySet<string> = new Set()): ReactNode {
    if (depth >= 8) return null;
    return folders
        .filter((folder) => (folder.parentId || "") === parentId && !visited.has(folder.id))
        .map((folder) => {
            const nextVisited = new Set(visited).add(folder.id);
            return (
                <span key={folder.id} className="contents">
                    <button
                        type="button"
                        className={cn("assets-filter-item", selectedId === folder.id && "is-active")}
                        aria-pressed={selectedId === folder.id}
                        onClick={() => onSelect(folder.id)}
                        style={{ paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-3))` }}
                    >
                        <span className="assets-filter-item-label" title={folder.name}>
                            {folder.name}
                        </span>
                        <span className="assets-filter-count">{items.filter((item) => item.folderId === folder.id).length}</span>
                    </button>
                    {renderPickerFolders(folders, items, selectedId, onSelect, folder.id, depth + 1, nextVisited)}
                </span>
            );
        });
}

// 优先按素材类型选图标；kindLabel 已随界面语言翻译，只为未带类型的调用方保留中文标签兜底。
function kindIcon(item: AssetLibraryPickerItem): ReactNode {
    const kind = item.asset?.kind || item.external?.item.kind || item.mediaKind;
    if (kind === "entity") return <UserRound />;
    if (kind === "video") return <Video />;
    if (kind === "audio") return <Music2 />;
    if (kind === "text") return <FileText />;
    if (kind) return <ImageIcon />;
    const label = item.kindLabel;
    if (label.includes("角色")) return <UserRound />;
    if (label.includes("视频")) return <Video />;
    if (label.includes("音频")) return <Music2 />;
    if (label.includes("文本")) return <FileText />;
    return <ImageIcon />;
}
