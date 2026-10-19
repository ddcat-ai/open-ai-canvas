import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Check, ChevronLeft, Ellipsis, EyeOff, LoaderCircle, LockKeyhole, Minus, Palette, Plus, RotateCcw, Scaling, Search, Sparkles, UnlockKeyhole } from "lucide-react";
import type { PetAppearance, PetPreference } from "@/services/api/appearance";
import { petArcLayout, petRingSector } from "@/lib/canvas/pet-menu";
import { filterPetCatalog } from "@/lib/canvas/pet-catalog";
import { PetThumbnail } from "./pet-thumbnail";
import "./pet-radial-menu.css";

export function PetRadialMenu({
    anchor,
    catalog,
    preference,
    onChange,
    onSelect,
    onClose,
    onPreviewScale,
    error,
    saving,
    onRetry,
    busy,
    loading,
    reducedMotion,
}: {
    anchor: DOMRect;
    catalog: PetAppearance[];
    preference: PetPreference;
    onChange: (patch: Partial<PetPreference>) => void;
    onSelect: (id: string) => void;
    onClose: () => void;
    onPreviewScale: (scale: number | null) => void;
    error: string;
    saving: boolean;
    onRetry: () => void;
    busy: boolean;
    loading: boolean;
    reducedMotion: boolean;
}) {
    const [panel, setPanel] = useState<"" | "look" | "size">("look");
    const [more, setMore] = useState(false);
    const [query, setQuery] = useState("");
    const [scale, setScale] = useState(preference.scale);
    const host = useRef<HTMLDivElement>(null),
        priorFocus = useRef(document.activeElement as HTMLElement | null),
        scaleRef = useRef(scale),
        changed = useRef(false);
    const initialAnchor = useRef(anchor);
    const placement = petArcLayout(anchor, { width: window.innerWidth, height: window.innerHeight });
    const panelLeft = Math.max(12, Math.min(innerWidth - 288, initialAnchor.current.left + initialAnchor.current.width / 2 - 138));
    const panelHeight = more ? Math.min(320, innerHeight - 24) : 156;
    const panelTop = Math.max(12, Math.min(innerHeight - panelHeight - 12, initialAnchor.current.top >= panelHeight + 12 ? initialAnchor.current.top - panelHeight - 8 : initialAnchor.current.top + initialAnchor.current.height + 12));
    const sector = (index: number, thumbnail = false) => petRingSector(index, thumbnail, placement);
    const choices = [{ id: "system", name: "跟随系统", published: true } as PetAppearance, ...catalog.filter((pet) => pet.published)];
    const visibleChoices = more ? filterPetCatalog(choices, query) : choices.slice(0, 3);
    useEffect(() => {
        setScale(preference.scale);
        scaleRef.current = preference.scale;
    }, [preference.scale]);
    useEffect(() => {
        const focus = priorFocus.current;
        return () => {
            onPreviewScale(null);
            if (focus?.isConnected) focus.focus();
        };
    }, [onPreviewScale]);
    useEffect(() => {
        const selector = panel === "size" ? ".pet-menu-size-panel input" : more ? ".pet-menu-models.is-grid input" : ".pet-menu-dismiss";
        host.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    }, [panel, more]);
    useEffect(() => {
        const closeMenu = () => onClose();
        window.addEventListener("resize", closeMenu);
        return () => window.removeEventListener("resize", closeMenu);
    }, [onClose]);
    const commit = () => {
        if (changed.current) {
            changed.current = false;
            onChange({ scale: scaleRef.current });
        }
    };
    return createPortal(
        <motion.div
            className="pet-menu-layer app-user-overlays"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.12 }}
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                    e.preventDefault();
                    commit();
                    onClose();
                    return;
                }
                if (e.key === "Tab") {
                    const nodes = Array.from(host.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)") || []).filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
                    const first = nodes[0],
                        last = nodes.at(-1);
                    if (e.shiftKey && document.activeElement === first) {
                        e.preventDefault();
                        last?.focus();
                    } else if (!e.shiftKey && document.activeElement === last) {
                        e.preventDefault();
                        first?.focus();
                    }
                }
            }}
        >
            <div
                className="pet-menu-backdrop"
                onClick={() => {
                    commit();
                    onClose();
                }}
            />
            <motion.div
                ref={host}
                role="dialog"
                aria-modal="true"
                aria-label="宠物设置"
                className={`pet-radial-menu ${more ? "is-more" : ""} ${panel === "size" ? "is-size" : ""}`}
                style={{ left: placement.left, top: placement.top, width: placement.width, height: placement.height, transformOrigin: `${placement.center}px ${placement.center}px` }}
                initial={reducedMotion ? false : { opacity: 0, scale: 0.96, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.98, y: reducedMotion ? 0 : 4 }}
                transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}
            >
                <div className="pet-menu-actions" aria-label="宠物快捷操作">
                    <PetSectorButton
                        ringIndex={0}
                        geometry={sector(0)}
                        type="button"
                        className="pet-menu-petal pet-menu-look"
                        aria-label="换形象"
                        title="换形象"
                        aria-expanded={panel === "look"}
                        onClick={() => {
                            commit();
                            setMore(false);
                            setPanel(panel === "look" ? "" : "look");
                        }}
                    >
                        <Palette aria-hidden="true" />
                    </PetSectorButton>
                    <PetSectorButton
                        ringIndex={1}
                        geometry={sector(1)}
                        type="button"
                        className="pet-menu-petal pet-menu-size"
                        aria-label="调大小"
                        title="调大小"
                        aria-expanded={panel === "size"}
                        onClick={() => {
                            setMore(false);
                            setPanel(panel === "size" ? "" : "size");
                        }}
                    >
                        <Scaling aria-hidden="true" />
                    </PetSectorButton>
                    <PetSectorButton
                        ringIndex={2}
                        geometry={sector(2)}
                        type="button"
                        className="pet-menu-petal pet-menu-lock"
                        aria-label={preference.locked ? "解锁位置" : "锁位置"}
                        title={preference.locked ? "解锁位置" : "锁位置"}
                        aria-pressed={preference.locked}
                        disabled={loading}
                        onClick={() => onChange({ locked: !preference.locked })}
                    >
                        {preference.locked ? <UnlockKeyhole aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
                    </PetSectorButton>
                    <PetSectorButton
                        ringIndex={3}
                        geometry={sector(3)}
                        type="button"
                        className="pet-menu-petal pet-menu-dismiss"
                        aria-label="收起菜单"
                        title="收起菜单"
                        onClick={() => {
                            commit();
                            onClose();
                        }}
                    >
                        <EyeOff aria-hidden="true" />
                    </PetSectorButton>
                </div>
                {panel === "look" ? (
                    <div className={`pet-menu-models ${more ? "is-grid" : ""}`} style={more ? { left: panelLeft - placement.left, top: panelTop - placement.top, width: 276 } : undefined} aria-label="选择宠物形象">
                        {more ? (
                            <div className="pet-menu-panel-heading">
                                <button type="button" className="pet-menu-back" aria-label="返回" title="返回" onClick={() => setMore(false)}>
                                    <ChevronLeft aria-hidden="true" />
                                </button>
                                <button type="button" className="pet-menu-panel-dismiss" aria-label="收起菜单" title="收起菜单" onClick={onClose}>
                                    <EyeOff aria-hidden="true" />
                                </button>
                            </div>
                        ) : null}
                        {more ? (
                            <label className="pet-menu-search">
                                <Search aria-hidden="true" />
                                <input type="search" aria-label="搜索形象" placeholder="搜索形象" value={query} onChange={(e) => setQuery(e.target.value)} />
                            </label>
                        ) : null}
                        {visibleChoices.map((pet, index) => (
                            <PetSectorButton
                                ringIndex={index}
                                geometry={sector(index, true)}
                                flat={more}
                                key={pet.id}
                                aria-label={pet.name}
                                title={pet.name}
                                type="button"
                                className="pet-model-choice"
                                disabled={busy || loading}
                                aria-pressed={pet.id === preference.modelId}
                                onClick={() => onSelect(pet.id)}
                            >
                                {pet.id === "system" ? <Sparkles aria-hidden /> : <PetThumbnail pet={pet} />}
                                <span>{pet.name}</span>
                                {pet.id === preference.modelId ? <Check className="pet-choice-check" aria-hidden /> : null}
                            </PetSectorButton>
                        ))}
                        {more && !visibleChoices.length ? <p className="pet-menu-empty">没有找到形象</p> : null}
                        {!more && catalog.length + 1 > 3 ? (
                            <PetSectorButton ringIndex={3} geometry={sector(3, true)} type="button" aria-label="更多形象" title="更多形象" className="pet-menu-more" onClick={() => setMore(true)}>
                                <Ellipsis aria-hidden="true" />
                            </PetSectorButton>
                        ) : null}
                    </div>
                ) : null}
                {panel === "size" ? (
                    <div className="pet-menu-size-panel" style={{ left: panelLeft - placement.left, top: panelTop - placement.top }}>
                        <div className="pet-menu-size-heading">
                            <button
                                type="button"
                                className="pet-menu-back"
                                aria-label="返回"
                                title="返回"
                                onClick={() => {
                                    commit();
                                    setPanel("look");
                                }}
                            >
                                <ChevronLeft aria-hidden="true" />
                            </button>
                            <label htmlFor="pet-personal-scale">
                                <Scaling aria-hidden="true" />
                                <span className="sr-only">宠物大小</span>
                                <output>{scale}%</output>
                            </label>
                            <button
                                type="button"
                                className="pet-menu-panel-dismiss"
                                aria-label="收起菜单"
                                title="收起菜单"
                                onClick={() => {
                                    commit();
                                    onClose();
                                }}
                            >
                                <EyeOff aria-hidden="true" />
                            </button>
                        </div>
                        <input
                            id="pet-personal-scale"
                            type="range"
                            min={50}
                            max={150}
                            step={5}
                            value={scale}
                            disabled={loading}
                            aria-valuetext={`${scale}%`}
                            onChange={(e) => {
                                const next = Number(e.target.value);
                                setScale(next);
                                scaleRef.current = next;
                                changed.current = true;
                                onPreviewScale(next);
                            }}
                            onPointerUp={commit}
                            onKeyUp={commit}
                            onBlur={commit}
                            onPointerCancel={() => {
                                changed.current = false;
                                setScale(preference.scale);
                                scaleRef.current = preference.scale;
                                onPreviewScale(null);
                            }}
                        />
                        <div>
                            <Minus aria-hidden="true" />
                            <button
                                type="button"
                                aria-label="恢复默认"
                                title="恢复默认"
                                disabled={loading}
                                onClick={() => {
                                    setScale(100);
                                    scaleRef.current = 100;
                                    changed.current = false;
                                    onPreviewScale(100);
                                    onChange({ scale: 100 });
                                }}
                            >
                                <RotateCcw aria-hidden="true" />
                            </button>
                            <Plus aria-hidden="true" />
                        </div>
                    </div>
                ) : null}
                <div
                    className="pet-menu-feedback"
                    style={{ left: Math.max(12, Math.min(innerWidth - 272, anchor.left)) - placement.left, top: Math.max(12, Math.min(innerHeight - 40, anchor.top + anchor.height + 12)) - placement.top }}
                    role="status"
                    aria-live="polite"
                    hidden={!busy && !loading && !saving && !error}
                >
                    {busy || loading || saving ? (
                        <>
                            <LoaderCircle className="pet-menu-progress" aria-hidden="true" />
                            <span className="sr-only">{busy ? "正在准备新形象…" : loading ? "正在读取个人设置…" : "正在保存…"}</span>
                        </>
                    ) : error ? (
                        <>
                            <span>{error}</span>
                            <button type="button" onClick={onRetry}>
                                重试保存
                            </button>
                        </>
                    ) : null}
                </div>
            </motion.div>
        </motion.div>,
        document.body,
    );
}

function PetSectorButton({ ringIndex, geometry: sector, flat = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { ringIndex: number; geometry: ReturnType<typeof petRingSector>; flat?: boolean }) {
    return (
        <button
            {...props}
            style={
                flat
                    ? undefined
                    : ({ left: sector.left, top: sector.top, width: sector.width, height: sector.height, clipPath: `path('${sector.path}')`, "--pet-enter-x": "0px", "--pet-enter-y": "4px", animationDelay: `${ringIndex * 18}ms` } as CSSProperties)
            }
        >
            {!flat ? (
                <svg className="pet-sector-surface" viewBox={`0 0 ${sector.width} ${sector.height}`} aria-hidden="true">
                    <path d={sector.path} />
                </svg>
            ) : null}
            <span className="pet-sector-label" style={flat ? undefined : { left: sector.label.x, top: sector.label.y }}>
                {children}
            </span>
        </button>
    );
}
