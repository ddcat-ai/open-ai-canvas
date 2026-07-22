import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, Modal, Select, Spin } from "antd";
import { Copy, Link2, RefreshCw, Share2, Unlink } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { createCanvasShare, deleteCanvasShare, getCanvasShare, type CanvasShareStatus } from "@/services/api/canvas-share";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasShareModal({ projectId, open, onClose, beforeCreate }: { projectId: string; open: boolean; onClose: () => void; beforeCreate: () => Promise<void> }) {
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [share, setShare] = useState<CanvasShareStatus>({ enabled: false });
    const [expiresDays, setExpiresDays] = useState(0);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const shareUrl = useMemo(() => share.token ? `${window.location.origin}/share/canvas/${share.token}` : "", [share.token]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getCanvasShare(projectId);
            setShare(result.share);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取分享状态失败");
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
        message.success("分享链接已复制");
    };

    const create = async (rotate = false) => {
        setSubmitting(true);
        try {
            await beforeCreate();
            const result = await createCanvasShare(projectId, { expiresDays, rotate });
            setShare(result.share);
            const url = result.share.token ? `${window.location.origin}/share/canvas/${result.share.token}` : "";
            await copy(url);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建分享链接失败");
        } finally {
            setSubmitting(false);
        }
    };

    const revoke = () => modal.confirm({
        title: "停止公开分享？",
        content: "现有分享链接会立即失效，原画布内容不会被删除。",
        okText: "停止分享",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: async () => {
            await deleteCanvasShare(projectId);
            setShare({ enabled: false });
            message.success("已停止分享");
        },
    });

    return (
        <Modal title={<span className="inline-flex items-center gap-2"><Share2 className="size-4" />分享画布</span>} open={open} onCancel={onClose} footer={null} centered width={520} destroyOnHidden>
            <Spin spinning={loading}>
                <div className="border-t pt-5" style={{ borderColor: theme.node.stroke }}>
                    <p className="mb-4 text-sm leading-6" style={{ color: theme.node.muted }}>
                        获得链接的人无需登录即可查看。访客可拖动画布节点并临时添加节点，但刷新后会恢复，不能修改原画布或执行生成。
                    </p>
                    {share.enabled && shareUrl ? (
                        <div className="space-y-4">
                            <Input value={shareUrl} readOnly suffix={<Button type="text" className="!h-7 !w-7 !min-w-7 !p-0" icon={<Copy className="size-3.5" />} onClick={() => void copy()} aria-label="复制分享链接" />} />
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <span className="text-xs" style={{ color: theme.node.muted }}>{share.expiresAt ? `有效至 ${new Date(share.expiresAt).toLocaleString("zh-CN")}` : "长期有效，直至手动停止分享"}</span>
                                <div className="flex gap-2">
                                    <Button icon={<RefreshCw className="size-3.5" />} loading={submitting} onClick={() => void create(true)}>重新生成链接</Button>
                                    <Button danger icon={<Unlink className="size-3.5" />} onClick={revoke}>停止分享</Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Select value={expiresDays} onChange={setExpiresDays} className="min-w-40" options={[{ value: 0, label: "长期有效" }, { value: 7, label: "7 天有效" }, { value: 30, label: "30 天有效" }]} />
                            <Button type="primary" icon={<Link2 className="size-4" />} loading={submitting} onClick={() => void create(false)}>创建并复制链接</Button>
                        </div>
                    )}
                </div>
            </Spin>
        </Modal>
    );
}
