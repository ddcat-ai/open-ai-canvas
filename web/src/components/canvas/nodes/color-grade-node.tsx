import { Palette, RotateCcw } from "lucide-react";

import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { colorGradeCssFilter, DEFAULT_COLOR_GRADE, isNeutralColorGrade, type CanvasColorGrade } from "@/lib/canvas/canvas-color-grade";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";

type ColorGradeNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

const SLIDERS: Array<{ key: keyof CanvasColorGrade; label: string; min: number; max: number }> = [
    { key: "brightness", label: "亮度", min: 0, max: 200 },
    { key: "contrast", label: "对比", min: 0, max: 200 },
    { key: "saturate", label: "饱和", min: 0, max: 200 },
    { key: "hueRotate", label: "色相", min: -180, max: 180 },
];

/**
 * 调色节点：吃上游图片，本地预览调色结果，并作为图片素材喂给下游。
 *
 * 预览只用 CSS filter，不上传任何东西；真正落地成资源要等到生成时——
 * 见 canvas-color-grade.ts 的 resolveCanvasColorGradeReference。拖滑杆不产生上传，
 * 也不消耗文件容量。
 */
export function ColorGradeNodeContent({ node, theme }: ColorGradeNodeContentProps) {
    const { updateMetadata } = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id);
    // 判据要与 canvas-node-generation 的 readReferenceImage 完全一致，
    // 否则会出现「预览有图、生成却没用上」这种不报错的偏差。
    const inherited = upstream.find((item) => getNodeResourceKind(item) === "image" && item.metadata?.content);
    const url = inherited?.metadata?.content || "";
    const grade = node.metadata?.colorGrade || DEFAULT_COLOR_GRADE;

    if (!url) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.muted }}>
                <Palette className="size-5 opacity-60" />
                <span style={{ fontSize: "var(--fs-label)" }}>连接一张图片即可调色</span>
            </div>
        );
    }

    const editable = Boolean(updateMetadata);
    const update = (key: keyof CanvasColorGrade, value: number) => updateMetadata?.(node.id, { colorGrade: { ...grade, [key]: value } });

    return (
        <div className="flex h-full w-full flex-col overflow-hidden" style={{ background: theme.node.fill }}>
            <div className="relative min-h-0 flex-1">
                <img src={url} alt={node.title || "调色"} className="h-full w-full object-contain" draggable={false} style={{ filter: colorGradeCssFilter(grade) }} />
                {isNeutralColorGrade(grade) ? (
                    <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-white" style={{ fontSize: "var(--fs-tiny)" }}>未调色</span>
                ) : null}
            </div>

            {editable ? (
                <div
                    className="shrink-0 border-t px-2 py-1.5"
                    data-canvas-no-zoom
                    style={{ borderColor: theme.node.stroke }}
                    onWheel={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    {SLIDERS.map((slider) => (
                        <label key={slider.key} className="flex items-center gap-2" style={{ fontSize: "var(--fs-tiny)", color: theme.node.muted }}>
                            <span className="w-6 shrink-0">{slider.label}</span>
                            <input
                                type="range"
                                className="min-w-0 flex-1"
                                min={slider.min}
                                max={slider.max}
                                value={grade[slider.key]}
                                onChange={(event) => update(slider.key, Number(event.target.value))}
                            />
                            <span className="w-8 shrink-0 text-right tabular-nums">{grade[slider.key]}</span>
                        </label>
                    ))}
                    <button
                        type="button"
                        className="mt-1 inline-flex items-center gap-1 rounded px-1 outline-none transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ fontSize: "var(--fs-tiny)", color: theme.node.muted }}
                        onClick={() => updateMetadata?.(node.id, { colorGrade: DEFAULT_COLOR_GRADE })}
                    >
                        <RotateCcw className="size-3" />复位
                    </button>
                </div>
            ) : null}
        </div>
    );
}
