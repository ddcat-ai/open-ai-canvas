import type { ReactNode } from "react";
import { Box, Camera, Clapperboard, Lightbulb, LockKeyhole, Move3d } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { DirectorScene } from "@/types/director";
import { useTranslation } from "react-i18next";

export function CanvasDirectorNodePanel({ node, scene, previewUrl, onOpen, professional = true }: { node: CanvasNodeData; scene: DirectorScene | null; previewUrl?: string; onOpen: () => void; professional?: boolean }) {
    const { t } = useTranslation("canvas");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const shot = scene?.shots?.find((item) => item.id === node.metadata?.directorShotId) || scene?.shots?.[0];

    return (
        <div className="flex h-full w-full cursor-move flex-col p-3 pt-7" style={{ color: theme.node.text }}>
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover }}>
                        <Clapperboard className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{node.metadata?.workflowTitle || node.title}</div>
                        <div className="truncate text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                            {shot?.name || t("domain:no-shot-set")}
                        </div>
                    </div>
                </div>
                <span className="shrink-0 text-[var(--fs-tiny)] font-semibold" style={{ color: theme.accent.primary }}>
                    3D
                </span>
            </div>

            <button
                type="button"
                data-canvas-no-zoom
                className="group relative min-h-0 flex-1 cursor-pointer overflow-hidden rounded-lg border text-left focus-visible:outline-none focus-visible:ring-2 disabled:cursor-default"
                style={{ background: scene?.background || theme.canvas.background, borderColor: theme.node.stroke }}
                title={professional ? t("domain:open-3d-director-stage") : t("domain:switch-to-pro-mode-to-edit-the-director-stage")}
                disabled={!professional}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    onOpen();
                }}
            >
                {previewUrl ? <img src={previewUrl} alt={t("domain:param-scene-thumbnail", { title: node.title })} className="h-full w-full object-cover" draggable={false} /> : <SceneSchematic scene={scene} />}
                <span
                    className={`absolute inset-x-0 bottom-0 flex h-10 items-center justify-center gap-1.5 text-xs font-semibold backdrop-blur-sm transition-opacity ${professional ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : "opacity-100"}`}
                    style={{ background: `${theme.toolbar.panel}dd`, color: theme.node.text }}
                >
                    {professional ? (
                        <>
                            <Move3d className="size-3.5" />
                            {t("domain:enter-director-stage")}
                        </>
                    ) : (
                        <>
                            <LockKeyhole className="size-3.5" />
                            {t("domain:editable-in-pro-mode")}
                        </>
                    )}
                </span>
            </button>

            <div className="mt-2 grid grid-cols-3 gap-1 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                <Stat icon={<Box className="size-3" />} value={scene?.objects.length || 0} label={t("domain:objects")} />
                <Stat icon={<Camera className="size-3" />} value={scene?.cameras.length || 0} label={t("domain:cameras")} />
                <Stat icon={<Lightbulb className="size-3" />} value={scene?.lights.length || 0} label={t("canvas:lighting")} />
            </div>
        </div>
    );
}

function SceneSchematic({ scene }: { scene: DirectorScene | null }) {
    const { t } = useTranslation("canvas");
    return (
        <div className="relative h-full w-full overflow-hidden">
            <div className="absolute inset-x-0 bottom-0 h-[55%] origin-bottom -skew-y-6 border-t border-white/25 bg-black/15" />
            <div className="absolute inset-x-[8%] bottom-[18%] h-px bg-white/25" />
            <div className="absolute inset-x-[16%] bottom-[32%] h-px bg-white/15" />
            {(scene?.objects || []).slice(0, 6).map((object, index) => {
                const left = 48 + object.transform.position[0] * 12;
                const bottom = 25 + object.transform.position[2] * 7 + Math.max(0, object.transform.position[1]) * 4;
                const height = object.primitive === "character" ? 42 : 22 + Math.min(18, object.transform.scale[1] * 8);
                return (
                    <span
                        key={object.id}
                        className={`absolute border border-white/45 shadow-sm ${object.primitive === "sphere" ? "rounded-full" : "rounded-sm"}`}
                        style={{
                            left: `${Math.max(12, Math.min(82, left + index * 2))}%`,
                            bottom: `${Math.max(18, Math.min(58, bottom))}%`,
                            width: object.primitive === "character" ? 13 : 22,
                            height,
                            background: object.color,
                            transform: "translateX(-50%)",
                        }}
                    />
                );
            })}
            <Camera className="absolute bottom-[14%] left-[12%] size-5 text-white/75" />
            <span className="absolute left-[18%] top-[18%] size-16 rounded-full bg-white/10 blur-xl" />
            <span className="absolute inset-x-3 top-3 text-[var(--fs-tiny)] font-medium text-white/70">{scene ? t("domain:scene-preview") : t("domain:preparing-scene")}</span>
        </div>
    );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
    const { t } = useTranslation("canvas");
    return (
        <span className="inline-flex min-w-0 items-center justify-center gap-1 rounded-md py-1" title={t("domain:param-param", { value: value, label: label })}>
            {icon}
            <b>{value}</b>
            {label}
        </span>
    );
}
