// 创作页空态：横幅、推荐提示词与精选作品。

import { useInfiniteQuery } from "@tanstack/react-query";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import type { CreationMode } from "./creation-assets";
import { Alert, Button, Spin } from "antd";
import { ArrowUp, Clapperboard, FileText, Image as ImageIcon, RotateCw, Sparkles } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { libTVGalleryInfiniteQuery, pickLibTVRecommendations, shuffleLibTVGalleryPages } from "@/lib/libtv-gallery";
import { getLibTVGallery } from "@/services/api/libtv-gallery";
import { LibTVWorkDetailDialog } from "@/pages/inspiration/work-detail-dialog";

export const creationEmptyBannerFrames = [
    { src: "/short-drama-styles/cyberpunk-neon.jpg", caption: "镜头01 · 雨夜霓虹" },
    { src: "/short-drama-styles/suspense-noir.jpg", caption: "镜头02 · 暗巷追逐" },
    { src: "/short-drama-styles/retro-hong-kong.jpg", caption: "镜头03 · 天台重逢" },
];

export function CreationEmptyBanner() {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    return (
        <div className="creation-empty-art" aria-hidden="true">
            {creationEmptyBannerFrames.map((frame, index) => (
                <figure key={frame.caption} className={`creation-empty-art-frame ${index === 1 ? "is-main" : index === 0 ? "is-back" : "is-front"}`}>
                    <img src={frame.src} alt="" />
                    <span>{frame.caption}</span>
                </figure>
            ))}
            <span className="creation-empty-art-caption">
                <span>{brandName}</span>把每一帧，交给镜头导演
            </span>
        </div>
    );
}

export const creationEmptySuggestions: Array<{ mode: CreationMode; icon: typeof Clapperboard; title: string; hint: string; prompt: string; openLibrary?: boolean }> = [
    { mode: "video", icon: Clapperboard, title: "生成第一个镜头", hint: "描述画面、镜头运动与光线", prompt: "雨夜天台，镜头缓缓推近霓虹灯牌下的主角，她回眸看向镜头，强对比电影感布光" },
    { mode: "image", icon: ImageIcon, title: "从参考图开始", hint: "上传风格图，生成同风格画面", prompt: "", openLibrary: true },
    { mode: "text", icon: FileText, title: "续写故事", hint: "和 AI 讨论剧情、角色与对白", prompt: "帮我续写一个短剧故事，先聊聊剧情走向：" },
    { mode: "video", icon: Sparkles, title: "引用技能增强", hint: "@技能 调用分镜、配音等专业能力", prompt: "调用分镜技能，帮我规划这个镜头的拍摄方案：" },
];

export function CreationEmptySuggest({ onStartPrompt, onOpenLibrary }: { onStartPrompt: (mode: CreationMode, prompt: string) => void; onOpenLibrary: () => void }) {
    const reducedMotion = useReducedMotion();
    const [hovered, setHovered] = useState<string | null>(null);
    return (
        <LayoutGroup id="creation-empty-suggest">
            <div className="creation-empty-suggest" aria-label="快捷创作入口">
                {creationEmptySuggestions.map((item) => {
                    const Icon = item.icon;
                    const start = () => {
                        if (item.openLibrary) onOpenLibrary();
                        else onStartPrompt(item.mode, item.prompt);
                    };
                    return (
                        <motion.button
                            key={item.title}
                            type="button"
                            className="suggest-card"
                            onClick={start}
                            onHoverStart={() => setHovered(item.title)}
                            onHoverEnd={() => setHovered(null)}
                            whileHover={reducedMotion ? undefined : { y: -2 }}
                            transition={aceternityMotion.spring.surface}
                        >
                            {hovered === item.title ? <motion.span layoutId="creation-suggest-hover" className="suggest-card-hover" aria-hidden transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.surface} /> : null}
                            <span className="library-icon-tile suggest-icon">
                                <Icon size={18} strokeWidth={2} />
                            </span>
                            <span className="suggest-copy">
                                <strong>{item.title}</strong>
                                <span>{item.hint}</span>
                            </span>
                        </motion.button>
                    );
                })}
            </div>
        </LayoutGroup>
    );
}

/**
 * 精选灵感直接读灵感广场的同一份公开作品（同一个 queryKey，命中缓存，不复制数据、不转存媒体）。
 * 点开的是同一个作品弹窗，所以创作页的对话、模型、积分都留在原地；点一下不会填提示词，也不会自动生成。
 * 加载中/失败/无结果照实说，不拿旧的内置示例冒充「已同步」。
 */
export function CreationFeaturedWorks({ showHeading = true }: { showHeading?: boolean }) {
    const [activeTemplateUuid, setActiveTemplateUuid] = useState<string>();
    const [shuffleSeed] = useState(() => Math.floor(Math.random() * 0x100000000));
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const { data, isLoading, isError, error, refetch, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = useInfiniteQuery(libTVGalleryInfiniteQuery({ keyword: "" }, getLibTVGallery));

    const items = useMemo(() => shuffleLibTVGalleryPages(data?.pages ?? [], shuffleSeed), [data?.pages, shuffleSeed]);
    const recommended = useMemo(() => (activeTemplateUuid ? pickLibTVRecommendations(items, activeTemplateUuid, 6) : []), [activeTemplateUuid, items]);

    useEffect(() => {
        const target = loadMoreRef.current;
        if (!target || !hasNextPage || isFetching || isError || activeTemplateUuid || typeof IntersectionObserver === "undefined") return;
        let requested = false;
        const observer = new IntersectionObserver((entries) => {
            if (requested || !entries.some((entry) => entry.isIntersecting)) return;
            requested = true;
            void fetchNextPage({ cancelRefetch: false });
        }, { root: target.closest(".creation-home-scroll, .creation-empty-workspace"), rootMargin: "0px 0px 240px 0px" });
        observer.observe(target);
        return () => observer.disconnect();
    }, [activeTemplateUuid, fetchNextPage, hasNextPage, isError, isFetching, items.length]);
    return (
        <section className="creation-featured-works" aria-label="精选灵感">
            {showHeading ? <div className="creation-featured-heading">
                <div>
                    <h2 id="creation-featured-title">精选灵感</h2>
                </div>
            </div> : null}

            {isError && !isFetchNextPageError ? (
                <Alert
                    type="error"
                    showIcon
                    message="暂时读不到灵感广场的作品"
                    description={error instanceof Error ? error.message : "请求出错"}
                    action={
                        <Button size="small" loading={isFetching} onClick={() => void refetch()}>
                            重试
                        </Button>
                    }
                />
            ) : isLoading ? (
                <div className="creation-featured-layout" aria-busy="true">
                    {[0, 1, 2].map((key) => (
                        <span key={key} className="product-collection-card creation-featured-card is-placeholder" />
                    ))}
                </div>
            ) : items.length === 0 ? (
                <p className="creation-featured-empty">灵感广场现在还没有公开作品。</p>
            ) : (
                <div className="creation-featured-layout">
                    {items.map((item, index) => (
                        <button
                            key={item.templateUuid}
                            type="button"
                            className={`product-collection-card creation-featured-card ${index === 0 ? "is-featured-hero" : ""}`}
                            onClick={() => setActiveTemplateUuid(item.templateUuid)}
                        >
                            <span className="creation-featured-media">
                                <img src={item.coverUrl} alt="" loading="lazy" />
                                <span className="creation-inspiration-overlay">
                                    <ArrowUp />
                                    查看作品
                                </span>
                            </span>
                            <span className="creation-featured-copy">
                                <strong>{item.title}</strong>
                                <span>{item.description}</span>
                                <em>
                                    <Sparkles />
                                    {item.authorName || "LibTV 创作者"}
                                    {item.tags[0] ? ` · ${item.tags[0].label}` : ""}
                                </em>
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {items.length > 0 && (
                <div ref={loadMoreRef} className="creation-inspiration-load-status" role="status" aria-live="polite">
                    {isFetchNextPageError ? (
                        <>
                            <span>下一批灵感加载失败</span>
                            <Button size="small" icon={<RotateCw size={14} />} loading={isFetchingNextPage} disabled={isFetching} onClick={() => void fetchNextPage({ cancelRefetch: false })}>
                                重试
                            </Button>
                        </>
                    ) : isFetchingNextPage ? (
                        <><Spin size="small" /><span>正在加载更多灵感…</span></>
                    ) : !hasNextPage ? (
                        <span>已展示全部 {items.length} 个作品</span>
                    ) : null}
                </div>
            )}

            <LibTVWorkDetailDialog
                templateUuid={activeTemplateUuid}
                recommended={recommended}
                onSelectWork={(item) => setActiveTemplateUuid(item.templateUuid)}
                onClose={() => setActiveTemplateUuid(undefined)}
            />
        </section>
    );
}
