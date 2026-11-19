import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { ASSET_ASSIGNABLE_CATEGORY_OPTIONS } from "@/lib/asset-category";
import { ll2SaveImageAsset } from "@/services/ll2/ll2-assets";
import type { AssetCategory } from "@/stores/use-asset-store";

/** 首页拖进来 / 选中的那张图，等用户补标题、分类、标签后落进本机资产库。 */
export type LL2SaveAssetDraft = {
    file: File;
    dataUrl: string;
    name: string;
};

type Props = {
    draft: LL2SaveAssetDraft | null;
    onClose: () => void;
    onSaved: (result: { id: string; title: string }) => void;
};

/**
 * 「保存到资产库」弹窗。
 * 刻意不复用影策原版的新增素材弹窗：那边带方舟素材 ID、封面 URL、来源等等，
 * 免登录下用不到，还会把 antd 表单拖进首页首屏。这里只手写轻量表单。
 */
export function LL2SaveAssetDialog({ draft, onClose, onSaved }: Props) {
    const [title, setTitle] = useState("");
    const [category, setCategory] = useState<AssetCategory>("other");
    const [tagText, setTagText] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!draft) return;
        setTitle(draft.name);
        setCategory("other");
        setTags([]);
        setTagText("");
        setError("");
        setSaving(false);
    }, [draft]);

    if (!draft) return null;

    const addTag = () => {
        const next = tagText.trim().replace(/[,，]$/, "");
        if (!next) return;
        setTags((previous) => (previous.includes(next) ? previous : [...previous, next]));
        setTagText("");
    };

    const save = async () => {
        if (saving) return;
        setSaving(true);
        setError("");
        try {
            const result = await ll2SaveImageAsset(draft.file, {
                title: title.trim() || draft.name,
                category,
                tags,
            });
            onSaved({ id: result.id, title: result.title });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "保存失败，再试一次");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="ll2-save-asset-mask"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !saving) onClose();
            }}
        >
            <section className="ll2-save-asset-dialog" role="dialog" aria-modal="true" aria-label="保存到资产库">
                <header className="ll2-save-asset-head">
                    <strong>保存到资产库</strong>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="关闭">
                        <X className="size-4" aria-hidden />
                    </button>
                </header>

                <div className="ll2-save-asset-body">
                    <div className="ll2-save-asset-form">
                        <label>
                            <span>类型</span>
                            <input value="图片" readOnly />
                        </label>
                        <label>
                            <span>业务分类</span>
                            <select value={category} onChange={(event) => setCategory(event.target.value as AssetCategory)}>
                                {ASSET_ASSIGNABLE_CATEGORY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            <span>标题</span>
                            <input
                                value={title}
                                onChange={(event) => setTitle(event.target.value)}
                                placeholder="给素材起一个容易检索的名字"
                                autoFocus
                            />
                        </label>
                        <label>
                            <span>标签</span>
                            <input
                                value={tagText}
                                onChange={(event) => setTagText(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        addTag();
                                    }
                                }}
                                onBlur={addTag}
                                placeholder="输入标签后回车"
                            />
                        </label>
                        <div className="ll2-save-asset-tags">
                            {tags.length ? (
                                tags.map((tag) => (
                                    <button key={tag} type="button" onClick={() => setTags((previous) => previous.filter((item) => item !== tag))} title="点击移除">
                                        {tag}
                                    </button>
                                ))
                            ) : (
                                <em>还没打标签</em>
                            )}
                        </div>
                        {error ? (
                            <p className="ll2-save-asset-error" role="alert">
                                {error}
                            </p>
                        ) : null}
                    </div>

                    <aside className="ll2-save-asset-preview">
                        <span>预览</span>
                        <img src={draft.dataUrl} alt="" />
                        <strong>{title.trim() || "未命名素材"}</strong>
                        <div>
                            {tags.length ? (
                                tags.map((tag) => <em key={tag}>{tag}</em>)
                            ) : (
                                <em>未打标签</em>
                            )}
                        </div>
                    </aside>
                </div>

                <footer className="ll2-save-asset-foot">
                    <button type="button" onClick={onClose} disabled={saving}>
                        取消
                    </button>
                    <button type="button" className="is-primary" onClick={() => void save()} disabled={saving}>
                        {saving ? "正在保存" : "保存到资产库"}
                    </button>
                </footer>
            </section>
        </div>
    );
}
