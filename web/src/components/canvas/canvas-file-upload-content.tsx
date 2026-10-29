import { useSyncExternalStore, type CSSProperties } from "react";
import { AlertCircle, ImageUp, FileText, Film, Music2 } from "lucide-react";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { uploadPreviewClarity, uploadVeilOpacity } from "@/lib/canvas/canvas-file-upload";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { setUploadPreviewThumb, subscribeUploadPreviews, UPLOAD_THUMB_FAILED, uploadPreviewThumb, uploadPreviewUrl } from "@/services/canvas-upload-preview";
import { useCanvasNodeActions } from "./canvas-node-action-context";
import "./canvas-file-upload.css";

export function CanvasFileUploadContent({ node, theme, reduceMotion = false }: { node: CanvasNodeData; theme: CanvasTheme; reduceMotion?: boolean }) {
    const { upload } = useCanvasNodeActions();
    const failed = node.metadata?.fileUpload === "error";
    const percent = node.metadata?.fileUploadProgress;
    const saving = !failed && percent === 100;
    const label = node.type === CanvasNodeType.Image ? "图片" : node.type === CanvasNodeType.Video ? "视频" : node.type === CanvasNodeType.Audio ? "音频" : "文本";
    const Icon = failed ? AlertCircle : node.type === CanvasNodeType.Video ? Film : node.type === CanvasNodeType.Audio ? Music2 : node.type === CanvasNodeType.Text ? FileText : ImageUp;
    const previewUrl = failed ? "" : uploadPreviewUrl(node.id);
    // 磨砂底图异步生成，生成后只让这个节点重新渲染。
    const thumb = useSyncExternalStore(subscribeUploadPreviews, () => (failed ? "" : uploadPreviewThumb(node.id)), () => "");
    const detail = failed ? node.metadata?.errorDetails || "请重新选择文件上传" : saving ? "文件已传输，正在保存与处理" : percent !== undefined ? `已上传 ${percent}%` : "正在准备文件";
    const style = { "--upload-surface": theme.node.fill, "--upload-text": theme.node.text, "--upload-muted": theme.node.muted } as CSSProperties;
    const progressbar = !failed ? <span role="progressbar" aria-label={`${label}上传进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={detail} className="sr-only" /> : null;

    if (previewUrl) {
        // 有本地预览时不叠加卡片：极小尺寸放大的底图天然模糊（磨砂），清晰原图按真实进度淡入。
        // 只改不透明度，不对原图使用 CSS 模糊滤镜——后者在缩放画布时逐帧重新栅格化，会拖慢整个画布。
        // 底图生成失败时退回直接显示清晰原图，不让画面一直发暗。
        const thumbReady = Boolean(thumb) && thumb !== UPLOAD_THUMB_FAILED;
        const clarity = thumb === UPLOAD_THUMB_FAILED ? 1 : uploadPreviewClarity(percent);
        return (
            <div className="canvas-file-upload" data-preview="true" data-state={saving ? "saving" : "uploading"} data-static={reduceMotion || undefined} style={style}>
                {thumbReady ? <img className="canvas-file-upload-thumb" src={thumb} alt="" aria-hidden="true" draggable={false} /> : null}
                {node.type === CanvasNodeType.Video ? (
                    <video
                        className="canvas-file-upload-preview"
                        style={{ opacity: clarity }}
                        src={previewUrl}
                        muted
                        playsInline
                        preload="metadata"
                        aria-hidden="true"
                        tabIndex={-1}
                        onLoadedData={(event) => setUploadPreviewThumb(node.id, event.currentTarget, event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
                    />
                ) : (
                    <img className="canvas-file-upload-preview" style={{ opacity: clarity }} src={previewUrl} alt="" aria-hidden="true" decoding="async" draggable={false} />
                )}
                <span className="canvas-file-upload-chip" aria-hidden="true">
                    <span className="canvas-file-upload-chip-dot" />
                    {saving ? "处理中" : percent !== undefined ? `${percent}%` : "准备中"}
                </span>
                <span className="sr-only" role="status" aria-live="polite" aria-busy="true">{`正在上传${label}，${detail}`}</span>
                {progressbar}
            </div>
        );
    }

    return (
        <div className="canvas-file-upload" data-state={failed ? "error" : saving ? "saving" : "uploading"} data-static={reduceMotion || failed || undefined} style={style}>
            <div className="canvas-file-upload-glow" aria-hidden="true" style={{ opacity: uploadVeilOpacity(percent) }} />
            <div className="canvas-file-upload-frost" aria-hidden="true" style={{ opacity: uploadVeilOpacity(percent) }} />
            <div className="canvas-file-upload-copy" role="status" aria-live="polite" aria-busy={!failed}>
                <Icon className="size-5" aria-hidden="true" />
                <span className="canvas-file-upload-label">{failed ? `${label}上传未完成` : `正在上传${label}`}</span>
                <span className="canvas-file-upload-detail">{detail}</span>
                {progressbar}
                {failed && upload ? <button type="button" data-canvas-no-zoom className="canvas-file-upload-retry" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); upload(node); }}>重新选择文件</button> : null}
            </div>
        </div>
    );
}
