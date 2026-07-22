import { Button, Modal } from "antd";
import { Check, Star } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function CanvasVersionCompareModal({ open, versions, onClose, onSetPrimary, onFocus }: { open: boolean; versions: CanvasNodeData[]; onClose: () => void; onSetPrimary: (nodeId: string) => void; onFocus: (nodeId: string) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const modalWidth = Math.min(1180, Math.max(440, 112 + versions.length * 340));
    return (
        <Modal title="版本对比" open={open} footer={null} width={modalWidth} centered onCancel={onClose} styles={{ body: { overflow: "hidden" } }}>
            <div className="thin-scrollbar grid max-h-[70vh] grid-flow-col auto-cols-[328px] gap-3 overflow-x-auto pb-2">
                {versions.map((node) => (
                    <article key={node.id} className="overflow-hidden rounded-lg border" style={{ borderColor: node.metadata?.versionPrimary ? theme.node.activeStroke : theme.node.stroke, background: theme.node.panel }}>
                        <div className="flex h-11 items-center justify-between gap-3 border-b px-3" style={{ borderColor: theme.node.stroke }}>
                            <div className="flex min-w-0 flex-1 items-center gap-2"><span className="grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold" style={{ background: theme.toolbar.itemHover }}>{node.metadata?.versionLabel || "-"}</span><span className="min-w-0 truncate text-xs font-semibold" title={node.title}>{node.title}</span></div>
                            {node.metadata?.versionPrimary ? <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] font-medium" style={{ color: theme.node.activeStroke }}><Check className="size-3" />主版本</span> : null}
                        </div>
                        <button type="button" className="block h-52 w-full overflow-hidden" style={{ background: theme.node.fill }} onClick={() => onFocus(node.id)}>
                            {node.type === CanvasNodeType.Image && node.metadata?.content ? <img src={node.metadata.content} alt={node.title || "版本图片"} className="size-full object-contain" /> : node.type === CanvasNodeType.Video && node.metadata?.content ? <video src={node.metadata.content} className="size-full object-contain" muted preload="metadata" aria-label={node.title || "版本视频"} /> : <span className="grid size-full place-items-center px-4 text-center text-xs" style={{ color: theme.node.muted }}>点击定位到画布节点</span>}
                        </button>
                        <div className="space-y-2 p-3 text-[11px]">
                            <Info label="模型" value={node.metadata?.model || "默认模型"} />
                            <Info label="尺寸" value={node.metadata?.size || "默认尺寸"} />
                            <div><div className="whitespace-nowrap opacity-45">提示词</div><div className="mt-1 line-clamp-5 whitespace-pre-wrap break-words leading-5">{node.metadata?.composerContent || node.metadata?.prompt || "未填写"}</div></div>
                            <Button block size="small" className="whitespace-nowrap" type={node.metadata?.versionPrimary ? "default" : "primary"} disabled={node.metadata?.versionPrimary} icon={<Star className="size-3.5" />} onClick={() => onSetPrimary(node.id)}>{node.metadata?.versionPrimary ? "当前主版本" : "设为主版本"}</Button>
                        </div>
                    </article>
                ))}
            </div>
        </Modal>
    );
}

function Info({ label, value }: { label: string; value: string }) {
    return <div className="flex min-w-0 items-center gap-3"><span className="w-9 shrink-0 whitespace-nowrap opacity-45">{label}</span><span className="min-w-0 flex-1 truncate text-right font-medium" title={value}>{value}</span></div>;
}
