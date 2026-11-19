import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { communityWorksQueryKey, getPublicWorks, type CommunityWork } from "@/services/api/community-works";

import "./featured-community-works.css";

const CommunityWorkPreview = lazy(() => import("./community-work-preview").then(({ CommunityWorkPreview }) => ({ default: CommunityWorkPreview })));

export function FeaturedCommunityWorks() {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<CommunityWork>();
    const works = useQuery({
        queryKey: [...communityWorksQueryKey, "featured"],
        queryFn: ({ signal }) => getPublicWorks(signal),
        staleTime: 30_000,
    });

    if (!works.data?.items.length && !selected) return null;
    return (
        <section className="featured-community-works" aria-labelledby="featured-community-works-title">
            <h2 id="featured-community-works-title">{t("communityWorks.featured")}</h2>
            <div className="featured-community-works-grid">
                {works.data?.items.map((work) => (
                    <button type="button" className="featured-community-work" key={work.id} onClick={() => setSelected(work)}>
                        <img src={work.coverUrl} alt="" width={320} height={180} loading="lazy" decoding="async" />
                        <strong>{work.title}</strong>
                        <span>{work.author}</span>
                    </button>
                ))}
            </div>
            {selected ? (
                <Suspense fallback={null}>
                    <CommunityWorkPreview key={selected.id} work={selected} onClose={() => setSelected(undefined)} />
                </Suspense>
            ) : null}
        </section>
    );
}
