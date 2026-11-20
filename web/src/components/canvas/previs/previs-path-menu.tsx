import { Camera, Footprints, Plus, Route, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * 右键路径菜单：途经点（插入、删除、删整条路径），摄影机路径还能「让人物走这条轨迹、镜头跟在后面」；
 * 参考轨迹可以删除、交给人物走或让当前摄影机沿它运镜。样式沿用取点菜单。
 */
export function PrevisPathMenu({
    screen,
    title,
    canRemovePoint,
    actors,
    onInsertPoint,
    onRemovePoint,
    onRemovePath,
    onActorWalk,
    onCameraFly,
    onClose,
}: {
    screen: { x: number; y: number };
    title: string;
    canRemovePoint: boolean;
    /** 可以走这条轨迹的人物；为空时不显示。 */
    actors: Array<{ id: string; name: string }>;
    onInsertPoint?: () => void;
    onRemovePoint?: () => void;
    onRemovePath: () => void;
    onActorWalk?: (actorId: string) => void;
    onCameraFly?: () => void;
    onClose: () => void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const close = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) onClose();
        };
        const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
        const timer = window.setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
        document.addEventListener("keydown", escape);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("pointerdown", close, true);
            document.removeEventListener("keydown", escape);
        };
    }, [onClose]);
    const width = 280;
    const left = Math.min(Math.max(8, screen.x + 8), window.innerWidth - width - 8);
    const top = Math.min(Math.max(8, screen.y + 8), window.innerHeight - 320);
    const run = (action?: () => void) => () => {
        action?.();
        onClose();
    };
    return (
        <div ref={rootRef} className="pv-point-menu" role="menu" aria-label={title} style={{ left, top, width }} data-canvas-no-zoom onContextMenu={(event) => event.preventDefault()}>
            <div className="pv-point-menu__head">
                <Route className="size-3.5" aria-hidden />
                <span className="pv-point-menu__coord">{title}</span>
                <button type="button" className="pv-point-menu__close" aria-label="关闭" onClick={onClose}>
                    <X className="size-3.5" />
                </button>
            </div>
            {onInsertPoint ? (
                <button type="button" role="menuitem" className="pv-point-menu__item" onClick={run(onInsertPoint)}>
                    <Plus className="size-3.5" aria-hidden />
                    在这个点后面插入途经点
                </button>
            ) : null}
            {onRemovePoint ? (
                <button type="button" role="menuitem" className="pv-point-menu__item" disabled={!canRemovePoint} onClick={run(onRemovePoint)}>
                    <Trash2 className="size-3.5" aria-hidden />
                    删除这个途经点
                    {canRemovePoint ? null : <small>路径至少保留 2 个点</small>}
                </button>
            ) : null}
            {onActorWalk && actors.length ? (
                <div className="pv-point-menu__travel">
                    <div className="pv-point-menu__label">让人物走这条轨迹，镜头跟在后面</div>
                    <div className="pv-point-menu__styles" role="group" aria-label="走这条轨迹的人物">
                        {actors.slice(0, 8).map((actor) => (
                            <button key={actor.id} type="button" onClick={run(() => onActorWalk(actor.id))}>
                                <Footprints className="size-3" aria-hidden />
                                {actor.name}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
            {onCameraFly ? (
                <button type="button" role="menuitem" className="pv-point-menu__item" onClick={run(onCameraFly)}>
                    <Camera className="size-3.5" aria-hidden />
                    当前摄影机沿这条轨迹运镜
                </button>
            ) : null}
            <button type="button" role="menuitem" className="pv-point-menu__item is-danger" onClick={run(onRemovePath)}>
                <Trash2 className="size-3.5" aria-hidden />
                删除整条{onInsertPoint ? "路径" : "参考轨迹"}
            </button>
        </div>
    );
}
