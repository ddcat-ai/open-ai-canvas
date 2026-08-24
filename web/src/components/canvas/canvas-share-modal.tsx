import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, Modal, Select, Spin } from "antd";
import { Copy, Link2, RefreshCw, Share2, Unlink } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { createCanvasShare, deleteCanvasShare, getCanvasShare, type CanvasShareStatus } from "@/services/api/canvas-share";
import { formatLocale } from "@/lib/format-locale";
import { useThemeStore } from "@/stores/use-theme-store";
import { useLocaleStore } from "@/stores/use-locale-store";
import { useTranslation } from "react-i18next";

export function CanvasShareModal({ projectId, open, onClose, beforeCreate }: { projectId: string; open: boolean; onClose: () => void; beforeCreate: () => Promise<boolean | void> }) {
    const { t } = useTranslation("canvas");
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const locale = useLocaleStore((state) => state.locale);
    const [share, setShare] = useState<CanvasShareStatus>({ enabled: false });
    const [expiresDays, setExpiresDays] = useState(0);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const shareUrl = useMemo(() => (share.token ? `${window.location.origin}/share/canvas/${share.token}` : ""), [share.token]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getCanvasShare(projectId);
            setShare(result.share);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("domain:failed-to-read-sharing-status"));
        } finally {
            setLoading(false);
        }
    }, [message, projectId]);

    useEffect(() => {
        if (open) void load();
    }, [load, open]);

    const copy = async (value = shareUrl) => {
        if (!value) return;
        await navigator.clipboard.writeText(value);
        message.success(t("domain:share-link-copied"));
    };

    const create = async (rotate = false) => {
        setSubmitting(true);
        try {
            const saved = await beforeCreate();
            if (saved === false) return;
            const result = await createCanvasShare(projectId, { expiresDays, rotate });
            setShare(result.share);
            const url = result.share.token ? `${window.location.origin}/share/canvas/${result.share.token}` : "";
            await copy(url);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("domain:failed-to-create-share-link"));
        } finally {
            setSubmitting(false);
        }
    };

    const revoke = () =>
        modal.confirm({
            title: t("domain:stop-public-sharing"),
            content: t("domain:existing-share-links-stop-working-immediately-the-canvas-itself-is-not-d"),
            okText: t("domain:stop-sharing-2"),
            okButtonProps: { danger: true },
            cancelText: t("canvas:cancel-11"),
            onOk: async () => {
                await deleteCanvasShare(projectId);
                setShare({ enabled: false });
                message.success(t("domain:sharing-stopped"));
            },
        });

    return (
        <Modal
            title={
                <span className="inline-flex items-center gap-2">
                    <Share2 className="size-4" />
                    {t("canvas:share-canvas-2")}
                </span>
            }
            open={open}
            onCancel={onClose}
            footer={null}
            centered
            width={520}
            destroyOnHidden
        >
            <Spin spinning={loading}>
                <div className="border-t pt-5" style={{ borderColor: theme.node.stroke }}>
                    <p className="mb-4 text-sm leading-6" style={{ color: theme.node.muted }}>
                        {t("domain:anyone-with-the-link-can-view-without-signing-in-guests-can-drag-nodes-a")}
                    </p>
                    {share.enabled && shareUrl ? (
                        <div className="space-y-4">
                            <Input value={shareUrl} readOnly suffix={<Button type="text" className="!h-7 !w-7 !min-w-7 !p-0" icon={<Copy className="size-3.5" />} onClick={() => void copy()} aria-label={t("domain:copy-share-link")} />} />
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <span className="text-xs" style={{ color: theme.node.muted }}>
                                    {share.expiresAt ? t("domain:valid-until-param", { date: new Date(share.expiresAt).toLocaleString(formatLocale(locale)) }) : t("domain:valid-until-sharing-is-stopped-manually")}
                                </span>
                                <div className="flex gap-2">
                                    <Button icon={<RefreshCw className="size-3.5" />} loading={submitting} onClick={() => void create(true)}>
                                        {t("domain:regenerate-link")}
                                    </Button>
                                    <Button danger icon={<Unlink className="size-3.5" />} onClick={revoke}>
                                        {t("domain:stop-sharing-2")}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Select
                                value={expiresDays}
                                onChange={setExpiresDays}
                                className="min-w-40"
                                options={[
                                    { value: 0, label: t("domain:no-expiry") },
                                    { value: 7, label: t("domain:valid-for-7-days") },
                                    { value: 30, label: t("domain:valid-for-30-days") },
                                ]}
                            />
                            <Button type="primary" icon={<Link2 className="size-4" />} loading={submitting} onClick={() => void create(false)}>
                                {t("domain:create-and-copy-link")}
                            </Button>
                        </div>
                    )}
                </div>
            </Spin>
        </Modal>
    );
}
