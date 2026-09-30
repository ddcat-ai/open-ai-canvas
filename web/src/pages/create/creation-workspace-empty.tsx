// 创作页空态：横幅、推荐提示词与精选作品。

import { useAppearanceStore } from "@/stores/use-appearance-store";
import type { CreationMode } from "./creation-assets";
import { ArrowUp, ChevronDown, Clapperboard, FileText, Image as ImageIcon, Sparkles } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { creationFeaturedWorks, inspirationSource } from "./creation-inspirations";
import { modeLabels } from "./creation-types";
import { Button } from "antd";

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

export function CreationFeaturedWorks({ onStartPrompt }: { onStartPrompt: (mode: CreationMode, prompt: string) => void }) {
    const [filter, setFilter] = useState<"all" | CreationMode>("all");
    const [limit, setLimit] = useState(12);
    const filtered = creationFeaturedWorks.filter((item) => filter === "all" || item.mode === filter);
    return (
        <section className="creation-featured-works" aria-labelledby="creation-featured-title">
            <div className="creation-featured-heading">
                <div>
                    <h2 id="creation-featured-title">精选灵感</h2>
                </div>
                <p>{creationFeaturedWorks.length} 个创意起点 · 点击填入提示词，不自动生成</p>
            </div>
            <div className="creation-inspiration-filters" role="group" aria-label="灵感类型">
                {(["all", "video", "image", "text"] as const).map((value) => (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={filter === value}
                        onClick={() => {
                            setFilter(value);
                            setLimit(12);
                        }}
                    >
                        {value === "all" ? "全部灵感" : modeLabels[value]}
                        <span>{creationFeaturedWorks.filter((item) => value === "all" || item.mode === value).length}</span>
                    </button>
                ))}
            </div>
            <div className="creation-featured-layout">
                {filtered.slice(0, limit).map((item, index) => (
                    <button key={item.title} type="button" className={`product-collection-card creation-featured-card ${index === 0 ? "is-featured-hero" : ""}`} onClick={() => onStartPrompt(item.mode, item.prompt)}>
                        <span className="creation-featured-media">
                            <img src={item.image} alt="" loading="lazy" />
                            <span className="creation-inspiration-overlay">
                                <ArrowUp />
                                使用这个创意
                            </span>
                        </span>
                        <span className="creation-featured-copy">
                            <strong>{item.title}</strong>
                            <span>{item.description}</span>
                            <em>
                                <Sparkles />
                                {item.source ? "开源改编 · CC0" : "原创提示词"} · {modeLabels[item.mode]}
                            </em>
                        </span>
                    </button>
                ))}
            </div>
            <footer className="creation-inspiration-footer">
                {limit < filtered.length ? (
                    <Button onClick={() => setLimit((count) => count + 12)}>
                        展开更多灵感
                        <ChevronDown />
                    </Button>
                ) : (
                    <span>已展示全部 {filtered.length} 个创意</span>
                )}
                <details>
                    <summary>模板与封面来源</summary>
                    <p>{inspirationSource.notice}</p>
                    <a href={inspirationSource.repository} target="_blank" rel="noreferrer">
                        awesome-chatgpt-prompts · CC0
                    </a>
                </details>
            </footer>
        </section>
    );
}
