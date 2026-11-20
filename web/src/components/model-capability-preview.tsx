import { useId, useState, type ReactNode } from "react";
import { ChevronDown, Eye, Film, Image as ImageIcon } from "lucide-react";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

export function ModelCapabilityPreview({ capability, model, detail, children }: { capability: "image" | "video"; model: string; detail?: string; children: (theme: CanvasTheme) => ReactNode }) {
    const theme = canvasThemes[useActiveTheme()];
    const [expanded, setExpanded] = useState(false);
    const controlsId = useId();
    const Icon = capability === "image" ? ImageIcon : Film;
    return (
        <aside aria-label="画布节点预览" className="order-first min-w-0 self-start md:sticky md:top-3 md:order-last">
            <h3 className="mb-3 hidden items-center gap-2 text-sm font-semibold md:flex">
                <Eye size={16} />
                画布节点预览
            </h3>
            <button
                type="button"
                aria-expanded={expanded}
                aria-controls={controlsId}
                className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium focus-visible:ring-2 md:hidden"
                onClick={() => setExpanded(!expanded)}
            >
                <Eye size={16} />
                画布节点预览
                <ChevronDown size={14} className={`ml-auto ${expanded ? "rotate-180" : ""}`} />
            </button>
            <div id={controlsId} className={`${expanded ? "mt-2" : "hidden"} min-w-0 rounded-lg border p-4 md:mt-0 md:block`} style={{ background: theme.node.panel, color: theme.node.text, borderColor: theme.node.stroke }}>
                <div className="mb-3 flex min-w-0 items-start gap-2 border-b pb-3" style={{ borderColor: theme.node.stroke }}>
                    <Icon size={16} className="mt-0.5 shrink-0" />
                    <div className="min-w-0">
                        <strong className="block break-all text-sm">{model || (capability === "image" ? "图片模型" : "视频模型")}</strong>
                        {detail && (
                            <span className="text-xs" style={{ color: theme.node.muted }}>
                                {detail}
                            </span>
                        )}
                    </div>
                </div>
                <fieldset disabled className="min-w-0">
                    {children(theme)}
                </fieldset>
            </div>
        </aside>
    );
}
