import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Input } from "antd";
import { Check, Copy, FolderOpen, ImagePlus, LibraryBig, PencilLine, RefreshCw, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { StatusBadge } from "@/components/ui/base/badges";
import { IconButton } from "@/components/ui/base/buttons";
import { DeleteButton } from "@/components/ui/base/buttons/delete-button";
import { Callout } from "@/components/ui/product/callout";
import { refreshArkLibraryAssets } from "@/hooks/use-ark-library-reconcile";
import { useCopyText } from "@/hooks/use-copy-text";
import { currentLocale } from "@/i18n";
import { arkAssetStatusTone, arkGroupWritable, arkLibrarySubmissionBlockerKey, arkReviewRequired, formatArkDate, type ArkLibraryProgress } from "@/lib/ark-assets";
import { ARK_ASSET_CATEGORY, ASSET_CATEGORY_LABELS, normalizeAssetCategory } from "@/lib/asset-category";
import { cn } from "@/lib/utils";
import {
    addArkPortraitAssetToLibrary,
    arkPortraitAssetFileUrl,
    createArkPortraitAsset,
    deleteArkGroup,
    deleteArkPortraitAsset,
    refreshArkPortraitAsset,
    updateArkGroup,
    type ArkAssetConfig,
    type ArkPortraitAsset,
    type ArkPortraitGroup,
} from "@/services/api/ark-portraits";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { ARK_IMAGE_ACCEPT, arkImageSizeProblem, uploadArkGroupImages } from "@/services/ark-asset-upload";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

const ARK_IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const PICKER_CATEGORY_LABELS: Record<string, string> = { all: "全部素材", ...ASSET_CATEGORY_LABELS };

type Props = {
    group: ArkPortraitGroup;
    config: ArkAssetConfig;
    /** 素材库素材 ID → 最近一次认证提交，用于在选择器里排除正在认证的图片。 */
    progress: ReadonlyMap<string, ArkLibraryProgress>;
    onChanged: () => Promise<unknown> | void;
    onDeleted: () => void;
};

/** 素材组详情：名称、方舟素材组 ID、授权期限，以及组内素材的上传、审核状态与素材库衔接。 */
export function ArkGroupDetail({ group, config, progress, onChanged, onDeleted }: Props) {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const copyText = useCopyText();
    const fileInput = useRef<HTMLInputElement>(null);
    const [editing, setEditing] = useState(false);
    const [draftName, setDraftName] = useState(group.name);
    const [working, setWorking] = useState("");
    const [pickerOpen, setPickerOpen] = useState(false);
    const libraryAssets = useAssetStore((state) => state.assets);
    const locale = currentLocale();
    const writable = arkGroupWritable(group);
    const reviewRequired = arkReviewRequired(config, group.kind);

    const run = async (key: string, action: () => Promise<void>) => {
        setWorking(key);
        try {
            await action();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.ark.actionFailed"));
        } finally {
            setWorking("");
        }
    };

    // 认证结果由服务端写入素材库：刷新本机已缓存的条目，并让素材库列表重新读取。
    const syncLibrary = async (ids: Array<string | undefined>) => {
        await refreshArkLibraryAssets(ids.filter((id): id is string => Boolean(id)));
        void queryClient.invalidateQueries({ queryKey: ["asset-library"] });
        void queryClient.invalidateQueries({ queryKey: ["asset-picker"] });
    };

    const saveName = () =>
        run("rename", async () => {
            const name = draftName.trim();
            if (!name || name === group.name) {
                setDraftName(group.name);
                setEditing(false);
                return;
            }
            await updateArkGroup(group.id, { name, description: group.description });
            message.success(t("library.ark.group.renamed"));
            setEditing(false);
            await onChanged();
        });

    const uploadFiles = (files: File[]) =>
        run("upload", async () => {
            if (!files.length) return;
            try {
                const submitted = await uploadArkGroupImages(files, (input) => createArkPortraitAsset(group.id, input));
                message.success(t(reviewRequired ? "library.ark.upload.submitted" : "library.ark.upload.submittedToArk", { count: submitted.length }));
            } finally {
                // 中途失败时已提交的图片保留在组内，仍需刷新列表。
                await onChanged();
            }
        });

    const pickReason = (asset: Asset) => {
        if (asset.kind !== "image") return t("library.ark.upload.notImage", { name: asset.title });
        if (asset.category === ARK_ASSET_CATEGORY || asset.arkCertification) return t("library.ark.upload.alreadyCertified");
        const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
        const blocker = arkLibrarySubmissionBlockerKey(progress.get(asset.id), resourceId);
        if (blocker) return t(blocker);
        if (!resourceId) return t("library.ark.upload.notCloud");
        if (asset.data.bytes > ARK_IMAGE_MAX_BYTES) return t("library.ark.upload.tooLarge", { name: asset.title });
        if (asset.data.width > 0 && asset.data.height > 0) return arkImageSizeProblem(asset.title, asset.data.width, asset.data.height) || undefined;
        return undefined;
    };

    const pickerItems = useMemo<AssetLibraryPickerItem[]>(
        () =>
            libraryAssets
                .filter((asset) => asset.kind === "image")
                .map((asset) => ({
                    id: asset.id,
                    title: asset.title,
                    category: normalizeAssetCategory(asset.category),
                    archived: asset.status === "archived",
                    kindLabel: t("library.picker.kind.image"),
                    mediaKind: "image" as const,
                    asset,
                    searchText: (asset.tags || []).join(" "),
                    disabledReason: pickReason(asset),
                })),
        // pickReason 只依赖 progress 与文案。
        [libraryAssets, progress, t],
    );

    const submitPicked = async (ids: string[], pickedItems?: AssetLibraryPickerItem[]) => {
        const pool = new Map([...pickerItems, ...(pickedItems || [])].map((item) => [item.id, item]));
        const chosen = ids.map((id) => pool.get(id)).filter((item): item is AssetLibraryPickerItem => Boolean(item?.asset));
        if (!chosen.length) throw new Error(t("library.ark.upload.pickTitle"));
        let submitted = 0;
        try {
            for (const item of chosen) {
                const asset = item.asset!;
                const reason = pickReason(asset);
                if (reason) throw new Error(`${item.title}：${reason}`);
                if (asset.kind !== "image") continue;
                await createArkPortraitAsset(group.id, { resourceId: resourceIdFromStorageKey(asset.data.storageKey), name: item.title, libraryAssetId: asset.id });
                submitted += 1;
            }
        } finally {
            if (submitted) await onChanged();
        }
        message.success(t(reviewRequired ? "library.ark.upload.submitted" : "library.ark.upload.submittedToArk", { count: submitted }));
        setPickerOpen(false);
    };

    const confirmDeleteGroup = () =>
        modal.confirm({
            className: "workspace-modal workspace-modal-compact",
            title: t("library.ark.group.deleteTitle"),
            content: t("library.ark.group.deleteContent"),
            okText: t("library.ark.group.delete"),
            okButtonProps: { danger: true },
            cancelText: t("common.cancel"),
            centered: true,
            onOk: async () => {
                try {
                    await deleteArkGroup(group.id);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("library.ark.actionFailed"));
                    throw error;
                }
                message.success(t("library.ark.group.deleted"));
                await syncLibrary(group.assets.map((asset) => asset.libraryAssetId));
                onDeleted();
                await onChanged();
            },
        });

    const expiryText =
        group.kind !== "real"
            ? ""
            : !group.expiresAt
              ? t("library.ark.expiry.none")
              : group.expiryStatus === "expired"
                ? t("library.ark.expiry.expiredOn", { date: formatArkDate(group.expiresAt, locale) })
                : t("library.ark.expiry.until", { date: formatArkDate(group.expiresAt, locale) });

    return (
        <article className="ark-detail" aria-labelledby={`ark-group-${group.id}`}>
            <header className="ark-detail-head">
                <div className="ark-detail-title">
                    {editing ? (
                        <div className="ark-detail-rename">
                            <Input
                                autoFocus
                                size="small"
                                value={draftName}
                                maxLength={40}
                                aria-label={t("library.ark.group.rename")}
                                onChange={(event) => setDraftName(event.target.value)}
                                onPressEnter={() => void saveName()}
                                onKeyDown={(event) => {
                                    if (event.key !== "Escape") return;
                                    event.stopPropagation();
                                    setDraftName(group.name);
                                    setEditing(false);
                                }}
                            />
                            <IconButton size="sm" icon={Check} loading={working === "rename"} aria-label={t("common.save")} onClick={() => void saveName()} />
                            <IconButton
                                size="sm"
                                icon={X}
                                aria-label={t("common.cancel")}
                                onClick={() => {
                                    setDraftName(group.name);
                                    setEditing(false);
                                }}
                            />
                        </div>
                    ) : (
                        <div className="ark-detail-name">
                            <h3 id={`ark-group-${group.id}`} title={group.name}>
                                {group.name}
                            </h3>
                            {group.owned ? <IconButton size="sm" icon={PencilLine} aria-label={t("library.ark.group.rename")} onClick={() => setEditing(true)} /> : null}
                        </div>
                    )}
                    <div className="ark-detail-tags">
                        <span className="ark-pane-tag">{t(`library.ark.kinds.${group.kind}`)}</span>
                        {group.source ? <span className="ark-pane-tag">{t(`library.ark.group.source.${group.source}`, { defaultValue: group.source })}</span> : null}
                        {!group.owned ? <span className="ark-pane-tag is-accent">{t("library.ark.group.platform")}</span> : null}
                        {expiryText ? <span className={cn("ark-pane-tag", group.expiryStatus === "expired" && "is-danger", group.expiryStatus === "expiring" && "is-warning")}>{expiryText}</span> : null}
                    </div>
                </div>
                {group.owned ? (
                    <Button danger icon={<Trash2 className="size-4" />} onClick={confirmDeleteGroup}>
                        {t("library.ark.group.delete")}
                    </Button>
                ) : null}
            </header>

            <dl className="ark-detail-meta">
                <div>
                    <dt>{t("library.ark.detail.group")}</dt>
                    <dd>
                        <code title={group.groupId}>{group.groupId}</code>
                        <IconButton size="xs" icon={Copy} aria-label={t("library.ark.group.copyId")} onClick={() => copyText(group.groupId)} />
                    </dd>
                </div>
                {group.description ? (
                    <div>
                        <dt>{t("library.ark.virtualFlow.descriptionLabel")}</dt>
                        <dd>{group.description}</dd>
                    </div>
                ) : null}
            </dl>

            {!group.available ? <Callout tone="warning">{t("library.ark.group.unavailable")}</Callout> : null}
            {group.available && group.expiryStatus === "expired" ? <Callout tone="error">{t("library.ark.group.expired")}</Callout> : null}
            {!group.owned ? <Callout tone="info">{t("library.ark.group.readonly")}</Callout> : null}

            {writable ? (
                <section className="ark-detail-upload" aria-label={t("library.ark.group.upload")}>
                    <div className="ark-detail-upload-copy">
                        <strong>{group.kind === "real" ? t("library.ark.group.uploadTipReal") : t("library.ark.group.uploadTipVirtual")}</strong>
                        <span>{t("library.ark.group.requirements")}</span>
                        {reviewRequired ? <span>{t("library.ark.group.reviewNotice")}</span> : null}
                    </div>
                    <div className="ark-detail-upload-actions">
                        <Button type="primary" icon={<ImagePlus className="size-4" />} loading={working === "upload"} onClick={() => fileInput.current?.click()}>
                            {t("library.ark.group.upload")}
                        </Button>
                        <Button icon={<FolderOpen className="size-4" />} disabled={working === "upload"} onClick={() => setPickerOpen(true)}>
                            {t("library.ark.group.fromLibrary")}
                        </Button>
                    </div>
                    <input
                        ref={fileInput}
                        hidden
                        multiple
                        type="file"
                        accept={ARK_IMAGE_ACCEPT}
                        onChange={(event) => {
                            const files = Array.from(event.target.files || []);
                            event.target.value = "";
                            void uploadFiles(files);
                        }}
                    />
                </section>
            ) : null}

            {group.assets.length ? (
                <ul className="ark-tiles" aria-label={t("library.ark.group.assetCount", { count: group.assets.length })}>
                    {group.assets.map((asset) => (
                        <ArkAssetTile key={asset.id} asset={asset} group={group} working={working} run={run} onChanged={onChanged} syncLibrary={syncLibrary} />
                    ))}
                </ul>
            ) : (
                <p className="ark-detail-empty">{t("library.ark.group.emptyAssets")}</p>
            )}

            {pickerOpen ? (
                <AssetLibraryPickerModal
                    open
                    remoteLibrary
                    acceptRemoteItems
                    remoteKind="image"
                    mediaKinds={["image"]}
                    remoteItemDisabledReason={pickReason}
                    items={pickerItems}
                    categoryLabels={PICKER_CATEGORY_LABELS}
                    title={t("library.ark.upload.pickTitle")}
                    eyebrow={group.name}
                    confirmLabel={(count) => (count ? t("library.ark.upload.pickConfirm", { count }) : t("library.ark.upload.pickConfirmEmpty"))}
                    footerNote={t("library.ark.group.requirements")}
                    onClose={() => setPickerOpen(false)}
                    onConfirm={submitPicked}
                />
            ) : null}
        </article>
    );
}

function ArkAssetTile({
    asset,
    group,
    working,
    run,
    onChanged,
    syncLibrary,
}: {
    asset: ArkPortraitAsset;
    group: ArkPortraitGroup;
    working: string;
    run: (key: string, action: () => Promise<void>) => Promise<void>;
    onChanged: () => Promise<unknown> | void;
    syncLibrary: (ids: Array<string | undefined>) => Promise<void>;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [broken, setBroken] = useState(false);
    const status = asset.status;
    const reason = asset.error ? (status === "rejected" ? t("library.ark.asset.rejectedReason", { reason: asset.error }) : t("library.ark.detail.reason", { reason: asset.error })) : "";

    const refresh = () =>
        run(`refresh:${asset.id}`, async () => {
            const result = await refreshArkPortraitAsset(asset.id);
            if (result.asset.status === "active") await syncLibrary([result.asset.libraryAssetId]);
            await onChanged();
        });

    const addToLibrary = () =>
        run(`library:${asset.id}`, async () => {
            const result = await addArkPortraitAssetToLibrary(asset.id);
            message.success(t("library.ark.asset.addedToLibrary"));
            await syncLibrary([result.assetId]);
            await onChanged();
        });

    const remove = async () => {
        await deleteArkPortraitAsset(asset.id);
        message.success(t("library.ark.asset.deleted"));
        await syncLibrary([asset.libraryAssetId]);
        await onChanged();
    };

    return (
        <li className={cn("ark-tile", `is-${status}`)}>
            <div className="ark-tile-media">
                {broken ? <span className="ark-tile-missing">{t("library.ark.asset.fileDeleted")}</span> : <img src={arkPortraitAssetFileUrl(asset.id)} alt={asset.name} loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />}
                <StatusBadge className="ark-tile-status" size="sm" variant="filled" tone={arkAssetStatusTone(status)} label={t(`library.ark.asset.status.${status}`, { defaultValue: status })} />
            </div>
            <div className="ark-tile-body">
                <span className="ark-tile-name" title={asset.name}>
                    {asset.name}
                </span>
                {asset.arkAssetId ? (
                    <button type="button" className="ark-tile-id" title={t("library.ark.detail.arkAssetId")} onClick={() => copyText(asset.arkAssetId)}>
                        {asset.arkAssetId}
                    </button>
                ) : null}
                {reason ? <span className="ark-tile-reason">{reason}</span> : null}
            </div>
            <div className="ark-tile-actions">
                {status === "processing" && group.owned ? (
                    <IconButton size="sm" icon={RefreshCw} loading={working === `refresh:${asset.id}`} aria-label={t("library.ark.asset.refresh")} title={t("library.ark.asset.refresh")} onClick={() => void refresh()} />
                ) : null}
                {status === "active" ? (
                    asset.inLibrary ? (
                        <span className="ark-tile-library">
                            <LibraryBig aria-hidden />
                            {t("library.ark.asset.inLibrary")}
                        </span>
                    ) : (
                        <Button size="small" icon={<LibraryBig className="size-3.5" />} loading={working === `library:${asset.id}`} disabled={!group.available || group.expiryStatus === "expired"} onClick={() => void addToLibrary()}>
                            {t("library.ark.asset.addToLibrary")}
                        </Button>
                    )
                ) : null}
                {group.owned ? <DeleteButton label={t("library.ark.asset.deleteLabel", { name: asset.name })} description={t("library.ark.asset.deleteContent")} onConfirm={remove} /> : null}
            </div>
        </li>
    );
}
