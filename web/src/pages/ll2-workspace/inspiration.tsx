import { ArrowRight, Heart, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import {
    LL2_INSPIRATIONS,
    LL2_INSPIRATION_GROUPS,
    LL2_INSPIRATION_TYPES,
    LL2_PROMPT_GROUPS,
    ll2AddCustomInspiration,
    ll2InspirationCost,
    ll2InspirationUseUrl,
    ll2ListCustomInspirations,
    ll2ListFavoriteInspirations,
    ll2RemoveCustomInspiration,
    ll2ToggleFavoriteInspiration,
    type LL2Inspiration,
    type LL2InspirationType,
} from "@/lib/ll2-workspace";

/**
 * 灵感广场 —— 照 yingce.tv 首页「灵感大厅」的形态，拆成左侧工作栏里的独立功能页。
 * 2026-11-18：补上官网那句「每天换一批推荐」，价格说明改成白话，助手改叫「聊天改稿」。
 */
export default function LL2Inspiration() {
    const [type, setType] = useState<string>("全部");
    const [group, setGroup] = useState<string>("全部");
    const [moreFilters, setMoreFilters] = useState(false);
    const [favorites, setFavorites] = useState<string[]>(() => ll2ListFavoriteInspirations());
    const [onlyFavorite, setOnlyFavorite] = useState(false);
    const [custom, setCustom] = useState<LL2Inspiration[]>(() => ll2ListCustomInspirations());
    const [detail, setDetail] = useState<LL2Inspiration | null>(null);
    const [creating, setCreating] = useState(false);
    const [draft, setDraft] = useState<{ title: string; prompt: string; group: LL2Inspiration["group"]; type: LL2InspirationType }>({
        title: "", prompt: "", group: "镜头", type: "video",
    });

    const all = useMemo(() => [...custom, ...LL2_INSPIRATIONS], [custom]);
    const countOf = (value: string) => value === "全部" ? all.length : all.filter((item) => item.type === (value === "视频" ? "video" : "text")).length;

    const list = useMemo(
        () => all.filter((item) =>
            (type === "全部" || item.type === (type === "视频" ? "video" : "text")) &&
            (group === "全部" || item.group === group) &&
            (!onlyFavorite || favorites.includes(item.id)),
        ),
        [all, type, group, onlyFavorite, favorites],
    );

    const saveDraft = () => {
        if (!draft.prompt.trim()) return;
        setCustom(ll2AddCustomInspiration(draft));
        setDraft({ title: "", prompt: "", group: "镜头", type: "video" });
        setCreating(false);
    };

    return (
        <div className="ll2-wb">
            <main className="ll2-wb-main is-wide">
                <header className="ll2-wb-page-head ll2-insp-head">
                    <div>
                        <span className="ll2-wb-eyebrow">灵感广场</span>
                        <h1>不知道写什么，就从这里开始</h1>
                        <p>每天换一批推荐，点击就能用里面的提示词接着创作。</p>
                        <p>每条都写清用哪个模型、多清楚、几秒、这一次大概花多少钱。</p>
                    </div>
                    <div className="ll2-insp-actions">
                        <button type="button" className="ll2-insp-new" onClick={() => setCreating((value) => !value)}>
                            <Plus className="size-4" /> 新建灵感
                        </button>
                        <button type="button" className={`ll2-wb-fav-toggle ${onlyFavorite ? "is-active" : ""}`} onClick={() => setOnlyFavorite((value) => !value)}>
                            <Heart className="size-3.5" /> 只看收藏 {favorites.length ? `(${favorites.length})` : ""}
                        </button>
                    </div>
                </header>

                {creating ? (
                    <div className="ll2-insp-form">
                        <div className="ll2-insp-form-row">
                            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="给这条灵感起个名字" aria-label="灵感标题" />
                            <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as LL2InspirationType })} aria-label="灵感类型">
                                <option value="video">视频灵感</option>
                                <option value="text">文字灵感</option>
                            </select>
                            <select value={draft.group} onChange={(event) => setDraft({ ...draft, group: event.target.value as LL2Inspiration["group"] })} aria-label="灵感分组">
                                {LL2_PROMPT_GROUPS.map((item) => <option key={item} value={item}>{item}</option>)}
                            </select>
                        </div>
                        <textarea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} placeholder="写下完整提示词，之后一键就能用它出片" rows={3} aria-label="灵感提示词" />
                        <div className="ll2-insp-form-actions">
                            <small>只存在这台电脑，不上传、不需要登录</small>
                            <button type="button" onClick={() => setCreating(false)}>取消</button>
                            <button type="button" className="is-primary" onClick={saveDraft} disabled={!draft.prompt.trim()}>保存灵感</button>
                        </div>
                    </div>
                ) : null}

                <div className="ll2-wb-filters ll2-insp-tabs" role="tablist" aria-label="按灵感类型筛选">
                    {LL2_INSPIRATION_TYPES.map((item) => (
                        <button key={item} type="button" role="radio" aria-checked={type === item} className={type === item ? "is-active" : ""} onClick={() => setType(item)}>
                            {item} {countOf(item)}
                        </button>
                    ))}
                    <button type="button" className={`ll2-insp-more ${moreFilters ? "is-active" : ""}`} onClick={() => setMoreFilters((value) => !value)}>更多筛选</button>
                </div>

                {moreFilters ? (
                    <div className="ll2-insp-more-row">
                        {LL2_INSPIRATION_GROUPS.map((item) => (
                            <button key={item} type="button" className={group === item ? "is-active" : ""} onClick={() => setGroup(item)}>{item}</button>
                        ))}
                    </div>
                ) : null}

                <div className="ll2-inspiration-grid">
                    {list.map((item) => {
                        const cost = ll2InspirationCost(item);
                        return (
                            <article key={item.id} className="ll2-inspiration-card">
                                <div className="ll2-inspiration-card-top">
                                    <span className="ll2-inspiration-tag">{item.type === "text" ? "文字" : "视频"} · {item.group}</span>
                                    <div className="ll2-insp-card-tools">
                                        <button type="button" className={favorites.includes(item.id) ? "is-fav" : ""} onClick={() => setFavorites(ll2ToggleFavoriteInspiration(item.id))} aria-label={favorites.includes(item.id) ? "取消收藏" : "收藏"}>
                                            <Heart className="size-3.5" />
                                        </button>
                                        {item.custom ? (
                                            <button type="button" onClick={() => setCustom(ll2RemoveCustomInspiration(item.id))} aria-label="删除这条灵感"><Trash2 className="size-3.5" /></button>
                                        ) : null}
                                    </div>
                                </div>
                                <button type="button" className="ll2-insp-card-body" onClick={() => setDetail(item)}>
                                    <h3>{item.title}</h3>
                                    <p>{item.prompt}</p>
                                </button>
                                <div className="ll2-insp-spec">
                                    {item.type === "video" && item.model ? (
                                        <span>{item.model} · {item.resolution} · {item.seconds} 秒</span>
                                    ) : (
                                        <span>Agent · 写一次大约几分钱</span>
                                    )}
                                    {cost ? <strong>{cost.label}</strong> : null}
                                </div>
                                <div className="ll2-insp-card-foot">
                                    <small>{item.hint}</small>
                                    <Link to={ll2InspirationUseUrl(item)} className="ll2-inspiration-use">用这个想法 <ArrowRight className="size-3.5" /></Link>
                                </div>
                            </article>
                        );
                    })}
                </div>

                {list.length === 0 ? <p className="ll2-wb-empty">这一类还没有灵感。点卡片右上角的爱心收藏，或点「新建灵感」自己存一条。</p> : null}

                <div className="ll2-wb-inline-tip">
                    <Sparkles className="size-4" />
                    <span>价格按 LL2 官网价格预估，账单以控制台为准；想要更贴自己题材的提示词，点右下角 <strong>Agent</strong> 帮你想词。</span>
                </div>
            </main>

            {detail ? (
                <div className="ll2-insp-modal" role="dialog" aria-label="灵感详情" onClick={() => setDetail(null)}>
                    <div className="ll2-insp-modal-card" onClick={(event) => event.stopPropagation()}>
                        <div className="ll2-insp-modal-top">
                            <span className="ll2-inspiration-tag">{detail.type === "text" ? "文字" : "视频"} · {detail.group}</span>
                            <button type="button" onClick={() => setDetail(null)} aria-label="关闭"><X className="size-4" /></button>
                        </div>
                        <h2>{detail.title}</h2>
                        <p className="ll2-insp-modal-prompt">{detail.prompt}</p>
                        {detail.type === "video" && detail.model ? (
                            <p className="ll2-insp-modal-spec">推荐 {detail.model} · {detail.resolution} · {detail.seconds} 秒 · {ll2InspirationCost(detail)?.label}</p>
                        ) : (
                            <p className="ll2-insp-modal-spec">Agent · 写一次大约几分钱</p>
                        )}
                        <Link to={ll2InspirationUseUrl(detail)} className="ll2-oneshot-submit" onClick={() => setDetail(null)}>
                            用这个想法 <ArrowRight className="size-3.5" />
                        </Link>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
