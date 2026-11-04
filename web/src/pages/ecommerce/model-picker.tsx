import { App, Button, Modal, Select, Switch } from "antd";
import { Check, Images, Search, Trash2, ZoomIn } from "lucide-react";
import { useState } from "react";
import { resourceStorageKey } from "@/services/api/resources";
import { CachedResourceImage } from "@/components/cached-resource-image";
import type { EcommerceReference } from "@/services/api/ecommerce";
import { commerceModelCatalog, commerceModelById, type CommerceModelProfile } from "./model-catalog";
import "./model-picker.css";

type Props = {
    enabled: boolean;
    references: EcommerceReference[];
    primaryId?: string;
    uploading: boolean;
    onEnabledChange: (enabled: boolean) => void;
    onUpload: (files: FileList | null) => void;
    onAddCatalog: (profile: CommerceModelProfile) => Promise<void>;
    onRemove: (resourceId: string) => void;
    onPrimary: (resourceId: string) => void;
};

export function EcommerceModelPicker({ enabled, references, primaryId, uploading, onEnabledChange, onUpload, onAddCatalog, onRemove, onPrimary }: Props) {
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const [preview, setPreview] = useState<CommerceModelProfile | null>(null);
    const [kind, setKind] = useState("all");
    const [gender, setGender] = useState("all");
    const [age, setAge] = useState("all");
    const [country, setCountry] = useState("all");
    const [adding, setAdding] = useState("");
    const visible = commerceModelCatalog.filter((item) => (kind === "all" || item.kind === kind) && (gender === "all" || item.gender === gender) && (age === "all" || item.age === age) && (country === "all" || item.country === country));
    const add = async (profile: CommerceModelProfile) => {
        if (references.some((ref) => ref.catalogId === profile.id)) return;
        setAdding(profile.id);
        try {
            await onAddCatalog(profile);
            message.success(`已添加 ${profile.name}`);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "添加模特失败");
        } finally {
            setAdding("");
        }
    };
    return (
        <section className="ecommerce-model-picker" aria-label="模特参考图">
            <div className="ecommerce-model-heading">
                <strong>模特参考图</strong>
                <div>
                    <span>启用模特</span>
                    <Switch aria-label="启用模特" checked={enabled} onChange={onEnabledChange} />
                    <Button size="small" icon={<Images size={14} />} onClick={() => setOpen(true)}>
                        案例库
                    </Button>
                </div>
            </div>
            {enabled ? (
                <>
                    <p className="ecommerce-model-hint">可上传真人或假人，也可从案例库选择。未选择时 Agent 会在需要人物的图片提示词中设计合适模特；白底、规格、材质等图片不强制出现人物。</p>
                    <div className="ecommerce-model-refs">
                        {references.map((ref) => (
                            <div className="ecommerce-model-ref" key={ref.resourceId}>
                                <CachedResourceImage
                                    storageKey={resourceStorageKey(ref.resourceId)}
                                    alt={ref.name || "模特参考图"}
                                    loading="lazy"
                                    decoding="async"
                                    fallback={<span className="ecommerce-model-ref-image-fallback" aria-label="图片暂不可用" />}
                                    loadingFallback={<span className="ecommerce-model-ref-image-fallback" aria-label="正在读取图片" />}
                                />
                                <div>
                                    <strong>{ref.name || commerceModelById(ref.catalogId)?.name || "自定义模特"}</strong>
                                    <Button type="text" size="small" aria-label={`移除 ${ref.name || "模特"}`} icon={<Trash2 size={13} />} onClick={() => onRemove(ref.resourceId)} />
                                </div>
                                <Select
                                    size="small"
                                    aria-label={`${ref.name || "模特"}的角色`}
                                    value={primaryId === ref.resourceId ? "primary" : "support"}
                                    options={[
                                        { value: "primary", label: "主模特 · 全套贯穿" },
                                        { value: "support", label: "辅助模特 · 仅多人画面" },
                                    ]}
                                    onChange={(value) => {
                                        if (value === "primary") onPrimary(ref.resourceId);
                                        else if (primaryId === ref.resourceId) onPrimary(references.find((item) => item.resourceId !== ref.resourceId)?.resourceId || ref.resourceId);
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                    <label className="ecommerce-model-upload">
                        {uploading ? "上传中…" : "+ 上传模特参考图"}
                        <input
                            type="file"
                            aria-label="上传模特参考图"
                            accept="image/png,image/jpeg,image/webp"
                            multiple
                            disabled={uploading}
                            onChange={(event) => {
                                onUpload(event.target.files);
                                event.target.value = "";
                            }}
                        />
                    </label>
                </>
            ) : (
                <p className="ecommerce-model-hint">关闭时，策划与生成均不使用模特参考图。</p>
            )}
            <Modal title="模特案例库 · 三视图与细节" open={open} onCancel={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>完成</Button>} width={1000} destroyOnHidden>
                <p className="ecommerce-model-hint">首批覆盖中国、美国、印度、日本和欧洲市场。每张 16:9 角色卡包含正面、侧面、斜侧或背面与细节，可多选。</p>
                <div className="ecommerce-model-filters">
                    <Select
                        aria-label="角色类型"
                        value={kind}
                        onChange={setKind}
                        options={[
                            { value: "all", label: "真人与假人" },
                            { value: "person", label: "真人模特" },
                            { value: "mannequin", label: "服装假人" },
                        ]}
                    />
                    <Select
                        aria-label="性别"
                        value={gender}
                        onChange={setGender}
                        options={[
                            { value: "all", label: "不限性别" },
                            { value: "female", label: "女" },
                            { value: "male", label: "男" },
                        ]}
                    />
                    <Select
                        aria-label="年龄"
                        value={age}
                        onChange={setAge}
                        options={[
                            { value: "all", label: "不限年龄" },
                            { value: "child", label: "儿童" },
                            { value: "adult", label: "成人" },
                            { value: "mature", label: "银发" },
                        ]}
                    />
                    <Select aria-label="国家和地区" value={country} onChange={setCountry} options={[{ value: "all", label: "全部市场" }, ...[...new Set(commerceModelCatalog.map((item) => item.country))].map((value) => ({ value, label: value }))]} />
                </div>
                <div className="ecommerce-model-grid">
                    {visible.map((item) => {
                        const selected = references.some((ref) => ref.catalogId === item.id);
                        return (
                            <article className="ecommerce-model-card" key={item.id}>
                                <div className="ecommerce-model-card-image">
                                    <button type="button" className="ecommerce-model-image-open" aria-label={`放大查看 ${item.name}`} onClick={() => setPreview(item)}>
                                        <img src={item.image} alt={`${item.name}三视图及细节`} loading="lazy" />
                                    </button>
                                    <div className="ecommerce-model-card-actions">
                                        <Button icon={<ZoomIn size={14} />} onClick={() => setPreview(item)}>
                                            放大
                                        </Button>
                                        <Button type={selected ? "default" : "primary"} icon={selected ? <Check size={14} /> : <Search size={14} />} loading={adding === item.id} disabled={selected || Boolean(adding)} onClick={() => void add(item)}>
                                            {selected ? "已选定" : "选定"}
                                        </Button>
                                    </div>
                                </div>
                                <strong>{item.name}</strong>
                                <small>{item.description}</small>
                            </article>
                        );
                    })}
                </div>
            </Modal>
            <Modal
                title={preview?.name || "模特预览"}
                open={Boolean(preview)}
                onCancel={() => setPreview(null)}
                footer={
                    preview ? (
                        <Button type="primary" disabled={references.some((ref) => ref.catalogId === preview.id)} loading={adding === preview.id} onClick={() => void add(preview)}>
                            {references.some((ref) => ref.catalogId === preview.id) ? "已选定" : "选定此模特"}
                        </Button>
                    ) : null
                }
                width={1120}
            >
                {preview ? <img className="ecommerce-model-preview" src={preview.image} alt={`${preview.name}正面、侧面、斜侧和细节`} /> : null}
            </Modal>
        </section>
    );
}
