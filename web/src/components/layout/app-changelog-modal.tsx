import { Modal, Tag } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { ScrollText } from "lucide-react";
import { useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";

import { aceternityMotion } from "@/lib/aceternity-motion";

export const APP_VERSION = __APP_VERSION__;

type AppChangelogButtonProps = {
    className?: string;
    style?: CSSProperties;
    showVersion?: boolean;
};

export function AppChangelogButton({ className, style, showVersion = false }: AppChangelogButtonProps) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button type="button" className={className} style={style} onClick={() => setOpen(true)} aria-label="查看更新日志" title="更新日志">
                <ScrollText className="size-4 shrink-0" />
                {showVersion ? <span className="truncate">更新日志 · v{APP_VERSION.replace(/^v/, "")}</span> : null}
            </button>
            <AppChangelogModal open={open} onClose={() => setOpen(false)} />
        </>
    );
}

function AppChangelogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const reducedMotion = useReducedMotion();

    return (
        <Modal
            rootClassName="app-spatial-modal"
            title={<div className="flex min-w-0 items-center gap-3 pr-8"><span className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-muted/45"><ScrollText className="size-4" /></span><div className="min-w-0"><div className="flex items-center gap-2 text-base font-semibold">更新日志<Tag bordered={false}>v{APP_VERSION.replace(/^v/, "")}</Tag></div><div className="mt-0.5 text-xs font-normal text-foreground/45">产品能力、交互与稳定性变化</div></div></div>}
            open={open}
            width={760}
            footer={null}
            centered
            onCancel={onClose}
            styles={{ body: { maxHeight: "min(72vh, 760px)", overflowY: "auto", overscrollBehavior: "contain" } }}
            modalRender={(node) => (
                <motion.div initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.975 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}>
                    {node}
                </motion.div>
            )}
        >
            <div className="thin-scrollbar pr-2 text-sm leading-6 text-foreground/75">
                <ReactMarkdown
                    components={{
                        h1: ({ children }) => <h2 className="mb-4 text-xl font-semibold text-foreground">{children}</h2>,
                        h2: ({ children }) => <h3 className="mb-2 mt-6 border-b border-border pb-2 text-base font-semibold text-foreground first:mt-0">{children}</h3>,
                        ul: ({ children }) => <ul className="space-y-2 pl-5">{children}</ul>,
                        li: ({ children }) => <li className="list-disc pl-1 marker:text-foreground/35">{children}</li>,
                        p: ({ children }) => <p className="my-2">{children}</p>,
                        code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">{children}</code>,
                    }}
                >
                    {__APP_CHANGELOG__}
                </ReactMarkdown>
            </div>
        </Modal>
    );
}
