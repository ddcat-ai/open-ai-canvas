import { Plus, X } from "lucide-react";
import { Popover, Select } from "antd";
import { useRef, useState } from "react";
import { resourceFileUrl, resourceStorageKey } from "@/services/api/resources";
import { CachedResourceImage } from "@/components/cached-resource-image";
import type { EcommerceReference, EcommerceReferenceRole } from "@/services/api/ecommerce";
import { CommerceHint } from "./commerce-hint";
import { COMMERCE_IMAGE_ACCEPT, mightContainCommerceImage, readCommerceImageTransfer, writeCommerceImageTransfer, type CommerceImageTransfer } from "./image-transfer";
import "./reference-uploader.css";

export const referenceRoleOptions = [
    { value: "primary", label: "商品主图" },
    { value: "detail", label: "细节参考" },
    { value: "sku", label: "SKU 参考" },
    { value: "logo", label: "品牌 Logo" },
    { value: "package", label: "包装图" },
];

export function ReferenceUploader({
    references,
    uploading,
    uploadProgress,
    maxReferences = 24,
    compact = false,
    onUpload,
    onTransfer,
    onChange,
}: {
    references: EcommerceReference[];
    uploading: boolean;
    uploadProgress?: string;
    maxReferences?: number;
    compact?: boolean;
    onUpload: (files: File[]) => void | Promise<void>;
    onTransfer: (source: CommerceImageTransfer) => void | Promise<void>;
    onChange: (references: EcommerceReference[]) => void;
}) {
    const [dragging, setDragging] = useState(false);
    const [pending, setPending] = useState(false);
    const [previews, setPreviews] = useState<Array<{ name: string; url: string }>>([]);
    const [error, setError] = useState("");
    const lock = useRef(false);
    const depth = useRef(0);
    const busy = uploading || pending;
    const full = references.length >= maxReferences;
    const run = async (action: () => void | Promise<void>, files: File[] = []) => {
        if (uploading || lock.current) {
            setError("图片正在上传，请完成后再添加");
            return;
        }
        if (full) {
            setError("参考图片已达上限，请先移除部分图片");
            return;
        }
        lock.current = true;
        setPending(true);
        setError("");
        const nextPreviews = files.filter((file) => file.type.startsWith("image/")).map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
        setPreviews(nextPreviews);
        try {
            await action();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "图片添加失败，请重试");
        } finally {
            lock.current = false;
            setPending(false);
            setPreviews([]);
            nextPreviews.forEach((item) => URL.revokeObjectURL(item.url));
        }
    };
    const tiles = references.map((ref, index) => {
        const thumbnail = (
            <CachedResourceImage
                storageKey={resourceStorageKey(ref.resourceId)}
                alt={ref.name || "商品参考图"}
                loading="lazy"
                decoding="async"
                draggable
                onDragStart={(event) => writeCommerceImageTransfer(event.dataTransfer, { resourceId: ref.resourceId, name: ref.name || "商品参考图", url: resourceFileUrl(ref.resourceId) })}
                fallback={<span className="commerce-reference-item-image-fallback" aria-label="图片暂不可用" />}
                loadingFallback={<span className="commerce-reference-item-image-fallback" aria-label="正在读取图片" />}
            />
        );
        return (
            <div className="commerce-reference-item" key={`${ref.resourceId}-${index}`} title={compact ? undefined : ref.name || `商品参考图 ${index + 1}`}>
                {/* 紧凑模式缩略图很小，悬停时放大预览，便于确认上传的是哪张商品图。 */}
                {compact ? (
                    <Popover
                        placement="top"
                        arrow={false}
                        mouseEnterDelay={0.35}
                        classNames={{ root: "commerce-reference-preview-popover" }}
                        content={
                            <figure className="commerce-reference-preview">
                                <CachedResourceImage storageKey={resourceStorageKey(ref.resourceId)} alt={ref.name || "商品参考图预览"} decoding="async" />
                                <figcaption>{ref.name || `商品参考图 ${index + 1}`}</figcaption>
                            </figure>
                        }
                    >
                        <span className="commerce-reference-thumb">{thumbnail}</span>
                    </Popover>
                ) : (
                    thumbnail
                )}
                <div className="commerce-reference-item-actions">
                    {!compact ? (
                        <Select
                            aria-label={`第 ${index + 1} 张素材角色`}
                            size="small"
                            value={ref.role}
                            options={referenceRoleOptions}
                            disabled={busy}
                            popupMatchSelectWidth={180}
                            onChange={(role: EcommerceReferenceRole) => onChange(references.map((item, i) => (i === index ? { ...item, role } : item)))}
                        />
                    ) : null}
                    <CommerceHint text="从本次创作中移除这张商品参考图。">
                        <button className="commerce-reference-remove" type="button" aria-label={`移除第 ${index + 1} 张参考图`} disabled={busy} onClick={() => onChange(references.filter((_, i) => i !== index))}>
                            <X size={13} />
                        </button>
                    </CommerceHint>
                </div>
            </div>
        );
    });
    const addTile = (
        <CommerceHint text="上传本地商品主图或细节图，支持一次添加多张，也可直接拖入或粘贴。">
            <label className={`commerce-reference-add ${busy ? "is-uploading" : ""}`}>
                {busy ? <span className="commerce-reference-spinner" aria-hidden="true" /> : <Plus size={25} strokeWidth={1.5} aria-hidden="true" />}
                <span>{busy ? "上传中…" : full ? "参考图已满" : dragging ? "松开添加" : references.length ? "继续添加" : compact ? "商品图" : "上传或拖入商品图"}</span>
                <input
                    type="file"
                    aria-label="添加商品参考图"
                    accept={COMMERCE_IMAGE_ACCEPT}
                    multiple
                    disabled={busy || full}
                    onChange={(event) => {
                        const files = Array.from(event.target.files || []);
                        event.target.value = "";
                        if (files.length) void run(() => onUpload(files), files);
                    }}
                />
            </label>
        </CommerceHint>
    );
    return (
        <section
            className={`commerce-reference-dropzone${dragging ? " is-dragging" : ""}${compact ? " is-compact" : ""}`}
            aria-label="商品参考图片上传区"
            tabIndex={0}
            aria-busy={busy}
            aria-describedby="commerce-reference-help"
            onDragEnter={(event) => {
                if (!mightContainCommerceImage(event.dataTransfer)) return;
                event.preventDefault();
                depth.current += 1;
                setDragging(true);
            }}
            onDragOver={(event) => {
                if (!mightContainCommerceImage(event.dataTransfer)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = busy || full ? "none" : "copy";
            }}
            onDragLeave={() => {
                depth.current = Math.max(0, depth.current - 1);
                if (!depth.current) setDragging(false);
            }}
            onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                depth.current = 0;
                setDragging(false);
                const source = readCommerceImageTransfer(event.dataTransfer);
                void run(() => onTransfer(source), source.files);
            }}
            onPaste={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest('textarea,input:not([type="file"]),[contenteditable="true"],[role="combobox"]')) return;
                const source = readCommerceImageTransfer(event.clipboardData);
                if (!source.files.length && !source.resourceId && !source.url) return;
                event.preventDefault();
                event.stopPropagation();
                void run(() => onTransfer(source), source.files);
            }}
        >
            {/* 紧凑模式由外层区块提供标题与说明，这里不再重复。 */}
            {compact ? null : (
                <>
                    <strong>自己的商品图</strong>
                    <p className="commerce-reference-help">上传你的商品主图、细节、包装或 Logo，可一次添加多张。需要借鉴的风格与排版图片请放在下方。</p>
                </>
            )}
            <div className="commerce-reference-list" aria-label="商品参考图片">
                {compact ? addTile : null}
                {tiles}
                {previews.map((item, index) => (
                    <div className="commerce-reference-item is-pending" key={`${item.url}-${index}`}>
                        <img src={item.url} alt={`正在上传 ${item.name}`} />
                        <span className="commerce-reference-pending-pulse" aria-hidden="true" />
                    </div>
                ))}
                {!compact ? addTile : null}
            </div>
            <p id="commerce-reference-help" className={compact ? "sr-only" : "commerce-reference-help"}>
                可拖入微信、电脑、网页图片，或把右侧生成图拖到这里。点击此区域后按 Ctrl+V 粘贴图片。
            </p>
            {busy ? (
                <p className="commerce-reference-status" role="status">
                    {uploadProgress || "正在添加图片…"}
                </p>
            ) : null}
            {error ? (
                <p className="commerce-reference-error" role="alert">
                    {error}
                </p>
            ) : null}
        </section>
    );
}
