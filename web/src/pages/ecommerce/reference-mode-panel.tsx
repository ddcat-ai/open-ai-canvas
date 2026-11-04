import { Select } from "antd";
import { Images, LoaderCircle, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { EcommerceDraft, EcommerceReference, EcommerceReferenceMode, EcommerceReferenceScreen } from "@/services/api/ecommerce";
import { resourceStorageKey } from "@/services/api/resources";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { COMMERCE_IMAGE_ACCEPT, mightContainCommerceImage, readCommerceImageTransfer, type CommerceImageTransfer } from "./image-transfer";

const modeOptions: Array<{ value: EcommerceReferenceMode; label: string; description: string }> = [
    { value: "product", label: "商品自主策划", description: "根据商品图和已确认资料，自主设计卖点、场景、文案与画面。" },
    { value: "style", label: "参考风格与排版", description: "借鉴下方图片的色彩、构图与排版，用上方自己的商品和已核实资料重新策划。" },
    { value: "detail", label: "长图详情页逐屏参考", description: "按上传顺序识别每张长图中每一屏的内容、排版与画面，逐屏策划生成。" },
];
const uploadLabels: Record<EcommerceReferenceMode, string> = { product: "商品图", style: "风格与排版参考图", detail: "逐屏参考长图" };
const fallbackNames: Record<EcommerceReferenceMode, string> = { product: "商品参考图", style: "风格参考图", detail: "详情长图" };

function referenceName(reference: EcommerceReference, mode: EcommerceReferenceMode, index?: number) {
    const name = reference.name?.trim() || "";
    const stem = name.replace(/\.[a-z0-9]{2,8}$/i, "");
    const opaque =
        !name || name === reference.resourceId || (reference.resourceId.length >= 16 && name.includes(reference.resourceId)) || /[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/i.test(name) || /^(?:resource:)?[a-f\d]{24,64}$/i.test(stem);
    return opaque ? `${fallbackNames[mode]}${index == null ? "" : ` ${index + 1}`}` : name;
}

function ReferenceThumbnail({ reference, name }: { reference: EcommerceReference; name: string }) {
    return (
        <CachedResourceImage
            storageKey={resourceStorageKey(reference.resourceId)}
            variant="thumbnail"
            alt={name}
            loading="lazy"
            decoding="async"
            fallback={
                <span className="ecommerce-reference-thumbnail-empty" aria-label="图片暂不可用">
                    <Images size={22} />
                </span>
            }
            loadingFallback={
                <span className="ecommerce-reference-thumbnail-empty" aria-label="正在读取图片">
                    <LoaderCircle size={18} />
                </span>
            }
        />
    );
}

export function ReferenceModePanel({
    draft,
    onChange,
    onUpload,
    uploading = false,
    uploadProgress,
}: {
    draft: EcommerceDraft;
    onChange: (patch: Partial<EcommerceDraft>) => void;
    onUpload: (source: CommerceImageTransfer, mode: EcommerceReferenceMode) => Promise<void>;
    uploading?: boolean;
    uploadProgress?: string;
}) {
    const fileInput = useRef<HTMLInputElement>(null);
    const mounted = useRef(false);
    const lock = useRef(false);
    const depth = useRef(0);
    const lastUpload = useRef<{ source: CommerceImageTransfer; mode: EcommerceReferenceMode } | undefined>(undefined);
    const [pending, setPending] = useState(false);
    const [batchProgress, setBatchProgress] = useState("");
    const [dragging, setDragging] = useState(false);
    const [error, setError] = useState("");
    const helpId = useId();
    const busy = uploading || pending;
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const mode = modeOptions.find((option) => option.value === draft.referenceMode) || modeOptions[0];
    const references = draft.layoutReferences || [];
    const label = uploadLabels[mode.value];

    const chooseMode = (value: EcommerceReferenceMode) => {
        if (busy || lock.current) return;
        setError("");
        lastUpload.current = undefined;
        onChange({ referenceMode: value, ...(value === "detail" ? { imageType: "detail" } : {}) });
    };
    const removeReference = (index: number) => {
        if (busy || lock.current) return;
        setError("");
        lastUpload.current = undefined;
        onChange({ layoutReferences: references.filter((_, position) => position !== index) });
    };
    const upload = async (source: CommerceImageTransfer, uploadMode = mode.value) => {
        if (!mounted.current || uploading || lock.current) return;
        if (!source.files.length && !source.resourceId && !source.url) {
            lastUpload.current = undefined;
            setError("没有读取到图片，请选择图片文件或复制图片后粘贴");
            return;
        }
        lock.current = true;
        setPending(true);
        setError("");
        lastUpload.current = undefined;
        const items: CommerceImageTransfer[] = source.files.length ? source.files.map((file) => ({ files: [file] })) : [source];
        const failed: CommerceImageTransfer[] = [];
        const messages: string[] = [];
        try {
            for (const [index, item] of items.entries()) {
                if (!mounted.current) return;
                const name = item.files[0]?.name || item.name || uploadLabels[uploadMode];
                setBatchProgress(`正在添加 ${index + 1}/${items.length} · ${name}`);
                try {
                    await onUpload(item, uploadMode);
                } catch (cause) {
                    if (!mounted.current) return;
                    failed.push(item);
                    messages.push(`${name}：${cause instanceof Error ? cause.message : "图片上传失败，请重试"}`);
                }
                if (!mounted.current) return;
            }
            if (failed.length) {
                lastUpload.current = { source: source.files.length ? { files: failed.flatMap((item) => item.files) } : source, mode: uploadMode };
                setError(`${items.length - failed.length ? `已添加 ${items.length - failed.length} 张，` : ""}${failed.length} 张图片未添加。${messages.join("；")}`);
            }
        } finally {
            lock.current = false;
            if (mounted.current) {
                setPending(false);
                setBatchProgress("");
            }
        }
    };
    return (
        <section className="ecommerce-reference-mode" aria-label="参考方式设置">
            <Select<EcommerceReferenceMode> variant="filled" aria-label="参考方式" value={mode.value} options={modeOptions.map(({ value, label }) => ({ value, label }))} onChange={chooseMode} disabled={busy} />
            {mode.value === "product" ? (
                <p className="ecommerce-reference-mode-description">使用上方“自己的商品图”自主策划卖点、场景与文案，无需上传借鉴图片。</p>
            ) : (
                <>
                    <p className="ecommerce-reference-mode-description">{mode.description}</p>
                    <div
                        className={`ecommerce-reference-upload${dragging ? " is-dragging" : ""}`}
                        role="group"
                        aria-label={`${label}上传区`}
                        aria-busy={busy}
                        aria-describedby={helpId}
                        tabIndex={0}
                        onDragEnter={(event) => {
                            if (!mightContainCommerceImage(event.dataTransfer)) return;
                            event.preventDefault();
                            depth.current += 1;
                            setDragging(true);
                        }}
                        onDragOver={(event) => {
                            if (!mightContainCommerceImage(event.dataTransfer)) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = busy ? "none" : "copy";
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
                            void upload(readCommerceImageTransfer(event.dataTransfer));
                        }}
                        onPaste={(event) => {
                            if ((event.target as HTMLElement).closest('textarea,input:not([type="file"]),[contenteditable="true"]')) return;
                            const source = readCommerceImageTransfer(event.clipboardData);
                            if (!source.files.length && !source.resourceId && !source.url) return;
                            event.preventDefault();
                            event.stopPropagation();
                            void upload(source);
                        }}
                    >
                        {references.length ? (
                            <ol className="ecommerce-reference-gallery" aria-label="已上传借鉴图片">
                                {references.map((reference, index) => {
                                    const name = referenceName(reference, mode.value, index);
                                    return (
                                        <li key={`${reference.resourceId}:${index}`}>
                                            <ReferenceThumbnail reference={reference} name={name} />
                                            <span className="ecommerce-reference-gallery-name" title={name}>
                                                <small>{index + 1}</small>
                                                {name}
                                            </span>
                                            <button type="button" aria-label={`移除${name}`} title={`移除${name}`} disabled={busy} onClick={() => removeReference(index)}>
                                                <X size={13} aria-hidden="true" />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ol>
                        ) : null}
                        <button type="button" className="ecommerce-reference-upload-button" disabled={busy} aria-label={`上传${label}`} onClick={() => fileInput.current?.click()}>
                            <Upload size={25} strokeWidth={1.5} aria-hidden="true" />
                            <span>
                                <strong>{references.length ? `继续添加${label}` : `点击上传${label}`}</strong>
                                <small>{busy ? "正在上传…" : dragging ? "松开添加图片" : "支持多张 · 也可拖入或粘贴图片"}</small>
                            </span>
                        </button>
                        <input
                            ref={fileInput}
                            type="file"
                            multiple
                            hidden
                            aria-label={`上传${label}文件`}
                            accept={COMMERCE_IMAGE_ACCEPT}
                            disabled={busy}
                            onChange={(event) => {
                                const files = Array.from(event.target.files || []);
                                event.target.value = "";
                                if (files.length) void upload({ files });
                            }}
                        />
                    </div>
                    <p id={helpId} className="ecommerce-reference-upload-help">
                        只放需要借鉴的图片，全部按上传顺序使用；参考图中未经核实的规格、性能与承诺不会移用。
                    </p>
                    {busy ? (
                        <p className="ecommerce-reference-upload-status" role="status">
                            <LoaderCircle size={13} className="commerce-planning-spin" />
                            {batchProgress || uploadProgress || "正在添加图片…"}
                        </p>
                    ) : null}
                    {error ? (
                        <div className="ecommerce-reference-upload-error" role="alert">
                            <span>{error}</span>
                            {lastUpload.current ? (
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                        if (lastUpload.current) void upload(lastUpload.current.source, lastUpload.current.mode);
                                    }}
                                >
                                    重试上传
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                    {!references.length ? (
                        <p className="sr-only" role="status">
                            请在这里上传需要借鉴的图片；自己的商品图请放在上方。
                        </p>
                    ) : null}
                </>
            )}
        </section>
    );
}

export function ReferenceScreenSummary({ screen }: { screen?: EcommerceReferenceScreen }) {
    if (!screen) return null;
    return (
        <div className="ecommerce-reference-screen-summary" aria-label={`原长图第 ${screen.screenIndex} 屏识别`}>
            <strong>原长图 · 第 {screen.screenIndex} 屏</strong>
            {screen.resourceId ? (
                <CachedResourceImage
                    className="ecommerce-reference-screen-preview"
                    storageKey={resourceStorageKey(screen.resourceId)}
                    variant="thumbnail"
                    alt={`原长图第 ${screen.screenIndex} 屏参考`}
                    loading="lazy"
                    decoding="async"
                    fallback={
                        <span className="ecommerce-reference-thumbnail-empty" aria-label="图片暂不可用">
                            <Images size={22} />
                        </span>
                    }
                    loadingFallback={
                        <span className="ecommerce-reference-thumbnail-empty" aria-label="正在读取图片">
                            <LoaderCircle size={18} />
                        </span>
                    }
                />
            ) : null}
            <dl>
                <div>
                    <dt>内容</dt>
                    <dd>{screen.content}</dd>
                </div>
                <div>
                    <dt>排版</dt>
                    <dd>{screen.layout}</dd>
                </div>
                <div>
                    <dt>画面</dt>
                    <dd>{screen.visual}</dd>
                </div>
            </dl>
            {screen.sourceCopy ? (
                <details>
                    <summary>查看原图文字</summary>
                    <p>{screen.sourceCopy}</p>
                </details>
            ) : null}
        </div>
    );
}
