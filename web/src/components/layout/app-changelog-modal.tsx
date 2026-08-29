import { Modal } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { ScrollText } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import { aceternityMotion } from "@/lib/aceternity-motion";

export const APP_VERSION = __APP_VERSION__;

type AppChangelogButtonProps = {
    className?: string;
    style?: CSSProperties;
    showVersion?: boolean;
    showLabel?: boolean;
    labelClassName?: string;
    versionClassName?: string;
    icon?: ReactNode;
    label?: ReactNode;
};

export function AppChangelogButton({ className, style, showVersion = false, showLabel = false, labelClassName, versionClassName, icon, label = "更新日志" }: AppChangelogButtonProps) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button type="button" className={className} style={style} onClick={() => setOpen(true)} aria-label="查看更新日志" title="更新日志">
                {icon ?? <ScrollText className="size-4 shrink-0" />}
                {showLabel ? <span className={`whitespace-nowrap ${labelClassName || ""}`}>{label}</span> : null}
                {showVersion ? <span className={versionClassName}>v{APP_VERSION.replace(/^v/, "")}</span> : null}
            </button>
            <AppChangelogModal open={open} onClose={() => setOpen(false)} />
        </>
    );
}

function AppChangelogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const reducedMotion = useReducedMotion();
    const version = `v${APP_VERSION.replace(/^v/, "")}`;

    return (
        <Modal
            rootClassName="app-spatial-modal app-changelog-modal"
            title={
                <div className="app-changelog-heading">
                    <span className="app-changelog-heading-icon">
                        <ScrollText className="size-4" />
                    </span>
                    <div className="app-changelog-heading-copy">
                        <div className="app-changelog-heading-title">更新日志</div>
                        <div className="app-changelog-heading-description">按版本查看产品能力、交互与稳定性变化</div>
                    </div>
                    <span className="app-changelog-current-version">当前版本 {version}</span>
                </div>
            }
            open={open}
            width={820}
            footer={null}
            centered
            onCancel={onClose}
            styles={{ body: { padding: 0 } }}
            modalRender={(node) => (
                <motion.div initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.975 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}>
                    {node}
                </motion.div>
            )}
        >
            <div className="app-changelog-scroll thin-scrollbar">
                <ReactMarkdown
                    components={{
                        h1: () => null,
                        h2: ({ children }) => {
                            const label = String(children);
                            const latest = label === "Unreleased";

                            return (
                                <h3 className={`app-changelog-section-heading${latest ? " is-latest" : ""}`}>
                                    <span className="app-changelog-section-marker" aria-hidden="true" />
                                    <span>{latest ? "开发中" : label}</span>
                                    {latest ? <span className="app-changelog-latest-badge">最新</span> : null}
                                </h3>
                            );
                        },
                        ul: ({ children }) => <ul className="app-changelog-list">{children}</ul>,
                        li: ({ children }) => <li>{children}</li>,
                        p: ({ children }) => <p className="app-changelog-paragraph">{children}</p>,
                        code: ({ children }) => <code className="app-changelog-code">{children}</code>,
                    }}
                >
                    {__APP_CHANGELOG__}
                </ReactMarkdown>
            </div>
        </Modal>
    );
}
