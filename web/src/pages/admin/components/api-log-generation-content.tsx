import { useId, useRef, useState } from "react";
import { Typography } from "antd";
import { FileImage, Film, ImageOff, Music2 } from "lucide-react";

import { adminApiLogReferenceMediaURL, type ApiLogGenerationContent as GenerationContent, type ApiLogGenerationReference } from "@/services/api/auth";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { splitApiLogPrompt } from "../logs/generation-content";

const mediaNames = { image: "图片", video: "视频", audio: "音频" } as const;
const mediaIcons = { image: FileImage, video: Film, audio: Music2 };

/** 仅消费该次请求的快照；媒体始终经过管理员日志接口读取原件。 */
export function ApiLogGenerationContent({ logId, content }: { logId: string; content?: GenerationContent }) {
    const prefix = useId();
    const cards = useRef(new Map<string, HTMLElement>());
    const [preview, setPreview] = useState<ApiLogGenerationReference | null>(null);
    const references = content?.references || [];
    const focusReference = (id: string) => {
        const card = cards.current.get(id);
        card?.scrollIntoView({ block: "nearest", inline: "nearest" });
        card?.focus({ preventScroll: true });
    };

    return (
        <section className="api-log-detail-section api-log-generation-section" aria-labelledby={`${prefix}-title`}>
            <div className="api-log-detail-section-heading">
                <div>
                    <div className="api-log-detail-eyebrow">GENERATED CONTENT</div>
                    <h2 id={`${prefix}-title`}>生成内容</h2>
                </div>
                {content?.prompt ? <Typography.Text copyable={{ text: content.prompt, tooltips: ["复制提示词", "已复制"] }}>复制提示词</Typography.Text> : null}
            </div>
            <div className="api-log-generation-body">
                <div className="api-log-generation-label">提示词</div>
                <div className="api-log-generation-prompt">
                    {content?.prompt ? (
                        splitApiLogPrompt(content.prompt, references).map((part, index) =>
                            part.type === "text" ? (
                                part.text
                            ) : (
                                <button key={index} type="button" className="api-log-generation-mention" aria-label={`${part.text} ${part.reference.name || part.reference.label}，定位参考素材`} onClick={() => focusReference(part.reference.id)}>
                                    <ReferenceIcon reference={part.reference} />
                                    <span>{part.text}</span>
                                </button>
                            ),
                        )
                    ) : (
                        <span className="api-log-generation-muted">该历史请求未保存可还原的提示词</span>
                    )}
                </div>
                {content?.incomplete || content?.note || !content ? <p className="api-log-generation-note">{content?.note || "该历史请求未完整保存原始参考素材，仅展示可以确认的内容。"}</p> : null}
                <div className="api-log-generation-reference-heading">
                    <span className="api-log-generation-label">参考素材</span>
                    <span className="api-log-generation-muted">共 {references.length} 件 · 编号与提示词对应</span>
                </div>
                {references.length ? (
                    <div className="api-log-generation-references">
                        {references.map((reference) => (
                            <article
                                key={reference.id}
                                className="api-log-generation-reference"
                                tabIndex={-1}
                                ref={(element) => {
                                    if (element) cards.current.set(reference.id, element);
                                    else cards.current.delete(reference.id);
                                }}
                                aria-label={`${reference.label} ${reference.name || mediaNames[reference.kind]}`}
                            >
                                <ReferenceMedia key={`${logId}:${reference.id}`} logId={logId} reference={reference} onPreview={() => setPreview(reference)} />
                                <div className="api-log-generation-reference-meta">
                                    <span className="api-log-generation-reference-label">@{reference.label.replace(/^@/, "")}</span>
                                    <span className="api-log-generation-reference-name" title={reference.name}>
                                        {reference.name || mediaNames[reference.kind]}
                                    </span>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <p className="api-log-generation-muted">{content?.incomplete || !content ? "没有保存可还原的原始参考素材" : "本次请求未使用参考素材"}</p>
                )}
            </div>
            {preview ? (
                <AdminModal open title={`${preview.label} · ${preview.name || "原始图片"}`} footer={null} width="min(1000px, 92vw)" onCancel={() => setPreview(null)} className="api-log-generation-image-modal">
                    <img src={adminApiLogReferenceMediaURL(logId, preview.id)} alt={preview.name || preview.label} referrerPolicy="no-referrer" className="api-log-generation-original-image" />
                </AdminModal>
            ) : null}
        </section>
    );
}

function ReferenceIcon({ reference }: { reference: ApiLogGenerationReference }) {
    const Icon = mediaIcons[reference.kind];
    return <Icon aria-hidden="true" className="size-3.5" />;
}

function ReferenceMedia({ logId, reference, onPreview }: { logId: string; reference: ApiLogGenerationReference; onPreview: () => void }) {
    const [failed, setFailed] = useState(false);
    const url = adminApiLogReferenceMediaURL(logId, reference.id);
    if (!reference.available || failed) {
        return (
            <div className="api-log-generation-media api-log-generation-unavailable">
                <ImageOff aria-hidden="true" />
                <span>{failed ? "原始素材读取失败" : reference.unavailableReason || "原始素材不可用"}</span>
            </div>
        );
    }
    if (reference.kind === "image") {
        return (
            <button type="button" className="api-log-generation-media api-log-generation-image" aria-label={`查看${reference.label}原图`} onClick={onPreview}>
                <img src={url} alt={reference.name || reference.label} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
            </button>
        );
    }
    if (reference.kind === "video") {
        return (
            <div className="api-log-generation-media">
                <video controls preload="none" playsInline src={url} aria-label={`${reference.label}原始视频`} onError={() => setFailed(true)} />
            </div>
        );
    }
    return (
        <div className="api-log-generation-media api-log-generation-audio">
            <Music2 aria-hidden="true" />
            <audio controls preload="none" src={url} aria-label={`${reference.label}原始音频`} onError={() => setFailed(true)} />
        </div>
    );
}
