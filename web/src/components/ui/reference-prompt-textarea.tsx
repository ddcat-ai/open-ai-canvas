import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { resolveResourceVariantUrl, resourceStorageKey } from "@/services/api/resources";

export type PromptReference = { resourceId: string; label: string; name?: string; kind?: "image" | "audio" };

export function imagePromptReferences(items: ReadonlyArray<{ resourceId: string; name?: string }>, prefix = "图片"): PromptReference[] {
    return items.flatMap((item, index) => (item.resourceId ? [{ ...item, label: `${prefix}${index + 1}` }] : []));
}

type Props = Omit<ComponentPropsWithoutRef<typeof CanvasResourceMentionTextarea>, "references"> & { materials: PromptReference[] };

export const ReferencePromptTextarea = forwardRef<HTMLTextAreaElement, Props>(function ReferencePromptTextarea({ materials, placeholder, ...props }, ref) {
    return (
        <CanvasResourceMentionTextarea
            {...props}
            ref={ref}
            highlightLabels={false}
            containerClassName={props.containerClassName || "h-auto"}
            mentionMenuLabels={{ connected: "已上传素材", search: "搜索素材" }}
            placeholder={materials.length && placeholder ? `${placeholder}（输入 @ 引用素材）` : placeholder}
            references={materials.map(({ resourceId, label, name, kind = "image" }) => ({
                id: `prompt:${label}:${resourceId}`,
                nodeId: `prompt:${resourceId}`,
                kind,
                label,
                title: name || label,
                active: true,
                mentionToken: `@${label}`,
                previewUrl: kind === "image" ? resolveResourceVariantUrl(resourceStorageKey(resourceId), "thumbnail") : undefined,
            }))}
        />
    );
});
