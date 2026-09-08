import { Image } from "antd";

type CanvasImagePreviewProps = {
    src: string;
    alt?: string;
    onClose: () => void;
};

export function CanvasImagePreview({ src, alt = "图片", onClose }: CanvasImagePreviewProps) {
    if (!src) return null;

    return (
        <Image
            src={src}
            alt={alt}
            style={{ display: "none" }}
            preview={{
                open: true,
                movable: true,
                minScale: 0.5,
                maxScale: 12,
                scaleStep: 0.25,
                onOpenChange: (open) => !open && onClose(),
            }}
        />
    );
}
