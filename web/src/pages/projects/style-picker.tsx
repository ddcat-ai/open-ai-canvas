import { useMemo, useState } from "react";
import { Check, Flame, Info, Search, X } from "lucide-react";

import {
    DRAMA_STYLE_CATEGORIES,
    DRAMA_STYLE_FORMS,
    DRAMA_STYLE_THEMES,
    filterDramaStyles,
    findDramaStyle,
    getDramaStyleComposition,
    parseDramaStyleId,
    styleCoverBackground,
    updateDramaStyleComposition,
    type DramaStyleCategory,
    type DramaStyleFormId,
    type DramaStyleThemeId,
} from "@/lib/drama/drama-styles";

import { DramaStyleDetailModal } from "./style-detail-modal";
import "./style-composition.css";

type CategoryKey = "all" | "hot" | DramaStyleCategory;
export type StyleCompositionPickerProps = { value: string; onChange: (id: string) => void; disabled?: boolean; compact?: boolean };

/** 紧凑模式供造型编辑复用；受控值仍是可持久化的 styleId，不保存额外的轴状态。 */
export function StyleCompositionPicker({ value, onChange, disabled = false, compact = true }: StyleCompositionPickerProps) {
    const composition = getDramaStyleComposition(value);
    const selected = findDramaStyle(value);
    const preset = Boolean(selected && !parseDramaStyleId(value));
    const disabledReason = disabled ? "正在保存或生成，请稍候再调整风格" : undefined;
    const selectForm = (formId: DramaStyleFormId) => onChange(updateDramaStyleComposition(value, { formId }));
    const selectTheme = (themeId: DramaStyleThemeId) => onChange(updateDramaStyleComposition(value, { themeId }));

    return (
        <div className={`drama-style-composition${compact ? " is-compact" : ""}`}>
            {preset ? <p className="drama-style-composition-note">当前使用预设「{selected?.name}」。下方为对应的组合起点，修改任一项后应用新的自由组合。</p> : null}
            {compact ? (
                <div className="drama-style-composition-fields">
                    <label className="drama-style-composition-field" title={disabledReason}>
                        <span>表现形式</span>
                        <select aria-label="表现形式" value={composition?.formId || ""} disabled={disabled} onChange={(event) => selectForm(event.target.value as DramaStyleFormId)}>
                            <option value="" disabled>
                                选择表现形式
                            </option>
                            {DRAMA_STYLE_FORMS.map((form) => (
                                <option key={form.id} value={form.id}>
                                    {form.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="drama-style-composition-field" title={disabledReason}>
                        <span>题材</span>
                        <select aria-label="题材" value={composition?.themeId || ""} disabled={disabled} onChange={(event) => selectTheme(event.target.value as DramaStyleThemeId)}>
                            <option value="" disabled>
                                选择题材
                            </option>
                            {DRAMA_STYLE_THEMES.map((theme) => (
                                <option key={theme.id} value={theme.id}>
                                    {theme.name}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            ) : (
                <>
                    <fieldset className="drama-style-composition-axis" disabled={disabled}>
                        <legend>
                            表现形式 <span>决定画面如何呈现</span>
                        </legend>
                        <div className="drama-style-composition-forms" role="group" aria-label="表现形式">
                            {DRAMA_STYLE_FORMS.map((form) => (
                                <button key={form.id} type="button" className="drama-style-composition-form" aria-pressed={composition?.formId === form.id} disabled={disabled} title={disabledReason || form.description} onClick={() => selectForm(form.id)}>
                                    <strong>{form.name}</strong>
                                    <span>{form.description}</span>
                                </button>
                            ))}
                        </div>
                    </fieldset>
                    <fieldset className="drama-style-composition-axis" disabled={disabled}>
                        <legend>
                            题材 <span>决定世界、色调与服化道</span>
                        </legend>
                        <div className="drama-style-composition-themes" role="group" aria-label="题材">
                            {DRAMA_STYLE_THEMES.map((theme) => (
                                <button
                                    key={theme.id}
                                    type="button"
                                    className="drama-style-composition-theme"
                                    aria-pressed={composition?.themeId === theme.id}
                                    disabled={disabled}
                                    title={disabledReason || theme.description}
                                    onClick={() => selectTheme(theme.id)}
                                >
                                    {theme.name}
                                </button>
                            ))}
                        </div>
                    </fieldset>
                </>
            )}
            <p className="drama-style-composition-selection" role="status">
                {selected ? (
                    <>
                        当前{preset ? "预设" : "组合"} <strong>{selected.name}</strong>
                    </>
                ) : (
                    "选择表现形式与题材，自由组合视觉风格"
                )}
            </p>
        </div>
    );
}

/** 自由组合是主入口，预设库保留为折叠的快捷入口。 */
export function DramaStylePicker({ value, onChange, disabled = false }: Omit<StyleCompositionPickerProps, "compact">) {
    const [category, setCategory] = useState<CategoryKey>("hot");
    const [query, setQuery] = useState("");
    const styles = useMemo(() => filterDramaStyles(query ? "all" : category, query), [category, query]);
    const selected = findDramaStyle(value);
    const [detailId, setDetailId] = useState<string | null>(null);
    const counts = useMemo(() => Object.fromEntries(DRAMA_STYLE_CATEGORIES.map((item) => [item.key, filterDramaStyles(item.key, "").length])), []);
    return (
        <section className="drama-styles">
            <div className="drama-styles-head">
                <div className="min-w-0">
                    <h2>视觉风格</h2>
                    <p>表现形式与题材可分别选择，统一全剧角色、场景和镜头的画风</p>
                </div>
                {selected ? (
                    <button type="button" className="drama-styles-detail-link" onClick={() => setDetailId(selected.id)}>
                        查看风格详情
                    </button>
                ) : null}
            </div>
            <StyleCompositionPicker value={value} onChange={onChange} disabled={disabled} compact={false} />
            <details className="drama-style-presets">
                <summary>
                    风格预设 <span>可选快捷入口</span>
                </summary>
                <div className="drama-style-presets-body">
                    <label className="drama-search drama-styles-search">
                        <Search className="size-3.5 shrink-0 opacity-40" />
                        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索预设，如 霸总、仙侠" aria-label="搜索风格预设" />
                        {query ? (
                            <button type="button" onClick={() => setQuery("")} aria-label="清空搜索">
                                <X className="size-3.5 opacity-40" />
                            </button>
                        ) : null}
                    </label>
                    <div className="drama-styles-tabs" role="tablist" aria-label="风格预设分类">
                        {DRAMA_STYLE_CATEGORIES.map((item) => (
                            <button
                                key={item.key}
                                type="button"
                                role="tab"
                                aria-selected={!query && category === item.key}
                                className="drama-styles-tab"
                                onClick={() => {
                                    setQuery("");
                                    setCategory(item.key);
                                }}
                            >
                                {item.key === "hot" ? <Flame className="size-3.5" /> : null}
                                {item.label}
                                <span>{counts[item.key]}</span>
                            </button>
                        ))}
                    </div>
                    <div className="drama-style-grid thin-scrollbar" role="group" aria-label="风格预设">
                        {styles.map((style) => {
                            const active = style.id === value;
                            return (
                                <div key={style.id} className="drama-style" data-active={active || undefined}>
                                    <button type="button" aria-pressed={active} className="drama-style-pick" disabled={disabled} onClick={() => onChange(style.id)} title={disabled ? "正在保存，请稍候再调整风格" : style.description}>
                                        <span className="drama-style-swatch" style={{ background: styleCoverBackground(style) }}>
                                            {!style.cover ? (
                                                <span className="drama-style-glyph" aria-hidden>
                                                    {style.name.replace(/^3D\s*/, "").slice(0, 2)}
                                                </span>
                                            ) : null}
                                            {style.hot ? (
                                                <span className="drama-style-hot" title="爆款">
                                                    <Flame className="size-2.5" />
                                                </span>
                                            ) : null}
                                            {active ? (
                                                <span className="drama-style-check">
                                                    <Check className="size-3" />
                                                </span>
                                            ) : null}
                                            <span className="drama-style-overlay">
                                                <span className="drama-style-name">{style.name}</span>
                                                <span className="drama-style-tags">{style.tags.join(" · ")}</span>
                                            </span>
                                        </span>
                                    </button>
                                    <button type="button" className="drama-style-info" aria-label={`查看“${style.name}”详情`} title="查看详情" onClick={() => setDetailId(style.id)}>
                                        <Info className="size-3" />
                                    </button>
                                </div>
                            );
                        })}
                        {!styles.length ? <div className="col-span-full py-10 text-center text-[var(--fs-label)] text-foreground/45">没有找到“{query}”相关的风格</div> : null}
                    </div>
                </div>
            </details>
            <DramaStyleDetailModal
                styleId={detailId}
                selectedId={value}
                onClose={() => setDetailId(null)}
                onNavigate={setDetailId}
                navigationIds={styles.map((style) => style.id)}
                disabled={disabled}
                onUse={(id) => {
                    onChange(id);
                    setDetailId(null);
                }}
            />
        </section>
    );
}
