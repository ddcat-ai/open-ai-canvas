import { useState } from "react";
import { InputNumber } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { MAX_IMAGE_GRID, planImageTiles, type ImageSplitParams } from "@/lib/canvas/image-operation-plan";
import { useImageToolSource } from "./use-image-tool-source";

export type CanvasImageSplitParams = ImageSplitParams;
type SplitDialogProps = { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageSplitParams) => void };

export function CanvasNodeSplitDialog(props: SplitDialogProps) {
    return props.open && props.dataUrl ? <SplitEditor key={props.dataUrl} {...props} /> : null;
}

function SplitEditor({ dataUrl, onClose, onConfirm }: SplitDialogProps) {
    const [grid, setGrid] = useState<ImageSplitParams>({ rows: 2, columns: 2 });
    const { size, error } = useImageToolSource(dataUrl);
    const valid = size !== null && size.width >= grid.columns && size.height >= grid.rows;
    const tiles = valid ? planImageTiles(size, grid) : [];
    const previewSize = tiles[0];
    const updateCount = (axis: keyof ImageSplitParams, value: number | null) => {
        if (value === null || !Number.isFinite(value)) return;
        setGrid((previous) => ({ ...previous, [axis]: Math.min(MAX_IMAGE_GRID, Math.max(1, Math.round(value))) }));
    };
    return (
        <AppModal open title="宫格切分" width={780} centered onCancel={onClose} okText={`生成 ${grid.rows * grid.columns} 个子节点`} onOk={() => valid && onConfirm(grid)} okButtonProps={{ disabled: !valid }}>
            <p className="mb-4 text-sm text-muted-foreground">按行、列拆分原图，子节点保持网格顺序。</p>
            <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                <figure className="m-0 flex min-w-0 flex-col items-center gap-3 rounded-lg border border-border bg-surface-active p-3">
                    <div className="relative max-w-full overflow-hidden">
                        <img alt="待切分图片" src={dataUrl} draggable={false} className="block max-h-[340px] max-w-full object-contain" />
                        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                            {Array.from({ length: grid.columns - 1 }, (_, i) => (
                                <line key={`v${i}`} x1={(100 * (i + 1)) / grid.columns} x2={(100 * (i + 1)) / grid.columns} y1={0} y2={100} stroke="white" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            ))}
                            {Array.from({ length: grid.rows - 1 }, (_, i) => (
                                <line key={`h${i}`} y1={(100 * (i + 1)) / grid.rows} y2={(100 * (i + 1)) / grid.rows} x1={0} x2={100} stroke="white" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            ))}
                        </svg>
                    </div>
                    <figcaption className="text-sm text-muted-foreground">{size ? `${size.width} × ${size.height} px` : error || "正在读取图片…"}</figcaption>
                </figure>
                <div className="flex flex-col gap-4">
                    {(["rows", "columns"] as const).map((axis) => (
                        <label key={axis} className="flex flex-col gap-2 text-sm">
                            {axis === "rows" ? "行数" : "列数"}
                            <InputNumber aria-label={axis === "rows" ? "切分行数" : "切分列数"} min={1} max={MAX_IMAGE_GRID} precision={0} value={grid[axis]} onChange={(value) => updateCount(axis, value)} />
                        </label>
                    ))}
                    <output className="text-sm text-muted-foreground">{previewSize ? `每块约 ${previewSize.width} × ${previewSize.height} px；边缘像素会完整保留。` : "等待有效图片尺寸"}</output>
                    {error || (size && !valid) ? (
                        <p role="alert" className="text-sm text-destructive">
                            {error || "行列数超过图片像素尺寸，请减少切分数量"}
                        </p>
                    ) : null}
                </div>
            </div>
        </AppModal>
    );
}
