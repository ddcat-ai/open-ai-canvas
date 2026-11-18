import { useCallback, useEffect, useState, type ReactNode } from "react";
import { App, Button, Skeleton } from "antd";
import { AlertTriangle, Image as ImageIcon, RefreshCw, Shirt, ShoppingBag } from "lucide-react";

import { cn } from "@/lib/utils";
import { getAdminFeatureAvailability, updateAdminFeatureAvailability } from "@/services/api/auth";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";
import { Switch } from "@/pages/admin/ui/controls";
import { TRYON_FUNCTIONS } from "@/pages/ecommerce/tryon/tryon-kinds";
import { TryOnGlyph } from "@/pages/ecommerce/tryon/tryon-glyphs";
import { AdminPageFrame } from "./components/admin-shell";
import { AdminStatusBadge } from "./components/admin-ui";
import { parseFeatureAvailability } from "./components/feature-availability-panel";
import "./components/feature-availability-panel.css";

const tryOnOpen = (features: FeatureAvailability, id: string) => features.ecommerceTryOnFunctions[id] !== false;

/**
 * 电商 Agent · 功能开放：电商创作总开关与批量换装每个功能的单独开关。
 * 换装功能关闭后前台对普通用户隐藏该按钮、后端拒绝提交；管理员仍可见、可用，方便内测。
 */
export default function EcommerceFeaturesPage() {
    const { message } = App.useApp();
    const setGlobalFeatures = useUserStore((state) => state.setFeatures);
    const [features, setFeatures] = useState<FeatureAvailability | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const load = useCallback(
        async (announce = false) => {
            setLoading(true);
            try {
                const result = await getAdminFeatureAvailability();
                const value = parseFeatureAvailability(result.features);
                setFeatures(value);
                setGlobalFeatures(value);
                setError("");
                if (announce) message.success("已重新读取当前功能状态");
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : "读取功能开放配置失败");
            } finally {
                setLoading(false);
            }
        },
        [message, setGlobalFeatures],
    );
    useEffect(() => {
        void load();
    }, [load]);

    const save = async (patch: Partial<Pick<FeatureAvailability, "ecommerceEnabled" | "ecommerceTryOnFunctions">>, label: string, enabled: boolean, verify: (value: FeatureAvailability) => boolean) => {
        if (!features || saving) return;
        const previous = features;
        setFeatures({ ...features, ...patch });
        setSaving(true);
        setError("");
        try {
            const result = await updateAdminFeatureAvailability(patch);
            const value = parseFeatureAvailability(result.features);
            if (!verify(value)) throw new Error("服务端返回的功能状态与本次保存内容不一致，请刷新后核对");
            setFeatures(value);
            setGlobalFeatures(value);
            message.success(`${label}已${enabled ? "开启" : "关闭"}`);
        } catch (cause) {
            const text = cause instanceof Error ? cause.message : "保存功能开放配置失败";
            setFeatures(previous);
            setError(`${text}。已恢复修改前状态。`);
            message.error(text);
        } finally {
            setSaving(false);
        }
    };

    const setEcommerce = (enabled: boolean) => void save({ ecommerceEnabled: enabled }, "电商创作", enabled, (value) => value.ecommerceEnabled === enabled);
    const setTryOn = (id: string, label: string, enabled: boolean) => {
        if (!features) return;
        void save({ ecommerceTryOnFunctions: { ...features.ecommerceTryOnFunctions, [id]: enabled } }, label, enabled, (value) => tryOnOpen(value, id) === enabled);
    };

    const openCount = features ? TRYON_FUNCTIONS.filter((item) => tryOnOpen(features, item.id)).length : 0;

    return (
        <AdminPageFrame title="功能开放" description="电商创作入口与批量换装每个功能的开放状态。关闭的换装功能只对管理员显示。" scroll>
            {!features ? (
                <div className="admin-settings-stack admin-feature-availability">
                    {error ? (
                        <div className="admin-feature-inline-alert" role="alert">
                            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                            <span>{error}</span>
                            <Button size="small" onClick={() => void load()}>
                                重试
                            </Button>
                        </div>
                    ) : (
                        <Skeleton active paragraph={{ rows: 8 }} />
                    )}
                </div>
            ) : (
                <div className="admin-settings-stack admin-feature-availability is-compact-layout">
                    <div className="admin-feature-command-bar">
                        <div className="admin-feature-command-copy" aria-live="polite">
                            <div className="flex flex-wrap items-center gap-2">
                                <strong>{saving ? "正在保存更改" : "开关切换后立即生效"}</strong>
                                <AdminStatusBadge label={saving ? "提交中" : "服务端配置"} tone={saving ? "warning" : "neutral"} />
                            </div>
                        </div>
                        <div className="admin-feature-command-actions">
                            <Button icon={<RefreshCw className="size-4" />} loading={loading} disabled={saving} onClick={() => void load(true)}>
                                刷新状态
                            </Button>
                        </div>
                    </div>

                    {error ? (
                        <div className="admin-feature-inline-alert" role="alert">
                            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                            <span>{error}</span>
                        </div>
                    ) : null}

                    <div className="admin-feature-board" aria-label="电商功能开放">
                        <Domain
                            title="1. 电商创作"
                            description="电商 Agent 的总入口"
                            icon={<ShoppingBag className="size-4" aria-hidden="true" />}
                            status={<AdminStatusBadge label={features.ecommerceEnabled ? "已开放" : "已关闭"} tone={features.ecommerceEnabled ? "success" : "neutral"} />}
                        >
                            <Row
                                icon={<ImageIcon className="size-4" aria-hidden="true" />}
                                title="电商创作"
                                description="允许新建商品创作、策划和图片生成；关闭后保留历史项目与作品。"
                                enabled={features.ecommerceEnabled}
                                status={features.ecommerceEnabled ? "已开放" : "已关闭"}
                                disabled={saving}
                                onChange={setEcommerce}
                            />
                        </Domain>

                        <Domain
                            title="2. 批量换装"
                            description={`商品图片 → 批量换装里的每个功能单独开放。关闭后普通用户看不到该按钮，也无法提交；管理员仍可见、可用。${features.imageWorkbenchEnabled ? "" : "（图片生成未开放，所有换装功能暂不可用）"}`}
                            icon={<Shirt className="size-4" aria-hidden="true" />}
                            status={<AdminStatusBadge label={`${openCount}/${TRYON_FUNCTIONS.length} 开放`} tone={openCount === TRYON_FUNCTIONS.length ? "success" : "neutral"} />}
                        >
                            {TRYON_FUNCTIONS.map((item) => {
                                const open = tryOnOpen(features, item.id);
                                return (
                                    <Row
                                        key={item.id}
                                        icon={<TryOnGlyph id={item.id} />}
                                        title={item.label}
                                        description={item.description}
                                        enabled={open}
                                        status={!features.ecommerceEnabled ? "依赖未开启" : open ? "已开放" : "仅管理员"}
                                        disabled={saving || !features.ecommerceEnabled}
                                        dependent
                                        onChange={(checked) => setTryOn(item.id, item.label, checked)}
                                    />
                                );
                            })}
                        </Domain>
                    </div>
                </div>
            )}
        </AdminPageFrame>
    );
}

function Domain({ title, description, icon, status, children }: { title: string; description: string; icon: ReactNode; status: ReactNode; children: ReactNode }) {
    return (
        <section className="admin-feature-domain">
            <header className="admin-feature-domain-header">
                <span className="admin-feature-domain-icon">{icon}</span>
                <div className="admin-feature-domain-copy min-w-0 flex-1">
                    <h2>{title}</h2>
                    <p>{description}</p>
                </div>
                <div className="admin-feature-domain-status">{status}</div>
            </header>
            <div className="admin-feature-domain-list">{children}</div>
        </section>
    );
}

function Row({
    icon,
    title,
    description,
    enabled,
    status,
    disabled,
    dependent,
    onChange,
}: {
    icon: ReactNode;
    title: string;
    description: string;
    enabled: boolean;
    status: string;
    disabled: boolean;
    dependent?: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <article className={cn("admin-feature-board-row", !enabled && "is-off", dependent && "is-dependent")}>
            <div className="admin-feature-board-row-copy">
                <span className="admin-feature-board-row-icon">{icon}</span>
                <span className="admin-feature-board-row-name">
                    <strong>{title}</strong>
                    <span title={description}>{description}</span>
                </span>
            </div>
            <div className="admin-feature-board-row-control">
                <span>{status}</span>
                <Switch checked={enabled} disabled={disabled} onChange={onChange} aria-label={`设置${title}，切换后立即保存`} />
            </div>
        </article>
    );
}
