import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LoaderCircle } from "lucide-react";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { SpriteRunState } from "@/lib/canvas/sprite-pet";
import { effectivePet, petAvatarSize, petStatusPosition } from "@/lib/canvas/pet-menu";
import { usePetPreference } from "@/stores/use-pet-preference";
import { usePetAppearance } from "@/hooks/use-pet-appearance";
import { usePetReducedMotion } from "@/hooks/use-pet-reduced-motion";
import { useAgentLauncherPosition } from "./use-agent-launcher-position";
import { PetAvatar } from "./pet-avatar";
import { PetAppearanceTransition } from "./pet-appearance-transition";
import { PetRadialMenu } from "./pet-radial-menu";
import "./pet-radial-menu.css";

export function AgentLauncher({
    theme,
    statusColor,
    approvalPending,
    reducedMotion,
    hidden = false,
    onOpen,
    petState,
}: {
    theme: CanvasTheme;
    statusColor: string;
    approvalPending: boolean;
    reducedMotion: boolean;
    hidden?: boolean;
    onOpen: () => void;
    petState?: SpriteRunState;
}) {
    const { base, catalog, scope, store, preference, available, modelId, appearance: current, resolved } = usePetAppearance();
    const mediaReduced = usePetReducedMotion(),
        motionReduced = mediaReduced || reducedMotion;
    const [previewScale, setPreviewScale] = useState<number | null>(null),
        [menu, setMenu] = useState<DOMRect | null>(null),
        [candidate, setCandidate] = useState<string | null>(null),
        [switchError, setSwitchError] = useState("");
    const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const ref = useRef<HTMLButtonElement>(null),
        timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
        touch = useRef<{ x: number; y: number } | null>(null),
        longPressed = useRef(false),
        suppress = useRef(false),
        actor = useRef(scope);
    actor.current = scope;
    useEffect(() => {
        setMenu(null);
        setCandidate(null);
        setPreviewScale(null);
        setSwitchError("");
    }, [scope]);
    useEffect(() => {
        const resize = () => setViewport({ width: innerWidth, height: innerHeight });
        window.addEventListener("resize", resize);
        return () => {
            window.removeEventListener("resize", resize);
            clearTimeout(timer.current);
        };
    }, [scope]);
    const requested = (base.avatarHeight * (previewScale ?? preference.scale)) / 100;
    const height = Math.max(24, Math.min(requested, 360, viewport.height - 80, viewport.width - 40)),
        width = height;
    const update = useCallback(
        (patch: Partial<typeof preference>) => {
            if (actor.current !== scope || usePetPreference.getState().scope !== scope) return;
            usePetPreference.getState().update({ modelId, ...patch });
        },
        [modelId, scope],
    );
    const { position, dragging, moveDirection, handlers } = useAgentLauncherPosition(
        () => {
            if (!suppress.current && !longPressed.current) onOpen();
            suppress.current = false;
            longPressed.current = false;
        },
        width,
        height,
    );
    const openMenu = useCallback(() => {
        clearTimeout(timer.current);
        const box = ref.current?.getBoundingClientRect();
        setMenu(box && box.width ? box : new DOMRect(innerWidth - position.right - width, innerHeight - position.bottom - height, width, height));
    }, [position.right, position.bottom, width, height]);
    useEffect(() => {
        const open = () => openMenu();
        window.addEventListener("yinghui:pet-settings", open);
        return () => window.removeEventListener("yinghui:pet-settings", open);
    }, [openMenu]);
    const closeMenu = useCallback(() => {
        setMenu(null);
        setPreviewScale(null);
    }, []);
    const choose = (id: string) => {
        setSwitchError("");
        if (id === modelId) return;
        if ((id === "system" && base.avatarType === "orb") || (id !== "system" && catalog.find((p) => p.id === id)?.avatarType === "orb")) {
            update({ modelId: id });
            return;
        }
        setCandidate(id);
    };
    const prepared = candidate ? effectivePet(base, catalog, candidate) : null;
    const candidateScope = scope;
    return (
        <>
            <motion.button
                ref={ref}
                type="button"
                aria-label={`打开${base.agentName}`}
                aria-haspopup="dialog"
                title="点击对话 · 拖动移动 · 右键设置"
                className={`canvas-agent-launcher pet-personal-launcher canvas-agent-launcher-live2d fixed z-[calc(var(--z-toast)+1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/35 ${dragging ? "is-dragging" : ""}`}
                style={
                    {
                        ...position,
                        width,
                        height,
                        color: theme.node.text,
                        "--canvas-agent-launcher-shadow": theme.spatial.shadow,
                        "--canvas-pet-inset": `${current.avatarType === "orb" ? (height - petAvatarSize(current, height).height) / 2 : 0}px`,
                        ...(hidden ? { display: "none" } : null),
                    } as CSSProperties
                }
                aria-hidden={hidden || undefined}
                tabIndex={hidden ? -1 : undefined}
                data-canvas-no-zoom
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openMenu();
                }}
                onPointerDown={(e) => {
                    e.stopPropagation();
                    if (e.button === 0) suppress.current = false;
                    longPressed.current = false;
                    if (e.pointerType === "touch") {
                        touch.current = { x: e.clientX, y: e.clientY };
                        timer.current = setTimeout(() => {
                            longPressed.current = true;
                            suppress.current = true;
                            openMenu();
                        }, 500);
                    }
                    if (!preference.locked && !menu) handlers.onPointerDown(e);
                }}
                onPointerMove={(e) => {
                    if (touch.current && Math.hypot(e.clientX - touch.current.x, e.clientY - touch.current.y) >= 6) clearTimeout(timer.current);
                    if (!preference.locked && !longPressed.current) handlers.onPointerMove(e);
                    else e.stopPropagation();
                }}
                onPointerUp={(e) => {
                    clearTimeout(timer.current);
                    touch.current = null;
                    if (longPressed.current) handlers.onPointerCancel(e);
                    else handlers.onPointerUp(e);
                }}
                onPointerCancel={(e) => {
                    clearTimeout(timer.current);
                    touch.current = null;
                    handlers.onPointerCancel(e);
                }}
                onLostPointerCapture={handlers.onLostPointerCapture}
                onClick={(e) => {
                    if (suppress.current || longPressed.current) {
                        e.preventDefault();
                        e.stopPropagation();
                        suppress.current = false;
                        longPressed.current = false;
                        return;
                    }
                    handlers.onClick(e);
                }}
                onKeyDown={(e) => {
                    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                        e.preventDefault();
                        e.stopPropagation();
                        openMenu();
                        return;
                    }
                    if (preference.locked && e.key.startsWith("Arrow")) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                    handlers.onKeyDown(e);
                }}
                onDoubleClick={handlers.onDoubleClick}
                transition={{ duration: motionReduced ? 0 : 0.16 }}
            >
                <PetAppearanceTransition appearance={current} resolved={resolved} reducedMotion={motionReduced || hidden}>
                    {resolved ? (
                        <PetAvatar appearance={current} height={height} paused={hidden} reducedMotion={motionReduced} state={petState} moveDirection={moveDirection} />
                    ) : (
                        <span role="status" aria-busy="true">
                            <LoaderCircle className="size-6 motion-safe:animate-spin" aria-hidden />
                            <span className="sr-only">正在加载助手形象</span>
                        </span>
                    )}
                </PetAppearanceTransition>
                {base.launcherLabel || approvalPending ? (
                    <span className={`canvas-agent-launcher-label ${approvalPending ? "is-pending" : ""}`} title={approvalPending ? "待审批" : base.launcherLabel}>
                        {approvalPending ? "待审批" : base.launcherLabel}
                    </span>
                ) : null}
                <span aria-hidden="true" className={`canvas-agent-launcher-status ${approvalPending ? "is-pending" : ""}`} style={{ ...petStatusPosition(current, height), "--canvas-agent-status-color": statusColor } as CSSProperties} />
            </motion.button>
            {prepared && candidate ? (
                <div className="pet-prepare-layer" aria-hidden>
                    <PetAvatar
                        key={candidate}
                        appearance={prepared}
                        height={120}
                        reducedMotion
                        paused={false}
                        onReady={() => {
                            if (actor.current === candidateScope) {
                                update({ modelId: candidate });
                                setCandidate(null);
                            }
                        }}
                        onError={(detail) => {
                            if (actor.current === candidateScope) {
                                setCandidate(null);
                                setSwitchError(detail + "，已保留原形象");
                            }
                        }}
                    />
                </div>
            ) : null}
            <AnimatePresence>
                {menu ? (
                    <PetRadialMenu
                        key="pet-menu"
                        reducedMotion={motionReduced}
                        anchor={new DOMRect(viewport.width - position.right - width, viewport.height - position.bottom - height, width, height)}
                        catalog={catalog}
                        preference={{ ...preference, modelId }}
                        onChange={update}
                        onSelect={choose}
                        onClose={closeMenu}
                        onPreviewScale={setPreviewScale}
                        error={switchError || store.error || (!available ? "原形象已下架，已跟随系统" : "")}
                        saving={store.saving}
                        onRetry={() => void store.retry()}
                        busy={candidate !== null}
                        loading={store.loading || store.scope !== scope}
                    />
                ) : null}
            </AnimatePresence>
        </>
    );
}
