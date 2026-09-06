import { Modal, Tabs } from "antd";
import type { ReactNode } from "react";
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
    admin = false,
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
    admin?: boolean;
    children?: ReactNode | ((tabs: ReactNode) => ReactNode);
}) {
    const tabs = items?.length ? <Tabs activeKey={activeKey} onChange={onTabChange} animated={false} items={items.map((item) => ({ ...item, forceRender: true, children: <div className="model-editor-panel">{item.children}</div> }))} /> : null;
    const content = typeof children === "function" ? children(tabs) : children || tabs;

    return (
        <Modal
            open={open}
            centered
            width={1120}
            destroyOnHidden
            rootClassName={`${admin ? "admin-modal-root " : ""}model-editor-modal`}
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
            styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0, minHeight: 0, flex: 1 }, header: { margin: 0 }, footer: { margin: 0 } }}
        >
            {content}
        </Modal>
    );
}
