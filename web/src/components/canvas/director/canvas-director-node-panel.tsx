import { useState, type ReactNode } from "react";
import { Box, Camera, Clapperboard, Lightbulb, LockKeyhole, Move3d } from "lucide-react";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { gateDirectorPreviewFailure, resolveDirectorActiveShot, resolveDirectorPreviewSource, type DirectorNodeContentReader } from "@/lib/canvas/director/director-preview";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { DirectorScene } from "@/types/director";

export function CanvasDirectorNodePanel({ node, scene, readNodeContent, onOpen, professional = true }: { node: CanvasNodeData; scene: DirectorScene | null; readNodeContent: DirectorNodeContentReader; onOpen: () => void; professional?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const shot = resolveDirectorActiveShot(scene, node.metadata?.directorShotId);
    // 记录「失败的那个 URL」而非布尔量：同一个坏 URL 不再反复渲染，换成另一个 URL 时自动重试。
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const preview = gateDirectorPreviewFailure(
        resolveDirectorPreviewSource({ scene, shot, previewNodeId: node.metadata?.directorPreviewNodeId, readNodeContent }),
        failedUrl,
    );

    return (
        <div className="flex h-full w-full cursor-move flex-col p-3 pt-7" style={{ color: theme.node.text }}>
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover }}><Clapperboard className="size-3.5" /></span>
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{node.metadata?.workflowTitle || node.title}</div>
                        <div className="truncate text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>{shot?.name || "未设置镜头"}</div>
                    </div>
                </div>
                <span className="shrink-0 text-[var(--fs-tiny)] font-semibold" style={{ color: theme.accent.primary }}>3D</span>
            </div>

            <button
                type="button"
                data-canvas-no-zoom
                className="group relative min-h-0 flex-1 cursor-pointer overflow-hidden rounded-lg border text-left focus-visible:outline-none focus-visible:ring-2 disabled:cursor-default"
                style={{ background: theme.node.fill, borderColor: theme.node.stroke }}
                title={professional ? "打开 3D 导演台" : "切换到专业模式后编辑导演台"}
                disabled={!professional}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); onOpen(); }}
            >
                {preview.kind === "image"
                    ? <img src={preview.url} alt={`${node.metadata?.workflowTitle || node.title} 已回写的导演台构图`} className="h-full w-full object-contain" draggable={false} onError={() => setFailedUrl(preview.url)} />
                    : <DirectorPreviewState kind={preview.kind} theme={theme} />}
                <span className={`absolute inset-x-0 bottom-0 flex h-10 items-center justify-center gap-1.5 text-xs font-semibold backdrop-blur-sm transition-opacity ${professional ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : "opacity-100"}`} style={{ background: `${theme.toolbar.panel}dd`, color: theme.node.text }}>{professional ? <><Move3d className="size-3.5" />进入导演台</> : <><LockKeyhole className="size-3.5" />专业模式可编辑</>}</span>
            </button>

            <div className="mt-2 grid grid-cols-3 gap-1 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                <Stat icon={<Box className="size-3" />} value={scene?.objects.length || 0} label="对象" />
                <Stat icon={<Camera className="size-3" />} value={scene?.cameras.length || 0} label="机位" />
                <Stat icon={<Lightbulb className="size-3" />} value={scene?.lights.length || 0} label="灯光" />
            </div>
        </div>
    );
}

/**
 * 诚实空态/准备态：不绘制地面、地平线、机位或任何伪 3D 物体。
 * 颜色全部走画布主题 token；层级靠字号/字重区分，不靠降低对比度。
 */
function DirectorPreviewState({ kind, theme }: { kind: "loading" | "empty"; theme: CanvasTheme }) {
    const loading = kind === "loading";
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 pb-10 text-center">
            <span className="grid size-10 shrink-0 place-items-center rounded-[var(--r-lg)]" style={{ background: theme.toolbar.activeBg }}>
                <Clapperboard className="size-4" style={{ color: theme.node.muted }} aria-hidden />
            </span>
            <span className="max-w-full truncate text-[var(--fs-tiny)] font-semibold" style={{ color: theme.node.text }}>{loading ? "正在准备场景" : "尚未生成预览"}</span>
            <span className="max-w-full text-[var(--fs-tiny)] leading-4" style={{ color: theme.node.muted }}>{loading ? "场景数据加载完成后显示" : "进入导演台并回写构图后显示"}</span>
        </div>
    );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
    return <span className="inline-flex min-w-0 items-center justify-center gap-1 rounded-md py-1" title={`${value} 个${label}`}>{icon}<b>{value}</b>{label}</span>;
}
