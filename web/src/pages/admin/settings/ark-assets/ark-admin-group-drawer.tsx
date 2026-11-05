import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, DatePicker, Input, Skeleton } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { ImagePlus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useCopyText } from "@/hooks/use-copy-text";
import { arkPortraitAssetFileUrl, createAdminArkAsset, deleteAdminArkAsset, deleteAdminArkGroup, getAdminArkGroup, updateAdminArkGroup, type ArkPortraitGroup } from "@/services/api/ark-portraits";
import { ARK_IMAGE_ACCEPT, uploadArkGroupImages } from "@/services/ark-asset-upload";
import { AdminStatusBadge } from "../../components/admin-ui";
import { Callout, Switch } from "../../ui/controls";
import { AdminDrawer } from "../../ui/overlays";
import { ARK_KIND_LABEL, ARK_SOURCE_LABEL, ArkAssetStatusBadge, ArkExpiryBadge, arkUserLabel, formatArkAdminDate } from "./ark-admin-shared";
import { ArkGrantUsersField } from "./ark-grant-users-field";

type Draft = { name: string; description: string; grantAll: boolean; grantUserIds: string[]; expiresAt: Dayjs | null };

function draftFrom(group: ArkPortraitGroup): Draft {
    return { name: group.name, description: group.description || "", grantAll: group.grantAll, grantUserIds: (group.grantUsers || []).map((user) => user.id), expiresAt: group.expiresAt ? dayjs(group.expiresAt) : null };
}

/** 素材组详情：名称、授权用户与真人授权期限；平台素材组可直接上传（免审核），所有素材组可删除素材。 */
export function ArkAdminGroupDrawer({ groupId, onClose, onChanged }: { groupId: string | null; onClose: () => void; onChanged: () => void }) {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const copyText = useCopyText();
    const fileInput = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [working, setWorking] = useState("");
    const query = useQuery({ queryKey: ["admin-ark-group", groupId], queryFn: ({ signal }) => getAdminArkGroup(groupId!, signal), enabled: Boolean(groupId) });
    const group = query.data?.group;

    useEffect(() => {
        if (group) setDraft(draftFrom(group));
    }, [group]);

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["admin-ark-group", groupId] });
        onChanged();
    };

    const run = async (key: string, action: () => Promise<void>) => {
        setWorking(key);
        try {
            await action();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            setWorking("");
        }
    };

    const dirty = Boolean(group && draft && JSON.stringify({ ...draft, expiresAt: draft.expiresAt?.toISOString() || null }) !== JSON.stringify({ ...draftFrom(group), expiresAt: draftFrom(group).expiresAt?.toISOString() || null }));

    const save = () =>
        run("save", async () => {
            if (!group || !draft) return;
            if (!draft.name.trim()) throw new Error("请填写素材组名称");
            await updateAdminArkGroup(group.id, {
                name: draft.name.trim(),
                description: draft.description.trim(),
                ...(group.scope === "platform" ? { grantAll: draft.grantAll, grantUserIds: draft.grantAll ? [] : draft.grantUserIds } : {}),
                ...(group.kind === "real" && draft.expiresAt ? { expiresAt: draft.expiresAt.endOf("day").toISOString() } : {}),
            });
            message.success("素材组已更新");
            await refresh();
        });

    const upload = (files: File[]) =>
        run("upload", async () => {
            if (!group || !files.length) return;
            try {
                const submitted = await uploadArkGroupImages(files, (input) => createAdminArkAsset(group.id, input));
                message.success(`已提交 ${submitted.length} 张图片，方舟审核中`);
            } finally {
                await refresh();
            }
        });

    const confirmDeleteGroup = () => {
        if (!group) return;
        modal.confirm({
            title: `删除素材组「${group.name}」？`,
            content: "会同时删除方舟侧的素材组和组内全部素材，用户素材库中已认证的图片会取消认证并恢复原分类。用户已支付的建组费用不退还，删除不可恢复。",
            okText: "删除素材组",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteAdminArkGroup(group.id);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除失败");
                    throw error;
                }
                message.success("素材组已删除");
                onChanged();
                onClose();
            },
        });
    };

    const confirmDeleteAsset = (id: string, name: string) =>
        modal.confirm({
            title: `删除素材「${name}」？`,
            content: "已提交方舟的素材会同时在方舟侧删除，用户素材库中对应的图片会取消认证。",
            okText: "删除素材",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteAdminArkAsset(id);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除失败");
                    throw error;
                }
                message.success("素材已删除");
                await refresh();
            },
        });

    return (
        <AdminDrawer
            open={Boolean(groupId)}
            width={760}
            title={group ? group.name : "素材组详情"}
            onClose={onClose}
            extra={
                group ? (
                    <div className="flex gap-2">
                        <Button danger icon={<Trash2 className="size-4" />} onClick={confirmDeleteGroup}>
                            删除
                        </Button>
                        <Button type="primary" icon={<Save className="size-4" />} loading={working === "save"} disabled={!dirty} onClick={() => void save()}>
                            保存
                        </Button>
                    </div>
                ) : null
            }
        >
            {!group || !draft ? (
                query.isError ? (
                    <Callout tone="error">{query.error instanceof Error ? query.error.message : "读取素材组失败"}</Callout>
                ) : (
                    <Skeleton active paragraph={{ rows: 8 }} />
                )
            ) : (
                <div className="admin-ark-detail">
                    <div className="flex flex-wrap items-center gap-2">
                        <AdminStatusBadge label={ARK_KIND_LABEL[group.kind]} tone="info" />
                        <AdminStatusBadge label={group.scope === "platform" ? "平台素材组" : "用户自建"} />
                        <AdminStatusBadge label={ARK_SOURCE_LABEL[group.source] || group.source} />
                        <ArkExpiryBadge group={group} />
                        {!group.available ? <AdminStatusBadge label="站点或项目已变更，不可用" tone="error" /> : null}
                    </div>
                    <dl className="admin-ark-detail-facts">
                        <div>
                            <dt>方舟素材组 ID</dt>
                            <dd>
                                <button type="button" className="font-mono" title="复制" onClick={() => copyText(group.groupId)}>
                                    {group.groupId}
                                </button>
                            </dd>
                        </div>
                        <div>
                            <dt>{group.scope === "platform" ? "创建管理员" : "所属用户"}</dt>
                            <dd>{arkUserLabel(group.owner)}</dd>
                        </div>
                        <div>
                            <dt>创建时间</dt>
                            <dd>{formatArkAdminDate(group.createdAt, true)}</dd>
                        </div>
                        {group.kind === "real" ? (
                            <div>
                                <dt>认证时间</dt>
                                <dd>{formatArkAdminDate(group.authorizedAt, true)}</dd>
                            </div>
                        ) : null}
                    </dl>

                    <section className="admin-ark-detail-section">
                        <h3>基本信息</h3>
                        <label className="admin-ark-field">
                            <span>名称</span>
                            <Input maxLength={40} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                        </label>
                        <label className="admin-ark-field">
                            <span>说明</span>
                            <Input.TextArea maxLength={200} autoSize={{ minRows: 2, maxRows: 4 }} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                        </label>
                        {group.kind === "real" ? (
                            <label className="admin-ark-field">
                                <span>授权到期</span>
                                <DatePicker value={draft.expiresAt} allowClear={false} onChange={(value) => setDraft({ ...draft, expiresAt: value })} />
                                <small>到期后不能继续上传或用于生成。真人重新授权后可在这里延长。</small>
                            </label>
                        ) : null}
                    </section>

                    {group.scope === "platform" ? (
                        <section className="admin-ark-detail-section">
                            <h3>授权使用</h3>
                            <label className="flex items-center gap-2 text-sm">
                                <Switch checked={draft.grantAll} onChange={(checked) => setDraft({ ...draft, grantAll: checked })} aria-label="授权给全部用户" />
                                授权给全部用户
                            </label>
                            {draft.grantAll ? null : <ArkGrantUsersField value={draft.grantUserIds} known={group.grantUsers} onChange={(ids) => setDraft({ ...draft, grantUserIds: ids })} />}
                            <small>被授权的用户在设置页「方舟素材库」看到该组，手动把需要的图片加入素材库后使用。</small>
                        </section>
                    ) : null}

                    <section className="admin-ark-detail-section">
                        <div className="flex items-center justify-between gap-2">
                            <h3>组内素材（{group.assets.length}）</h3>
                            {group.scope === "platform" && group.available ? (
                                <Button icon={<ImagePlus className="size-4" />} loading={working === "upload"} onClick={() => fileInput.current?.click()}>
                                    上传图片
                                </Button>
                            ) : null}
                        </div>
                        {group.scope === "platform" ? <small>管理员上传不经过审核，直接提交方舟。JPEG / PNG / WebP，30MB 以内，边长 300–6000 像素。</small> : null}
                        <input
                            ref={fileInput}
                            hidden
                            multiple
                            type="file"
                            accept={ARK_IMAGE_ACCEPT}
                            onChange={(event) => {
                                const files = Array.from(event.target.files || []);
                                event.target.value = "";
                                void upload(files);
                            }}
                        />
                        {group.assets.length ? (
                            <ul className="admin-ark-tiles">
                                {group.assets.map((asset) => (
                                    <li key={asset.id} className="admin-ark-tile">
                                        <img src={arkPortraitAssetFileUrl(asset.id)} alt={asset.name} loading="lazy" decoding="async" />
                                        <div className="admin-ark-tile-body">
                                            <strong title={asset.name}>{asset.name}</strong>
                                            <ArkAssetStatusBadge status={asset.status} />
                                            <span>{arkUserLabel(asset.uploader)}</span>
                                            {asset.arkAssetId ? (
                                                <button type="button" className="font-mono" title="复制方舟素材 ID" onClick={() => copyText(asset.arkAssetId)}>
                                                    {asset.arkAssetId}
                                                </button>
                                            ) : null}
                                            {asset.error ? <span className="is-error">{asset.error}</span> : null}
                                        </div>
                                        <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} aria-label={`删除素材 ${asset.name}`} onClick={() => confirmDeleteAsset(asset.id, asset.name)} />
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="admin-ark-empty">组内还没有素材</p>
                        )}
                    </section>
                </div>
            )}
        </AdminDrawer>
    );
}
