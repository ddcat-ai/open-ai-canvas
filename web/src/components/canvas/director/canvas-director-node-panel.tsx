import type { ReactNode } from "react";
import { Box, Camera, Clapperboard, Lightbulb, LockKeyhole, Move3d } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { DirectorScene } from "@/types/director";

export function CanvasDirectorNodePanel({ node, scene, previewUrl, onOpen, professional = true }: { node: CanvasNodeData; scene: DirectorScene | null; previewUrl?: string; onOpen: () => void; professional?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const shot = scene?.shots?.find((item) => item.id === node.metadata?.directorShotId) || scene?.shots?.[0];

    return (
        <div className="flex h-full w-full cursor-move flex-col p-3 pt-7" style={{ color: theme.node.text }}>
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover }}><Clapperboard className="size-3.5" /></span>
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{node.metadata?.workflowTitle || node.title}</div>
                        <div className="truncate text-[10px]" style={{ color: theme.node.muted }}>{shot?.name || "未设置镜头"}</div>
                    </div>
                </div>
                <span className="shrink-0 text-[10px] font-semibold" style={{ color: theme.accent.primary }}>3D</span>
            </div>

            <button
                type="button"
                data-canvas-no-zoom
                className="group relative min-h-0 flex-1 cursor-pointer overflow-hidden rounded-lg border text-left focus-visible:outline-none focus-visible:ring-2 disabled:cursor-default"
                style={{ background: scene?.background || theme.canvas.background, borderColor: theme.node.stroke }}
                title={professional ? "打开 3D 导演台" : "切换到专业模式后编辑导演台"}
                disabled={!professional}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); onOpen(); }}
            >
                {previewUrl ? <img src={previewUrl} alt={`${node.title} 场景缩略图`} className="h-full w-full object-cover" draggable={false} /> : <SceneSchematic scene={scene} />}
                <span className={`absolute inset-x-0 bottom-0 flex h-10 items-center justify-center gap-1.5 text-xs font-semibold backdrop-blur-sm transition-opacity ${professional ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : "opacity-100"}`} style={{ background: `${theme.toolbar.panel}dd`, color: theme.node.text }}>{professional ? <><Move3d className="size-3.5" />进入导演台</> : <><LockKeyhole className="size-3.5" />专业模式可编辑</>}</span>
            </button>

            <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]" style={{ color: theme.node.muted }}>
                <Stat icon={<Box className="size-3" />} value={scene?.objects.length || 0} label="对象" />
                <Stat icon={<Camera className="size-3" />} value={scene?.cameras.length || 0} label="机位" />
                <Stat icon={<Lightbulb className="size-3" />} value={scene?.lights.length || 0} label="灯光" />
            </div>
        </div>
    );
}

function SceneSchematic({ scene }: { scene: DirectorScene | null }) {
    return (
        <div className="relative h-full w-full overflow-hidden">
            <div className="absolute inset-x-0 bottom-0 h-[55%] origin-bottom -skew-y-6 border-t border-white/25 bg-black/15" />
            <div className="absolute inset-x-[8%] bottom-[18%] h-px bg-white/25" />
            <div className="absolute inset-x-[16%] bottom-[32%] h-px bg-white/15" />
            {(scene?.objects || []).slice(0, 6).map((object, index) => {
                const left = 48 + object.transform.position[0] * 12;
                const bottom = 25 + object.transform.position[2] * 7 + Math.max(0, object.transform.position[1]) * 4;
                const height = object.primitive === "character" ? 42 : 22 + Math.min(18, object.transform.scale[1] * 8);
                return <span key={object.id} className={`absolute border border-white/45 shadow-sm ${object.primitive === "sphere" ? "rounded-full" : "rounded-sm"}`} style={{ left: `${Math.max(12, Math.min(82, left + index * 2))}%`, bottom: `${Math.max(18, Math.min(58, bottom))}%`, width: object.primitive === "character" ? 13 : 22, height, background: object.color, transform: "translateX(-50%)" }} />;
            })}
            <Camera className="absolute bottom-[14%] left-[12%] size-5 text-white/75" />
            <span className="absolute left-[18%] top-[18%] size-16 rounded-full bg-white/10 blur-xl" />
            <span className="absolute inset-x-3 top-3 text-[10px] font-medium text-white/70">{scene ? "场景预览" : "正在准备场景"}</span>
        </div>
    );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
    return <span className="inline-flex min-w-0 items-center justify-center gap-1 rounded-md py-1" title={`${value} 个${label}`}>{icon}<b>{value}</b>{label}</span>;
}
