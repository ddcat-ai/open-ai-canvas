import { Popover } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePopoverAnchorAlign } from "@/hooks/use-popover-anchor-align";
import { ArrowDown, ArrowUp, Eye, EyeOff, Layers3, RefreshCw } from "lucide-react";
import { useCanvasNodeActions } from "./canvas-node-action-context";
import type { CanvasNodeData } from "@/types/canvas";

export function CanvasImageLayerControls({ node }: { node: CanvasNodeData }) {
    const { t } = useTranslation();
    const { updateNode, extractLayerMaterials } = useCanvasNodeActions();
    const [open, setOpen] = useState(false);
    const popoverRef = usePopoverAnchorAlign(open);
    const group = node.metadata?.imageLayerGroup;
    if (!group) return null;
    const change = (nodeId: string, direction?: number) =>
        updateNode?.(node.id, (current) => {
            const live = current.metadata?.imageLayerGroup;
            if (!live) return current;
            const layers = live.layers.map((layer) => ({ ...layer }));
            const index = layers.findIndex((layer) => layer.nodeId === nodeId);
            if (index < 0) return current;
            if (direction === undefined) layers[index].visible = !layers[index].visible;
            else {
                const target = index + direction;
                if (target < 0 || target >= layers.length) return current;
                [layers[index], layers[target]] = [layers[target], layers[index]];
            }
            return { ...current, metadata: { ...current.metadata, imageLayerGroup: { ...live, layers, compositeStatus: "updating", compositeError: undefined } } };
        });
    const panel = (
        <div className="w-64 space-y-2" data-canvas-no-zoom data-canvas-wheel-scroll onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <div className="text-sm font-medium">{t("canvasB.imageLayers.orderTitle")}</div>
            {group.incomplete ? (
                <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
                    {t(group.incomplete.missingBackground ? "canvasB.imageLayers.incompleteMissingBackground" : "canvasB.imageLayers.incompletePartial", {
                        completed: group.incomplete.completed,
                        total: group.incomplete.total,
                        failed: group.incomplete.failed,
                    })}
                </p>
            ) : null}
            <div className="max-h-64 space-y-1 overflow-y-auto">
                {[...group.layers].reverse().map((layer, reverseIndex) => {
                    const index = group.layers.length - 1 - reverseIndex;
                    return (
                        <div key={layer.nodeId} className="flex items-center gap-1 rounded px-1 py-1">
                            <button type="button" aria-label={t("canvasB.imageLayers.toggleVisibility", { index: index + 1 })} aria-pressed={layer.visible} className="p-1" onClick={() => change(layer.nodeId)}>
                                {layer.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                            </button>
                            <span className="flex-1 text-xs">{t("canvasB.imageLayers.layerName", { index: index + 1 })}</span>
                            <button type="button" aria-label={t("canvasB.imageLayers.moveUp", { index: index + 1 })} disabled={index === group.layers.length - 1} className="p-1 disabled:opacity-30" onClick={() => change(layer.nodeId, 1)}>
                                <ArrowUp className="size-4" />
                            </button>
                            <button type="button" aria-label={t("canvasB.imageLayers.moveDown", { index: index + 1 })} disabled={index === 0} className="p-1 disabled:opacity-30" onClick={() => change(layer.nodeId, -1)}>
                                <ArrowDown className="size-4" />
                            </button>
                        </div>
                    );
                })}
            </div>
            <p className="text-xs opacity-60">{t("canvasB.imageLayers.sortHint")}</p>
            {extractLayerMaterials ? (
                <button type="button" disabled={node.metadata?.imageLayerMaterials?.status === "loading"} className="text-xs underline disabled:opacity-50" onClick={() => void extractLayerMaterials(node)}>
                    {node.metadata?.imageLayerMaterials?.status === "loading" ? t("canvasB.imageLayers.savingMaterials") : node.metadata?.imageLayerMaterials?.groupId ? t("canvasB.imageLayers.resaveMaterials") : t("canvasB.imageLayers.saveMaterials")}
                </button>
            ) : null}
            <p className="text-xs opacity-60">{t("canvasB.imageLayers.materialsHint")}</p>
            {node.metadata?.imageLayerMaterials?.error ? (
                <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
                    {node.metadata.imageLayerMaterials.error}
                </p>
            ) : null}
            {group.compositeStatus === "updating" ? (
                <p role="status" className="text-xs">
                    {t("canvasB.imageLayers.updatingComposite")}
                </p>
            ) : null}
            {group.compositeStatus === "error" ? (
                <div role="alert" className="space-y-1 text-xs">
                    <p>{group.compositeError}</p>
                    <button
                        type="button"
                        className="flex items-center gap-1 underline"
                        onClick={() =>
                            updateNode?.(node.id, (current) =>
                                current.metadata?.imageLayerGroup ? { ...current, metadata: { ...current.metadata, imageLayerGroup: { ...current.metadata.imageLayerGroup, compositeStatus: "updating", compositeError: undefined } } } : current,
                            )
                        }
                    >
                        <RefreshCw className="size-3" />
                        {t("canvasB.imageLayers.retryComposite")}
                    </button>
                </div>
            ) : null}
        </div>
    );
    return (
        <Popover ref={popoverRef} open={open} onOpenChange={setOpen} trigger="click" content={panel} placement="leftTop">
            <button
                type="button"
                title={t("canvasB.imageLayers.manageLayers")}
                aria-label={t("canvasB.imageLayers.manageLayers")}
                className="grid size-6 place-items-center rounded bg-black/60 text-white"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
            >
                <Layers3 className="size-3.5" />
            </button>
        </Popover>
    );
}
