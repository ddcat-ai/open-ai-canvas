import { InputNumber } from "antd";
import { Copy, MapPin, MoveRight, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PREVIS_TRAVEL_STYLES } from "@/lib/canvas/previs/previs-travel";
import type { PrevisMarker, PrevisTravelStyle } from "@/types/previs";

/**
 * 视口右键取点菜单：显示地面坐标，可打标记点（A、B…）、复制坐标、把选中对象放到这里，
 * 或让选中演员从当前位置以某种方式在 N 秒内移动到这里。Agent 读场景时能按标签引用标记点。
 */
export function PrevisPointMenu({
    point,
    screen,
    nextLabel,
    markers,
    actorName,
    cameraName,
    playhead,
    shotDuration,
    onAddMarker,
    onCopy,
    onPlaceSelected,
    onTravel,
    onClearMarkers,
    onClose,
}: {
    point: { x: number; z: number };
    screen: { x: number; y: number };
    nextLabel: string;
    markers: PrevisMarker[];
    actorName?: string;
    cameraName?: string;
    playhead: number;
    shotDuration: number;
    onAddMarker: () => void;
    onCopy: () => void;
    onPlaceSelected: () => void;
    onTravel: (style: PrevisTravelStyle, duration: number) => void;
    onClearMarkers: () => void;
    onClose: () => void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<PrevisTravelStyle>("run");
    const remaining = Math.max(0.1, shotDuration - playhead);
    const [duration, setDuration] = useState(() => Math.min(3, remaining));
    useEffect(() => {
        const close = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) onClose();
        };
        const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
        // 打开菜单的那次右键松开后才开始监听，避免立刻被关掉。
        const timer = window.setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
        document.addEventListener("keydown", escape);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("pointerdown", close, true);
            document.removeEventListener("keydown", escape);
        };
    }, [onClose]);
    const width = 300;
    const left = Math.min(Math.max(8, screen.x + 8), window.innerWidth - width - 8);
    const top = Math.min(Math.max(8, screen.y + 8), window.innerHeight - (actorName ? 360 : 200));
    return (
        <div ref={rootRef} className="pv-point-menu" role="menu" aria-label="坐标点" style={{ left, top, width }} data-canvas-no-zoom onContextMenu={(event) => event.preventDefault()}>
            <div className="pv-point-menu__head">
                <MapPin className="size-3.5" aria-hidden />
                <span className="pv-point-menu__coord">
                    X {point.x.toFixed(2)} · Z {point.z.toFixed(2)}
                </span>
                <button type="button" className="pv-point-menu__close" aria-label="关闭" onClick={onClose}>
                    <X className="size-3.5" />
                </button>
            </div>
            <button type="button" role="menuitem" className="pv-point-menu__item" onClick={onAddMarker}>
                <span className="pv-point-menu__badge">{nextLabel}</span>
                标记为点 {nextLabel}
                <small>Agent 可直接说「从 A 到 B」</small>
            </button>
            <button type="button" role="menuitem" className="pv-point-menu__item" onClick={onCopy}>
                <Copy className="size-3.5" aria-hidden />
                复制坐标
            </button>
            {actorName || cameraName ? (
                <button type="button" role="menuitem" className="pv-point-menu__item" onClick={onPlaceSelected}>
                    <MoveRight className="size-3.5" aria-hidden />
                    把「{actorName || cameraName}」放到这里
                </button>
            ) : null}
            {actorName ? (
                <div className="pv-point-menu__travel">
                    <div className="pv-point-menu__label">
                        让「{actorName}」从 {playhead.toFixed(1)}s 起移动到这里
                    </div>
                    <div className="pv-point-menu__styles" role="group" aria-label="移动方式">
                        {PREVIS_TRAVEL_STYLES.map((item) => (
                            <button key={item.value} type="button" aria-pressed={style === item.value} className={style === item.value ? "is-active" : ""} onClick={() => setStyle(item.value)}>
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <div className="pv-point-menu__row">
                        <span>用时</span>
                        <InputNumber size="small" min={0.1} max={remaining} step={0.5} value={duration} suffix="秒" onChange={(value) => value !== null && setDuration(value)} />
                        <button type="button" className="pv-point-menu__go" onClick={() => onTravel(style, Math.min(duration, remaining))}>
                            生成移动
                        </button>
                    </div>
                </div>
            ) : (
                <div className="pv-point-menu__hint">先选中一个演员，就能让他从当前位置走 / 跑 / 飞到这里。</div>
            )}
            {markers.length ? (
                <button type="button" role="menuitem" className="pv-point-menu__item is-danger" onClick={onClearMarkers}>
                    <Trash2 className="size-3.5" aria-hidden />
                    清除全部标记点（{markers.map((marker) => marker.label).join("、")}）
                </button>
            ) : null}
        </div>
    );
}

/** A、B … Z、AA、AB …：跳过已用标签。 */
export function nextPrevisMarkerLabel(markers: PrevisMarker[]) {
    const used = new Set(markers.map((marker) => marker.label));
    for (let index = 0; index < 702; index++) {
        const label = index < 26 ? String.fromCharCode(65 + index) : String.fromCharCode(65 + Math.floor(index / 26) - 1) + String.fromCharCode(65 + (index % 26));
        if (!used.has(label)) return label;
    }
    return `P${markers.length + 1}`;
}
