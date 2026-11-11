import { CachedResourceImage } from "@/components/cached-resource-image";
import { AppModal } from "@/components/ui/product/app-modal";
import type { CanvasNodeData } from "@/types/canvas";
import { CanvasImageComparison } from "./canvas-image-comparison";

export function CanvasImageCompareModal({ nodes, onClose }: { nodes: [CanvasNodeData, CanvasNodeData]; onClose: () => void }) {
    const image = (node: CanvasNodeData) => <CachedResourceImage storageKey={node.metadata?.storageKey} src={node.metadata?.content} alt={node.title} eager draggable={false} className="block size-full object-contain" />;
    return (
        <AppModal open onCancel={onClose} title="对比图片" footer={null} width={940}>
            <div className="relative h-[min(65vh,640px)] overflow-hidden rounded-[var(--r-lg)] bg-[var(--media-surface)]">
                <CanvasImageComparison before={image(nodes[0])} after={image(nodes[1])} beforeLabel={nodes[0].title || "图片 A"} afterLabel={nodes[1].title || "图片 B"} />
            </div>
        </AppModal>
    );
}
