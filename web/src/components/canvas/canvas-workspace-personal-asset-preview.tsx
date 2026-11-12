import { useEffect, useState } from "react";
import { Modal } from "antd";
import { AudioLines, Box, FileText, Image as ImageIcon, UserRound, Video } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { AssetDrawer } from "@/pages/assets/asset-library-panels";
import { resolveMediaUrl } from "@/services/file-storage";
import type { Asset, AssetKind } from "@/stores/use-asset-store";

export function personalAssetIcon(kind: AssetKind) {
    return { audio: AudioLines, video: Video, image: ImageIcon, text: FileText, model: Box, entity: UserRound }[kind];
}

function PlayablePreview({ asset }: { asset: Extract<Asset, { kind: "audio" | "video" }> }) {
    const [url, setUrl] = useState("");
    const [error, setError] = useState(false);
    useEffect(() => {
        let active = true;
        setUrl("");
        setError(false);
        resolveMediaUrl(asset.data.storageKey, asset.data.url)
            .then((value) => {
                if (active) {
                    setUrl(value);
                    if (!value) setError(true);
                }
            })
            .catch(() => {
                if (active) setError(true);
            });
        return () => {
            active = false;
        };
    }, [asset.id, asset.data.storageKey, asset.data.url]);
    if (error) return <p role="alert">无法加载素材，请检查文件是否可访问。</p>;
    if (!url) return <p role="status">正在加载素材…</p>;
    return asset.kind === "audio" ? (
        <audio aria-label={asset.title} controls preload="metadata" src={url} onError={() => setError(true)} className="w-full" />
    ) : (
        <video aria-label={asset.title} controls playsInline preload="metadata" src={url} onError={() => setError(true)} className="max-h-[65vh] max-w-full" />
    );
}

export function CanvasWorkspacePersonalAssetPreview({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
    if (asset?.kind === "entity") return <AssetDrawer asset={asset} onClose={onClose} onCopy={() => {}} onDownload={() => {}} />;
    return (
        <Modal open={Boolean(asset)} title={asset?.title || "素材预览"} footer={null} onCancel={onClose} destroyOnHidden>
            {asset?.kind === "image" ? (
                <div className="flex min-h-32 justify-center">
                    <CachedResourceImage src={asset.data.dataUrl || asset.coverUrl} storageKey={asset.data.storageKey} alt={asset.title} eager className="max-h-[65vh] max-w-full object-contain" fallback={<p role="alert">图片资源不可用</p>} />
                </div>
            ) : null}
            {asset?.kind === "video" || asset?.kind === "audio" ? <PlayablePreview key={asset.id} asset={asset} /> : null}
            {asset?.kind === "text" ? <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words">{asset.data.content || "暂无内容"}</pre> : null}
            {asset?.kind === "model" ? <p>此文件暂不支持在线预览，请在素材库中查看。</p> : null}
        </Modal>
    );
}
