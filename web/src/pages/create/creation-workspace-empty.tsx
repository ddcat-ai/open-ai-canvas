// 创作页空态：横幅、推荐提示词与精选作品。

import { useAppearanceStore } from "@/stores/use-appearance-store";
import type { CreationMode } from "./creation-assets";
import { ArrowUp, ChevronDown, Clapperboard, FileText, Image as ImageIcon, Blocks, Bookmark } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { curatedInspirations, inspirationSourceOf, inspirationSources } from "@/lib/inspirations/catalog";
import { modeLabels } from "./creation-types";
import { Button } from "antd";
import { useTranslation } from "react-i18next";
import { translate } from "@/i18n";

export const creationEmptyBannerFrames = [
    {
        src: "/short-drama-styles/cyberpunk-neon.jpg",
        get caption() {
            return translate("create.empty.frameNeon");
        },
    },
    {
        src: "/short-drama-styles/suspense-noir.jpg",
        get caption() {
            return translate("create.empty.frameAlley");
        },
    },
    {
        src: "/short-drama-styles/retro-hong-kong.jpg",
        get caption() {
            return translate("create.empty.frameRooftop");
        },
    },
];

export function CreationEmptyBanner() {
    const { t } = useTranslation();
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
                <span>{brandName}</span>
                {t("create.empty.bannerTagline")}
            </span>
        </div>
    );
}

export const creationEmptySuggestions: Array<{ mode: CreationMode; icon: typeof Clapperboard; title: string; hint: string; prompt: string; openLibrary?: boolean }> = [
    {
        mode: "video",
        icon: Clapperboard,
        get title() {
            return translate("create.empty.suggest.firstShotTitle");
        },
        get hint() {
            return translate("create.empty.suggest.firstShotHint");
        },
        prompt: "雨夜天台，镜头缓缓推近霓虹灯牌下的主角，她回眸看向镜头，强对比电影感布光",
    },
    {
        mode: "image",
        icon: ImageIcon,
        get title() {
            return translate("create.empty.suggest.referenceTitle");
        },
        get hint() {
            return translate("create.empty.suggest.referenceHint");
        },
        prompt: "",
        openLibrary: true,
    },
    {
        mode: "text",
        icon: FileText,
        get title() {
            return translate("create.empty.suggest.storyTitle");
        },
        get hint() {
            return translate("create.empty.suggest.storyHint");
        },
        prompt: "帮我续写一个短剧故事，先聊聊剧情走向：",
    },
    {
        mode: "video",
        icon: Blocks,
        get title() {
            return translate("create.empty.suggest.skillTitle");
        },
        get hint() {
            return translate("create.empty.suggest.skillHint");
        },
        prompt: "调用分镜技能，帮我规划这个镜头的拍摄方案：",
    },
];

export function CreationEmptySuggest({ onStartPrompt, onOpenLibrary }: { onStartPrompt: (mode: CreationMode, prompt: string) => void; onOpenLibrary: () => void }) {
    const { t } = useTranslation();
    const reducedMotion = useReducedMotion();
    const [hovered, setHovered] = useState<string | null>(null);
    return (
        <LayoutGroup id="creation-empty-suggest">
            <div className="creation-empty-suggest" aria-label={t("create.empty.suggestLabel")}>
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
    const { t } = useTranslation();
    const [filter, setFilter] = useState<"all" | CreationMode>("all");
    const [limit, setLimit] = useState(12);
    const filtered = curatedInspirations.filter((item) => filter === "all" || item.mode === filter);
    // 只列出真正用到的外部来源；原创条目不写来源声明。
    const declaredSources = Array.from(new Set(curatedInspirations.map((item) => item.sourceId ?? "original")))
        .map((id) => inspirationSources[id])
        .filter((source) => source.notice);
    return (
        <section className="creation-featured-works" aria-labelledby="creation-featured-title">
            <div className="creation-featured-heading">
                <div>
                    <h2 id="creation-featured-title">{t("create.empty.featuredTitle")}</h2>
                </div>
                <p>{t("create.empty.featuredSummary", { count: curatedInspirations.length })}</p>
            </div>
            <div className="creation-inspiration-filters" role="group" aria-label={t("create.empty.filterLabel")}>
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
                        {value === "all" ? t("create.empty.allInspirations") : modeLabels[value]}
                        <span>{curatedInspirations.filter((item) => value === "all" || item.mode === value).length}</span>
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
                                {t("create.inspiration.useIdea")}
                            </span>
                        </span>
                        <span className="creation-featured-copy">
                            <strong>{item.title}</strong>
                            <span>{item.description}</span>
                            <em>
                                <Bookmark />
                                {inspirationSourceOf(item).label} · {modeLabels[item.mode]}
                            </em>
                        </span>
                    </button>
                ))}
            </div>
            <footer className="creation-inspiration-footer">
                {limit < filtered.length ? (
                    <Button onClick={() => setLimit((count) => count + 12)}>
                        {t("create.empty.showMore")}
                        <ChevronDown />
                    </Button>
                ) : (
                    <span>{t("create.empty.allShown", { count: filtered.length })}</span>
                )}
                <details>
                    <summary>{t("create.empty.sourcesSummary")}</summary>
                    {declaredSources.map((source) => (
                        <div key={source.name ?? source.label}>
                            <p>{source.notice}</p>
                            {source.repository ? (
                                <a href={source.repository} target="_blank" rel="noreferrer">
                                    {source.name} · {source.license}
                                </a>
                            ) : null}
                        </div>
                    ))}
                </details>
            </footer>
        </section>
    );
}
