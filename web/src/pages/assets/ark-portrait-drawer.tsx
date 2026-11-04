import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Tag, Typography } from "antd";
import { CheckCircle2, ExternalLink, ImagePlus, Link2, PencilLine, RefreshCw, ShieldCheck, Trash2, UserRoundPlus } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { PaymentCheckoutCode } from "@/components/payment-checkout-code";
import { currentLocale } from "@/i18n";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { saveRemoteUserDataNow } from "@/services/user-data-sync";
import {
    arkPortraitOverviewQueryKey,
    bindArkPortraitGroup,
    checkArkPortraitSession,
    createArkPortraitAsset,
    createArkPortraitSession,
    deleteArkPortraitAsset,
    deleteArkPortraitGroup,
    getArkPortraitOverview,
    refreshArkPortraitAsset,
    renameArkPortraitGroup,
    type ArkPortraitAsset,
    type ArkPortraitGroup,
    type ArkPortraitSession,
} from "@/services/api/ark-portraits";
import { resourceFileUrl, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { flushAssetStorePersistence, useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";

import "./ark-portrait-drawer.css";

const ASSET_STATUS: Record<string, { labelKey: string; color: string }> = {
    processing: { labelKey: "library.portrait.status.processing", color: "processing" },
    active: { labelKey: "library.portrait.status.active", color: "success" },
    failed: { labelKey: "library.portrait.status.failed", color: "error" },
};

/** 方舟真人素材库：发起 H5 真人认证、管理每位真人的素材组，并把通过的素材加入素材库供工作台引用。 */
export function ArkPortraitDrawer({ open, onClose, onLibraryChanged }: { open: boolean; onClose: () => void; onLibraryChanged: () => Promise<void> | void }) {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const isAdmin = useUserStore((state) => state.user?.role === "admin");
    const [personName, setPersonName] = useState("");
    const [activeSession, setActiveSession] = useState<ArkPortraitSession | null>(null);
    const [working, setWorking] = useState("");
    const [bindName, setBindName] = useState("");
    const [bindGroupId, setBindGroupId] = useState("");

    const overviewQuery = useQuery({
        queryKey: arkPortraitOverviewQueryKey,
        queryFn: ({ signal }) => getArkPortraitOverview(signal),
        enabled: open,
        // 有审核中的素材时定时刷新状态，其余时间只在操作后刷新。
        refetchInterval: (query) => (query.state.data?.groups.some((group) => group.assets.some((asset) => asset.status === "processing")) ? 6_000 : false),
    });
    const overview = overviewQuery.data;
    const refresh = () => queryClient.invalidateQueries({ queryKey: arkPortraitOverviewQueryKey });

    const run = async (key: string, action: () => Promise<void>) => {
        setWorking(key);
        try {
            await action();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.portrait.actionFailed"));
        } finally {
            setWorking("");
        }
    };

    const startSession = () =>
        run("session", async () => {
            const name = personName.trim();
            if (!name) throw new Error(t("library.portrait.nameRequired"));
            const result = await createArkPortraitSession({ name, lang: document.documentElement.lang || navigator.language });
            setActiveSession(result.session);
            setPersonName("");
            await refresh();
        });

    const checkSession = (session: ArkPortraitSession) =>
        run(`check:${session.id}`, async () => {
            const result = await checkArkPortraitSession(session.id);
            if (result.session.status === "verified") {
                message.success(t("library.portrait.verified", { name: result.session.name }));
                if (activeSession?.id === session.id) setActiveSession(null);
            } else if (result.session.status === "failed" || result.session.status === "expired") {
                message.warning(result.session.error || t("library.portrait.verifyFailed"));
                if (activeSession?.id === session.id) setActiveSession(null);
            }
            await refresh();
        });

    const bindGroup = () =>
        run("bind", async () => {
            await bindArkPortraitGroup({ name: bindName.trim(), groupId: bindGroupId.trim() });
            setBindName("");
            setBindGroupId("");
            message.success(t("library.portrait.bound"));
            await refresh();
        });

    const pendingSessions = (overview?.sessions || []).filter((session) => session.id !== activeSession?.id);

    return (
        <AppDrawer title={t("library.portrait.title")} width="min(720px, calc(100vw - 24px))" open={open} onClose={onClose} rootClassName="ark-portrait-drawer">
            {overviewQuery.isLoading ? (
                <Typography.Text type="secondary">{t("library.portrait.loading")}</Typography.Text>
            ) : !overview?.enabled ? (
                <div className="ark-portrait-empty" role="status">
                    <ShieldCheck aria-hidden />
                    <strong>{t("library.portrait.disabledTitle")}</strong>
                    <span>{t("library.portrait.disabledDescription")}</span>
                </div>
            ) : (
                <div className="ark-portrait-stack">
                    <p className="ark-portrait-note">{t("library.portrait.note")}</p>

                    <section className="ark-portrait-section" aria-labelledby="ark-portrait-new">
                        <h3 id="ark-portrait-new">{t("library.portrait.addPerson")}</h3>
                        <div className="ark-portrait-row">
                            <Input value={personName} maxLength={40} placeholder={t("library.portrait.namePlaceholder")} onChange={(event) => setPersonName(event.target.value)} onPressEnter={() => void startSession()} />
                            <Button type="primary" icon={<UserRoundPlus />} loading={working === "session"} disabled={!personName.trim()} onClick={() => void startSession()}>
                                {t("library.portrait.startVerify")}
                            </Button>
                        </div>
                        {activeSession?.h5Link ? <ActiveSessionPanel session={activeSession} checking={working === `check:${activeSession.id}`} onCheck={() => void checkSession(activeSession)} /> : null}
                        {pendingSessions.length ? (
                            <ul className="ark-portrait-pending">
                                {pendingSessions.map((session) => (
                                    <li key={session.id}>
                                        <span>{t("library.portrait.pendingSession", { name: session.name, time: new Date(session.expiresAt).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" }) })}</span>
                                        <Button size="small" loading={working === `check:${session.id}`} onClick={() => void checkSession(session)}>
                                            {t("library.portrait.completed")}
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </section>

                    {isAdmin ? (
                        <section className="ark-portrait-section" aria-labelledby="ark-portrait-bind">
                            <h3 id="ark-portrait-bind">{t("library.portrait.bindTitle")}</h3>
                            <p className="ark-portrait-hint">{t("library.portrait.bindHint")}</p>
                            <div className="ark-portrait-row">
                                <Input value={bindName} maxLength={40} placeholder={t("library.portrait.name")} onChange={(event) => setBindName(event.target.value)} />
                                <Input value={bindGroupId} placeholder="group-…" onChange={(event) => setBindGroupId(event.target.value)} />
                                <Button icon={<Link2 />} loading={working === "bind"} disabled={!bindName.trim() || !bindGroupId.trim()} onClick={() => void bindGroup()}>
                                    {t("library.portrait.bind")}
                                </Button>
                            </div>
                        </section>
                    ) : null}

                    <section className="ark-portrait-section" aria-labelledby="ark-portrait-groups">
                        <div className="ark-portrait-section-head">
                            <h3 id="ark-portrait-groups">{t("library.portrait.groups", { count: overview.groups.length })}</h3>
                            <Button type="text" size="small" icon={<RefreshCw />} loading={overviewQuery.isFetching} onClick={() => void refresh()}>
                                {t("common.refresh")}
                            </Button>
                        </div>
                        {overview.groups.length ? (
                            overview.groups.map((group) => (
                                <PortraitGroupCard
                                    key={group.id}
                                    group={group}
                                    working={working}
                                    run={run}
                                    onChanged={refresh}
                                    onLibraryChanged={onLibraryChanged}
                                    confirmDelete={(title, content, onOk) => modal.confirm({ title, content, okText: t("common.delete"), okButtonProps: { danger: true }, cancelText: t("common.cancel"), onOk })}
                                />
                            ))
                        ) : (
                            <p className="ark-portrait-hint">{t("library.portrait.noGroups")}</p>
                        )}
                    </section>
                </div>
            )}
        </AppDrawer>
    );
}

function ActiveSessionPanel({ session, checking, onCheck }: { session: ArkPortraitSession; checking: boolean; onCheck: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="ark-portrait-session" aria-live="polite">
            <PaymentCheckoutCode value={session.h5Link || ""} />
            <div className="ark-portrait-session-copy">
                <strong>{t("library.portrait.sessionTitle", { name: session.name })}</strong>
                <span>{t("library.portrait.sessionHint")}</span>
                <span>{t("library.portrait.sessionExpires", { time: new Date(session.expiresAt).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" }) })}</span>
                <div className="ark-portrait-row">
                    <Button icon={<ExternalLink />} href={session.h5Link} target="_blank" rel="noopener noreferrer">
                        {t("library.portrait.openLocal")}
                    </Button>
                    <Button type="primary" icon={<CheckCircle2 />} loading={checking} onClick={onCheck}>
                        {t("library.portrait.completed")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PortraitGroupCard({
    group,
    working,
    run,
    onChanged,
    onLibraryChanged,
    confirmDelete,
}: {
    group: ArkPortraitGroup;
    working: string;
    run: (key: string, action: () => Promise<void>) => Promise<void>;
    onChanged: () => Promise<void>;
    onLibraryChanged: () => Promise<void> | void;
    confirmDelete: (title: string, content: string, onOk: () => Promise<void>) => void;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const [editing, setEditing] = useState(false);
    const [draftName, setDraftName] = useState(group.name);

    const saveName = () =>
        run(`rename:${group.id}`, async () => {
            const name = draftName.trim();
            if (name && name !== group.name) await renameArkPortraitGroup(group.id, name);
            setEditing(false);
            await onChanged();
        });

    const upload = (files: FileList | null) =>
        run(`upload:${group.id}`, async () => {
            for (const file of Array.from(files || [])) {
                if (!file.type.startsWith("image/")) throw new Error(t("library.portrait.notImage", { name: file.name }));
                const resource = await uploadResourceFile(file, "image", { fileName: file.name });
                await createArkPortraitAsset(group.id, { resourceId: resource.id, name: file.name });
            }
            message.success(t("library.portrait.submitted"));
            await onChanged();
        });

    return (
        <article className="ark-portrait-group">
            <header className="ark-portrait-group-head">
                {editing ? (
                    <Input autoFocus size="small" maxLength={40} value={draftName} aria-label={t("library.portrait.name")} onChange={(event) => setDraftName(event.target.value)} onPressEnter={() => void saveName()} onBlur={() => void saveName()} />
                ) : (
                    <button type="button" className="ark-portrait-group-name" title={t("library.portrait.rename")} onClick={() => setEditing(true)}>
                        <strong>{group.name}</strong>
                        <PencilLine aria-hidden />
                    </button>
                )}
                <Typography.Text className="ark-portrait-group-id" copyable={{ text: group.groupId }}>
                    {group.groupId}
                </Typography.Text>
                {group.source === "manual" ? <Tag>{t("library.portrait.sourceManual")}</Tag> : <Tag color="success">{t("library.portrait.sourceVerified")}</Tag>}
                <div className="ark-portrait-group-actions">
                    <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(event) => void upload(event.target.files).finally(() => (event.target.value = ""))} />
                    <Button size="small" icon={<ImagePlus />} disabled={!group.available} loading={working === `upload:${group.id}`} onClick={() => inputRef.current?.click()}>
                        {t("library.portrait.upload")}
                    </Button>
                    <Button
                        size="small"
                        danger
                        type="text"
                        aria-label={t("library.portrait.deleteGroupLabel", { name: group.name })}
                        icon={<Trash2 />}
                        onClick={() =>
                            confirmDelete(t("library.portrait.deleteGroupTitle"), t("library.portrait.deleteGroupContent"), () =>
                                run(`delete:${group.id}`, async () => {
                                    await deleteArkPortraitGroup(group.id);
                                    await onChanged();
                                }),
                            )
                        }
                    />
                </div>
            </header>
            {!group.available ? <p className="ark-portrait-warning">{t("library.portrait.groupUnavailable")}</p> : null}
            {group.assets.length ? (
                <div className="ark-portrait-assets">
                    {group.assets.map((asset) => (
                        <PortraitAssetTile key={asset.id} asset={asset} group={group} working={working} run={run} onChanged={onChanged} onLibraryChanged={onLibraryChanged} confirmDelete={confirmDelete} />
                    ))}
                </div>
            ) : (
                <p className="ark-portrait-hint">{t("library.portrait.uploadHint")}</p>
            )}
        </article>
    );
}

function PortraitAssetTile({
    asset,
    group,
    working,
    run,
    onChanged,
    onLibraryChanged,
    confirmDelete,
}: {
    asset: ArkPortraitAsset;
    group: ArkPortraitGroup;
    working: string;
    run: (key: string, action: () => Promise<void>) => Promise<void>;
    onChanged: () => Promise<void>;
    onLibraryChanged: () => Promise<void> | void;
    confirmDelete: (title: string, content: string, onOk: () => Promise<void>) => void;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const inLibrary = useAssetStore((state) => state.assets.some((item) => item.arkAssetId === asset.arkAssetId));
    const statusConfig = ASSET_STATUS[asset.status];
    const status = statusConfig ? { label: t(statusConfig.labelKey), color: statusConfig.color } : { label: asset.status, color: "default" };
    const imageUrl = asset.resourceId ? resourceFileUrl(asset.resourceId) : "";
    const canAddToLibrary = asset.status === "active" && asset.assetType === "Image" && Boolean(asset.width && asset.height && asset.mimeType?.startsWith("image/"));

    const addToLibrary = () =>
        run(`library:${asset.id}`, async () => {
            useAssetStore.getState().addAsset({
                kind: "image",
                title: `${group.name} · ${asset.name}`,
                coverUrl: imageUrl,
                tags: ["真人素材"],
                category: "character",
                status: "confirmed",
                source: "方舟真人素材库",
                arkAssetId: asset.arkAssetId,
                portraitCertified: true,
                metadata: { source: "ark-portrait", arkPortraitGroupId: group.groupId },
                data: { dataUrl: imageUrl, storageKey: resourceStorageKey(asset.resourceId), width: asset.width || 0, height: asset.height || 0, bytes: asset.bytes || 0, mimeType: asset.mimeType || "image/png" },
            });
            await flushAssetStorePersistence();
            await saveRemoteUserDataNow([]);
            await onLibraryChanged();
            message.success(t("library.portrait.addedToLibrary"));
        });

    return (
        <figure className="ark-portrait-asset">
            {imageUrl ? <img src={imageUrl} alt={asset.name} loading="lazy" decoding="async" /> : <span className="ark-portrait-asset-missing">{t("library.portrait.fileDeleted")}</span>}
            <figcaption>
                <span className="ark-portrait-asset-name" title={asset.name}>
                    {asset.name}
                </span>
                <Tag color={status.color}>{status.label}</Tag>
                {asset.error ? <span className="ark-portrait-asset-error">{asset.error}</span> : null}
                <div className="ark-portrait-asset-actions">
                    {asset.status === "processing" ? (
                        <Button
                            size="small"
                            type="text"
                            icon={<RefreshCw />}
                            loading={working === `refresh:${asset.id}`}
                            onClick={() =>
                                void run(`refresh:${asset.id}`, async () => {
                                    await refreshArkPortraitAsset(asset.id);
                                    await onChanged();
                                })
                            }
                        >
                            {t("common.refresh")}
                        </Button>
                    ) : null}
                    {canAddToLibrary ? (
                        <Button size="small" disabled={inLibrary} loading={working === `library:${asset.id}`} onClick={() => void addToLibrary()}>
                            {inLibrary ? t("library.portrait.inLibrary") : t("library.portrait.addToLibrary")}
                        </Button>
                    ) : null}
                    <Button
                        size="small"
                        type="text"
                        danger
                        aria-label={t("library.portrait.deleteAssetLabel", { name: asset.name })}
                        icon={<Trash2 />}
                        onClick={() =>
                            confirmDelete(t("library.portrait.deleteAssetTitle"), t("library.portrait.deleteAssetContent"), () =>
                                run(`delete:${asset.id}`, async () => {
                                    await deleteArkPortraitAsset(asset.id);
                                    await onChanged();
                                }),
                            )
                        }
                    />
                </div>
            </figcaption>
        </figure>
    );
}
