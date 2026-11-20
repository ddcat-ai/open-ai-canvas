import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input } from "antd";
import { ShieldCheck, Sparkles, UserRoundCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Select } from "@/components/ui/base/select";
import { AppModal } from "@/components/ui/product/app-modal";
import { Callout } from "@/components/ui/product/callout";
import { formatCredits } from "@/constant/credits";
import { arkGroupPrice, arkGroupQuotaLeft, arkGroupWritable, arkKindEnabled, arkLibraryProgressMap, arkLibrarySubmissionBlockerKey, arkReviewRequired } from "@/lib/ark-assets";
import { arkPortraitOverviewQueryKey, createArkPortraitAsset, createArkVirtualGroup, getArkPortraitOverview } from "@/services/api/ark-portraits";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { arkImageSizeProblem } from "@/services/ark-asset-upload";
import type { ImageAsset } from "@/stores/use-asset-store";

type CertifyKind = "real" | "virtual";

const NEW_GROUP = "__new__";
const ARK_IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const ARK_ASSETS_SETTINGS = "/settings?section=ark-assets";

/**
 * 素材库图片提交方舟认证：选认证类型与素材组（虚拟素材组可就地新建），提交后进入审核；
 * 通过后由服务端把这张图片移入「方舟认证」分类。真人素材组只能在设置页本人认证后创建。
 */
export function ArkCertifyModal({ asset, onClose }: { asset: ImageAsset | null; onClose: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [kind, setKind] = useState<CertifyKind>("real");
    const [groupId, setGroupId] = useState("");
    const [newName, setNewName] = useState("");
    const [working, setWorking] = useState(false);

    const overviewQuery = useQuery({ queryKey: arkPortraitOverviewQueryKey, queryFn: ({ signal }) => getArkPortraitOverview(signal), enabled: Boolean(asset) });
    const overview = overviewQuery.data;
    const config = overview?.config;
    const progress = useMemo(() => arkLibraryProgressMap(overview), [overview]);
    const kinds = (["real", "virtual"] as const).filter((item) => arkKindEnabled(config, item));
    const groups = (overview?.groups || []).filter((group) => group.kind === kind && arkGroupWritable(group));
    const canCreateVirtual = kind === "virtual" && arkGroupQuotaLeft(overview, "virtual") > 0;

    useEffect(() => {
        if (!asset) return;
        setNewName(asset.title);
        setGroupId("");
    }, [asset?.id]);

    useEffect(() => {
        if (kinds.length && !kinds.includes(kind)) setKind(kinds[0]);
    }, [kinds.join(","), kind]);

    useEffect(() => {
        if (groupId && (groupId === NEW_GROUP ? canCreateVirtual : groups.some((group) => group.id === groupId))) return;
        setGroupId(groups[0]?.id || (canCreateVirtual ? NEW_GROUP : ""));
        // 只在可选素材组变化时重选默认项。
    }, [kind, groups.map((group) => group.id).join(","), canCreateVirtual]);

    if (!asset) return null;

    const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
    const blockerKey = arkLibrarySubmissionBlockerKey(progress.get(asset.id), resourceId);
    const sizeProblem = asset.data.bytes > ARK_IMAGE_MAX_BYTES ? t("library.ark.upload.tooLarge", { name: asset.title }) : asset.data.width > 0 && asset.data.height > 0 ? arkImageSizeProblem(asset.title, asset.data.width, asset.data.height) : "";
    const blocked = !overview?.enabled ? t("library.ark.certify.unavailable") : !resourceId ? t("library.ark.certify.notCloud") : asset.arkCertification ? t("library.ark.upload.alreadyCertified") : blockerKey ? t(blockerKey) : sizeProblem;
    const creatingGroup = groupId === NEW_GROUP;
    const ready = !blocked && kinds.length > 0 && Boolean(groupId) && (!creatingGroup || Boolean(newName.trim()));
    const virtualPrice = arkGroupPrice(config, "virtual");

    const submit = async () => {
        if (!ready) return;
        setWorking(true);
        try {
            let targetId = groupId;
            if (creatingGroup) {
                const created = await createArkVirtualGroup({ name: newName.trim() });
                targetId = created.group.id;
            }
            await createArkPortraitAsset(targetId, { resourceId, name: asset.title, libraryAssetId: asset.id });
            message.success(t("library.ark.certify.submitted"));
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.ark.actionFailed"));
        } finally {
            setWorking(false);
            void queryClient.invalidateQueries({ queryKey: arkPortraitOverviewQueryKey });
        }
    };

    const manage = () => {
        onClose();
        navigate(ARK_ASSETS_SETTINGS);
    };

    return (
        <AppModal
            open
            centered
            width={520}
            title={t("library.ark.certify.title")}
            onCancel={() => {
                if (!working) onClose();
            }}
            closable={!working}
            maskClosable={!working}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button type="link" className="px-0" onClick={manage}>
                        {t("library.ark.certify.manage")}
                    </Button>
                    <div className="flex gap-2">
                        <Button disabled={working} onClick={onClose}>
                            {t("common.cancel")}
                        </Button>
                        <Button type="primary" icon={<ShieldCheck className="size-4" />} loading={working} disabled={!ready} onClick={() => void submit()}>
                            {t("library.ark.certify.submit")}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="flex flex-col gap-4 py-1">
                <p className="m-0 text-[var(--fs-caption)] leading-relaxed text-muted-foreground">{t("library.ark.certify.description")}</p>
                {overviewQuery.isLoading ? <p className="m-0 text-[var(--fs-caption)] text-muted-foreground">{t("library.ark.loading")}</p> : null}
                {overviewQuery.isError ? <Callout tone="error">{overviewQuery.error instanceof Error ? overviewQuery.error.message : t("library.ark.loadFailed")}</Callout> : null}
                {overview && blocked ? <Callout tone="warning">{blocked}</Callout> : null}
                {overview && !blocked ? (
                    <>
                        <div className="flex flex-col gap-2">
                            <span className="text-[var(--fs-caption)] font-medium">{t("library.ark.certify.kindLabel")}</span>
                            <SegmentedControl<CertifyKind>
                                block
                                ariaLabel={t("library.ark.certify.kindLabel")}
                                value={kind}
                                onChange={setKind}
                                options={[
                                    { value: "real", label: t("library.ark.kinds.real"), icon: <UserRoundCheck className="size-4" />, disabled: !kinds.includes("real") },
                                    { value: "virtual", label: t("library.ark.kinds.virtual"), icon: <Sparkles className="size-4" />, disabled: !kinds.includes("virtual") },
                                ]}
                            />
                            <span className="text-[var(--fs-label)] leading-relaxed text-muted-foreground">{t(`library.ark.kindHints.${kind}`)}</span>
                        </div>
                        {kind === "real" && !groups.length ? (
                            <Callout
                                tone="info"
                                action={
                                    <Button size="small" onClick={manage}>
                                        {t("library.ark.certify.createReal")}
                                    </Button>
                                }
                            >
                                {t("library.ark.certify.noRealGroup")}
                            </Callout>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <span className="text-[var(--fs-caption)] font-medium">{t("library.ark.certify.groupLabel")}</span>
                                <Select
                                    ariaLabel={t("library.ark.certify.groupLabel")}
                                    value={groupId || undefined}
                                    placeholder={t("library.ark.certify.groupPlaceholder")}
                                    onChange={(value) => setGroupId(String(value))}
                                    options={[...groups.map((group) => ({ value: group.id, label: group.name })), ...(canCreateVirtual ? [{ value: NEW_GROUP, label: t("library.ark.certify.newVirtual") }] : [])]}
                                />
                            </div>
                        )}
                        {creatingGroup ? (
                            <label className="flex flex-col gap-2">
                                <span className="text-[var(--fs-caption)] font-medium">{t("library.ark.certify.newVirtualName")}</span>
                                <Input value={newName} maxLength={40} placeholder={t("library.ark.virtualFlow.namePlaceholder")} onChange={(event) => setNewName(event.target.value)} />
                                <span className="text-[var(--fs-label)] text-muted-foreground">{virtualPrice > 0 ? t("library.ark.virtualFlow.fee", { price: formatCredits(virtualPrice) }) : t("library.ark.virtualFlow.free")}</span>
                            </label>
                        ) : null}
                        {groupId && arkReviewRequired(config, kind) ? <p className="m-0 text-[var(--fs-label)] text-muted-foreground">{t("library.ark.group.reviewNotice")}</p> : null}
                    </>
                ) : null}
            </div>
        </AppModal>
    );
}
