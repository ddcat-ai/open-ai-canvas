import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, ChevronDown, Camera as CameraIcon, RotateCcw, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { Tooltip } from "@/components/ui/base/tooltip";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import {
    APERTURES,
    APERTURE_META,
    CAMERA_PROFILES,
    FOCAL_LENGTHS,
    FOCAL_LENGTH_META,
    LENS_PROFILES,
    buildCameraPrompt,
    type CameraControlOptions,
    type CameraProfile,
    type LensProfile,
} from "@/lib/canvas/camera-prompt-library";

const defaultCameraControl: CameraControlOptions = {
    enabled: false,
    camera: "arri_alexa_mini_lf",
    lens: "arri_signature_prime",
    focalLength: 50,
    aperture: 2.8,
};

/* ── SVG renderers ── */

function CameraBodySvg({ profile, className }: { profile: CameraProfile; className?: string }) {
    const body = profile.bodyColor;
    const accent = profile.accentColor;
    switch (profile.id) {
        case "panavision_dxl2":
            return (
                <svg viewBox="0 0 72 52" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="18" y="8" width="30" height="32" rx="3" fill={body} stroke={accent} strokeWidth="1.2" />
                    <rect x="10" y="12" width="12" height="24" rx="2" fill="#1b1b1b" stroke={accent} />
                    <rect x="48" y="14" width="16" height="20" rx="2" fill="#222" stroke={accent} />
                    <circle cx="56" cy="24" r="6" fill="#0a0a0a" stroke={accent} />
                    <rect x="26" y="3" width="14" height="6" rx="1" fill={body} />
                    <rect x="20" y="42" width="26" height="4" rx="1" fill={accent} opacity="0.6" />
                </svg>
            );
        case "arri_alexa_mini_lf":
            return (
                <svg viewBox="0 0 72 52" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="14" y="12" width="38" height="28" rx="4" fill={body} stroke={accent} />
                    <circle cx="52" cy="26" r="10" fill="#111" stroke={accent} strokeWidth="1.2" />
                    <circle cx="52" cy="26" r="6" fill="#2b2b2b" stroke="#666" />
                    <rect x="20" y="6" width="18" height="8" rx="1.5" fill={body} />
                    <rect x="18" y="18" width="8" height="6" rx="1" fill={accent} opacity="0.3" />
                </svg>
            );
        case "red_komodo_6k":
        case "red_v_raptor_8k": {
            const is_raptor = profile.id === "red_v_raptor_8k";
            return (
                <svg viewBox="0 0 72 52" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="18" y="14" width={is_raptor ? "32" : "28"} height="26" rx="2" fill={body} stroke={accent} />
                    <circle cx={is_raptor ? "50" : "46"} cy="27" r="9" fill="#050505" stroke={accent} />
                    <circle cx={is_raptor ? "50" : "46"} cy="27" r="5" fill="#1a1a1a" stroke="#666" />
                    <rect x="20" y="8" width="8" height="7" rx="1" fill={accent} opacity="0.85" />
                    <text x="22" y="36" fontSize="6" fill="#fff" fontWeight="bold">RED</text>
                </svg>
            );
        }
        case "sony_venice_2":
        case "sony_fx6":
            return (
                <svg viewBox="0 0 72 52" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="14" y="14" width="36" height="26" rx="3" fill={body} stroke={accent} />
                    <circle cx="52" cy="27" r="9" fill="#050505" stroke={accent} />
                    <rect x="16" y="18" width="6" height="6" rx="1" fill={accent} opacity="0.5" />
                    <rect x="22" y="8" width="16" height="8" rx="1.5" fill={body} />
                    <text x="22" y="36" fontSize="5.5" fill="#ccc">SONY</text>
                </svg>
            );
        case "blackmagic_ursa_12k":
            return (
                <svg viewBox="0 0 72 52" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="16" y="12" width="32" height="28" rx="2" fill={body} stroke={accent} />
                    <circle cx="50" cy="26" r="10" fill="#050505" stroke={accent} />
                    <circle cx="50" cy="26" r="6" fill="#1a1a1a" stroke="#666" />
                    <rect x="24" y="5" width="12" height="8" rx="1" fill={body} />
                    <text x="18" y="35" fontSize="5" fill={accent} fontWeight="bold">URSA</text>
                </svg>
            );
        case "canon_c500_mk2":
            return (
                <svg viewBox="0 0 72 52" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="16" y="12" width="34" height="28" rx="3" fill={body} stroke={accent} />
                    <circle cx="50" cy="26" r="9" fill="#050505" stroke={accent} />
                    <rect x="18" y="16" width="10" height="5" rx="1" fill={accent} opacity="0.7" />
                    <text x="20" y="36" fontSize="5.5" fill="#eee">Canon</text>
                </svg>
            );
        default:
            return (
                <svg viewBox="0 0 72 52" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="16" y="14" width="36" height="26" rx="3" fill={body} stroke={accent} />
                    <circle cx="52" cy="27" r="9" fill="#0a0a0a" stroke={accent} />
                </svg>
            );
    }
}

function LensBodySvg({ profile, className }: { profile: LensProfile; className?: string }) {
    const body = profile.lensColor;
    const ring = profile.ringColor;
    const rings = profile.id.startsWith("anamorphic") ? 4 : 3;
    return (
        <svg viewBox="0 0 72 44" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <rect x="6" y="14" width="56" height="18" rx="3" fill={body} stroke="#444" />
            {Array.from({ length: rings }).map((_, i) => (
                <rect key={i} x={12 + i * 12} y="14" width="4" height="18" fill={ring} opacity="0.6" />
            ))}
            <circle cx="58" cy="23" r="7" fill="#050505" stroke={ring} strokeWidth="1.5" />
            <circle cx="58" cy="23" r="3.5" fill="#222" stroke="#888" />
            {profile.id.startsWith("anamorphic") && (
                <ellipse cx="58" cy="23" rx="7" ry="3" fill="none" stroke={ring} strokeWidth="0.8" opacity="0.7" />
            )}
        </svg>
    );
}

/* ── HoverTip ── */

interface HoverTipProps {
    title: string;
    description?: string;
    useCase?: string;
    children: React.ReactNode;
}

const HoverTip = memo(({ title, description, useCase, children }: HoverTipProps) => {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [coords, setCoords] = useState<{ left: number; top: number; placement: "top" | "bottom" } | null>(null);
    const anchorRef = useRef<HTMLDivElement | null>(null);
    const tipRef = useRef<HTMLDivElement | null>(null);
    const timerRef = useRef<number | null>(null);

    const computePlacement = useCallback(() => {
        const el = anchorRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const tooltipWidth = 260;
        const margin = 10;
        let left = rect.left + rect.width / 2 - tooltipWidth / 2;
        left = Math.max(margin, Math.min(window.innerWidth - tooltipWidth - margin, left));
        const placement: "top" | "bottom" = "top";
        const top = rect.top - margin;
        return { left, top, placement };
    }, []);

    useEffect(() => {
        if (!coords) return;
        const tip = tipRef.current;
        const anchor = anchorRef.current;
        if (!tip || !anchor) return;
        const tipH = tip.getBoundingClientRect().height;
        const rect = anchor.getBoundingClientRect();
        const margin = 10;
        let placement = coords.placement;
        if (placement === "top" && rect.top - tipH - margin < 0) placement = "bottom";
        if (placement !== coords.placement) {
            const top = placement === "top" ? rect.top - margin : rect.bottom + margin;
            setCoords((c) => (c ? { ...c, placement, top } : c));
        }
    }, [coords]);

    const handleEnter = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
            const c = computePlacement();
            if (c) setCoords(c);
        }, 900);
    };
    const handleLeave = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        setCoords(null);
    };

    return (
        <div ref={anchorRef} className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
            {children}
            {coords &&
                createPortal(
                    <div
                        ref={tipRef}
                        className="pointer-events-none fixed z-[20000] w-[260px] rounded-lg border p-3 shadow-2xl"
                        style={{
                            left: `${coords.left}px`,
                            top: coords.placement === "bottom" ? `${coords.top}px` : undefined,
                            bottom: coords.placement === "top" ? `${window.innerHeight - coords.top}px` : undefined,
                            borderColor: theme.toolbar.border,
                            background: theme.spatial.elevated,
                            color: theme.node.text,
                        }}
                    >
                        <div className="text-[12px] font-semibold">{title}</div>
                        {description && <div className="mt-1 text-[11px] leading-5" style={{ color: theme.node.muted }}>{description}</div>}
                        {useCase && <div className="mt-2 rounded px-2 py-1 text-[10px]" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>使用场景：{useCase}</div>}
                    </div>,
                    document.body,
                )}
        </div>
    );
});
HoverTip.displayName = "HoverTip";

/* ── CardColumn ── */

interface CardColumnProps {
    label: string;
    tooltipTitle: string;
    tooltipDesc?: string;
    tooltipUseCase?: string;
    visual: React.ReactNode;
    cornerBadge?: React.ReactNode;
    captionBelow: string;
    onPrev: () => void;
    onNext: () => void;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
}

const CardColumn = memo(({ label, tooltipTitle, tooltipDesc, tooltipUseCase, visual, cornerBadge, captionBelow, onPrev, onNext, theme }: CardColumnProps) => {
    return (
        <div className="flex min-w-0 flex-col items-center gap-1.5">
            <button
                type="button"
                onClick={onPrev}
                className="flex h-5 w-full items-center justify-center rounded-md transition-colors"
                style={{ color: theme.node.faint }}
                title="上一项"
            >
                <ChevronUp className="size-3.5" />
            </button>
            <HoverTip title={tooltipTitle} description={tooltipDesc} useCase={tooltipUseCase}>
                <div
                    className="relative flex h-[clamp(116px,14vw,140px)] w-full min-w-0 cursor-help flex-col items-center justify-between rounded-xl border px-2.5 pt-2 pb-2 transition-colors"
                    style={{ borderColor: theme.toolbar.border, background: theme.toolbar.itemHover }}
                >
                    <span className="text-[11px] font-medium tracking-wide" style={{ color: theme.node.muted }}>{label}</span>
                    <div className="flex w-full flex-1 items-center justify-center">{visual}</div>
                    {cornerBadge && (
                        <div className="absolute right-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "rgba(0,0,0,.5)", color: "rgba(255,255,255,.8)" }}>
                            {cornerBadge}
                        </div>
                    )}
                </div>
            </HoverTip>
            <button
                type="button"
                onClick={onNext}
                className="flex h-5 w-full items-center justify-center rounded-md transition-colors"
                style={{ color: theme.node.faint }}
                title="下一项"
            >
                <ChevronDown className="size-3.5" />
            </button>
            <span className="max-w-full truncate text-center text-[11px] leading-4" style={{ color: theme.node.muted }}>{captionBelow}</span>
        </div>
    );
});
CardColumn.displayName = "CardColumn";

/* ── Main panel ── */

export function CanvasNodeCameraPanel({
    cameraControl,
    onClose,
    onConfirm,
}: {
    cameraControl?: CameraControlOptions;
    onClose: () => void;
    onConfirm: (options: CameraControlOptions, prompt: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const copyText = useCopyText();

    const [enabled, setEnabled] = useState(cameraControl?.enabled ?? defaultCameraControl.enabled);
    const [cameraIdx, setCameraIdx] = useState(() => {
        const i = CAMERA_PROFILES.findIndex((c) => c.id === cameraControl?.camera);
        return i >= 0 ? i : 0;
    });
    const [lensIdx, setLensIdx] = useState(() => {
        const i = LENS_PROFILES.findIndex((l) => l.id === cameraControl?.lens);
        return i >= 0 ? i : 0;
    });
    const [focal, setFocal] = useState(cameraControl?.focalLength ?? 50);
    const [aperture, setAperture] = useState(cameraControl?.aperture ?? 4);

    const currentCamera = CAMERA_PROFILES[cameraIdx];
    const currentLens = LENS_PROFILES[lensIdx];
    const focalMeta = FOCAL_LENGTH_META[focal];
    const apertureMeta = APERTURE_META[aperture];

    const summary = useMemo(() => `${currentCamera.zhName} · ${currentLens.zhName} · ${focal}mm · f/${aperture}`, [currentCamera, currentLens, focal, aperture]);

    const cycleCamera = (dir: 1 | -1) => setCameraIdx((i) => (i + dir + CAMERA_PROFILES.length) % CAMERA_PROFILES.length);
    const cycleLens = (dir: 1 | -1) => setLensIdx((i) => (i + dir + LENS_PROFILES.length) % LENS_PROFILES.length);
    const cycleFocal = (dir: 1 | -1) => setFocal((f) => {
        const idx = FOCAL_LENGTHS.indexOf(f as (typeof FOCAL_LENGTHS)[number]);
        const nextIdx = (idx + dir + FOCAL_LENGTHS.length) % FOCAL_LENGTHS.length;
        return FOCAL_LENGTHS[nextIdx];
    });
    const cycleAperture = (dir: 1 | -1) => setAperture((a) => {
        const idx = APERTURES.indexOf(a as (typeof APERTURES)[number]);
        const nextIdx = (idx + dir + APERTURES.length) % APERTURES.length;
        return APERTURES[nextIdx];
    });

    const buildPrompt = useCallback(() => {
        if (!enabled) return "";
        return buildCameraPrompt({
            cameraId: currentCamera.id,
            lensId: currentLens.id,
            focalLengthMm: focal,
            apertureF: aperture,
        });
    }, [enabled, currentCamera, currentLens, focal, aperture]);

    const handleApply = () => {
        const options: CameraControlOptions = { enabled, camera: currentCamera.id, lens: currentLens.id, focalLength: focal, aperture };
        onConfirm(options, buildPrompt());
    };

    const handleReset = () => {
        setEnabled(defaultCameraControl.enabled);
        setCameraIdx(0);
        setLensIdx(0);
        setFocal(defaultCameraControl.focalLength);
        setAperture(defaultCameraControl.aperture);
    };

    const secondaryButtonClass = "flex h-8 items-center gap-1.5 rounded-[var(--dock-item-radius)] px-3 text-[var(--fs-label)] font-medium transition hover:bg-black/5 dark:hover:bg-white/10";

    return (
        <SpotlightSurface
            data-canvas-no-zoom
            spotlightColor={theme.toolbar.itemHover}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.panel}
            className="w-full overflow-hidden rounded-[var(--r-xl)] border backdrop-blur-2xl"
            style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: `0 28px 80px ${theme.spatial.shadow}` }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: theme.toolbar.border }}>
                <div className="min-w-0">
                    <div className="text-sm font-semibold tracking-tight">摄像机控制</div>
                    <div className="mt-0.5 truncate text-[11px]" style={{ color: theme.node.muted }}>为当前图片生成设置镜头、焦距与光圈</div>
                </div>
                <button
                    type="button"
                    className="grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-white/10"
                    style={{ color: theme.node.muted }}
                    onClick={onClose}
                    aria-label="关闭摄像机控制"
                    title="关闭"
                >
                    <X className="size-4" />
                </button>
            </div>

            {/* 相机、镜头、焦距和光圈均来自已注册枚举，确认时由纯函数再次强校验。 */}
            <div className="grid grid-cols-2 gap-2.5 px-4 py-4 sm:grid-cols-4">
                <CardColumn
                    label="相机"
                    tooltipTitle={`${currentCamera.zhName} · ${currentCamera.label}`}
                    tooltipDesc={currentCamera.description}
                    tooltipUseCase={currentCamera.useCase}
                    visual={<CameraBodySvg profile={currentCamera} className="h-16" />}
                    captionBelow={currentCamera.zhName}
                    onPrev={() => cycleCamera(-1)}
                    onNext={() => cycleCamera(1)}
                    theme={theme}
                />
                <CardColumn
                    label="镜头"
                    tooltipTitle={`${currentLens.zhName} · ${currentLens.label}`}
                    tooltipDesc={currentLens.description}
                    tooltipUseCase={currentLens.useCase}
                    visual={<LensBodySvg profile={currentLens} className="h-14" />}
                    captionBelow={currentLens.zhName}
                    onPrev={() => cycleLens(-1)}
                    onNext={() => cycleLens(1)}
                    theme={theme}
                />
                <CardColumn
                    label="焦距"
                    tooltipTitle={`${focal}mm · ${focalMeta?.zhName ?? ""}`}
                    tooltipDesc={focalMeta?.description}
                    tooltipUseCase={focalMeta?.useCase}
                    visual={
                        <div className="flex flex-col items-center">
                            <div className="text-[40px] font-light leading-none">{focal}</div>
                            <div className="mt-1 text-[10px] tracking-wider" style={{ color: theme.node.faint }}>mm</div>
                        </div>
                    }
                    cornerBadge={focalMeta?.zhName}
                    captionBelow={focalMeta?.zhName ?? ""}
                    onPrev={() => cycleFocal(-1)}
                    onNext={() => cycleFocal(1)}
                    theme={theme}
                />
                <CardColumn
                    label="光圈"
                    tooltipTitle={`f/${aperture} · ${apertureMeta?.zhName ?? ""}`}
                    tooltipDesc={apertureMeta?.description}
                    tooltipUseCase={apertureMeta?.useCase}
                    visual={
                        <div className="flex flex-col items-center">
                            <div className="text-[30px] font-light leading-none">
                                <span className="text-[18px]" style={{ color: theme.node.faint }}>f/</span>{aperture}
                            </div>
                            <div className="mt-1 text-[10px] tracking-wider" style={{ color: theme.node.faint }}>aperture</div>
                        </div>
                    }
                    cornerBadge={apertureMeta?.zhName}
                    captionBelow={apertureMeta?.zhName ?? ""}
                    onPrev={() => cycleAperture(-1)}
                    onNext={() => cycleAperture(1)}
                    theme={theme}
                />
            </div>

            {/* 当前有效配置摘要。 */}
            <div className="mx-4 mb-3 rounded-lg border px-3.5 py-2.5" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.itemHover }}>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: theme.node.faint }}>当前配置</div>
                <div className="mt-0.5 text-xs">{summary}</div>
            </div>

            {/* 操作区：重置与复制不产生写入，只有应用会提交生成配置。 */}
            <div className="flex min-h-12 flex-wrap items-center gap-2 border-t px-4 py-2" style={{ borderColor: theme.toolbar.border }}>
                <button type="button" className={secondaryButtonClass} style={{ color: theme.node.muted }} onClick={handleReset}>
                    <RotateCcw className="size-3.5" />重置参数
                </button>
                <span className="flex-1" />
                <Tooltip title="复制当前生成的摄像机提示词">
                    <button type="button" className={secondaryButtonClass} onClick={() => copyText(buildPrompt(), "摄像机提示词已复制")}>复制提示词</button>
                </Tooltip>
                {/* 关闭后仍保留参数选择，但提交空提示词，便于用户无损恢复。 */}
                <div className="flex items-center gap-2" title={enabled ? "当前启用摄像机控制" : "当前关闭摄像机控制"}>
                    <span className="text-xs transition-colors" style={{ color: enabled ? theme.accent.primary : theme.node.muted, fontWeight: enabled ? 600 : 400 }}>
                        {enabled ? "开启" : "关闭"}
                    </span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        onClick={() => setEnabled((v) => !v)}
                        className="canvas-node-camera-switch relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full border transition-colors"
                        style={{
                            background: enabled ? `${theme.node.activeStroke}22` : theme.toolbar.itemHover,
                            borderColor: enabled ? theme.node.activeStroke : theme.toolbar.border,
                        }}
                    >
                        <span
                            className={`inline-block size-3.5 transform rounded-full shadow-sm transition-transform ${enabled ? "translate-x-[18px]" : "translate-x-0.5"}`}
                            style={{ background: enabled ? theme.node.activeStroke : theme.node.muted }}
                        />
                    </button>
                </div>
                <motion.button
                    type="button"
                    whileHover={reducedMotion ? undefined : { y: -1 }}
                    whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                    className="canvas-node-camera-apply flex h-7 items-center gap-1.5 rounded-[var(--dock-item-radius)] border px-3.5 text-[var(--fs-label)] font-semibold transition-colors"
                    style={{ borderColor: theme.node.activeStroke, color: theme.node.activeStroke, background: "transparent" }}
                    onClick={handleApply}
                >
                    <CameraIcon className="size-3.5" />应用
                </motion.button>
            </div>
        </SpotlightSurface>
    );
}
