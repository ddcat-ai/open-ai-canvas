import { Tabs } from "antd";
import { AppModal, type AppModalProps } from "@/components/ui/product/app-modal";
import type { ComponentType, ReactNode } from "react";
import "./model-editor-modal.css";
export function ModelEditorModal({
    title,
    subtitle,
    open,
    onClose,
    footer,
    activeKey,
    onTabChange,
    items,
    busy = false,
    shell: Shell = AppModal,
    children,
}: {
    title: string;
    subtitle?: string;
    open: boolean;
    onClose: () => void;
    footer: ReactNode;
    activeKey?: string;
    onTabChange?: (key: string) => void;
    items?: Array<{ key: string; label: string; children: ReactNode }>;
    busy?: boolean;
    /** 弹窗外壳。管理后台传入 AdminModal，保持后台浮层与用户端产品壳隔离。 */
    shell?: ComponentType<AppModalProps>;
    children?: ReactNode | ((tabs: ReactNode) => ReactNode);
}) {
    const tabs = items?.length ? <Tabs activeKey={activeKey} onChange={onTabChange} animated={false} items={items.map((item) => ({ ...item, forceRender: true, children: <div className="model-editor-panel">{item.children}</div> }))} /> : null;
    const content = typeof children === "function" ? children(tabs) : children || tabs;
    return (
        <Shell
            open={open}
            centered
            width={1120}
            destroyOnHidden
            rootClassName="model-editor-modal"
            title={
                <div>
                    {title}
                    {subtitle && <p className="model-editor-subtitle">{subtitle}</p>}
                </div>
            }
            mask={{ closable: false }}
            keyboard={!busy}
            closable={!busy}
            onCancel={onClose}
            footer={footer}
            flush styles={{ body: { minHeight: 0, flex: 1 }, header: { margin: 0 }, footer: { margin: 0 } }}
        >
            {content}
        </Shell>
    );
}
