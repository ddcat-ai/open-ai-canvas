import { Button, Drawer, Skeleton, Tooltip } from "antd";
import { Check, ExternalLink, Heart, Pencil, Plus, Users } from "lucide-react";

import { formatSkillCount, formatSkillDate, skillCategoryLabel } from "@/pages/skills/skill-catalog";
import type { Skill, SkillCategory } from "@/services/api/skills";
import { useTranslation } from "react-i18next";

export function SkillDetailDrawer({
    skill,
    loading,
    mutating,
    categories,
    onClose,
    onAdd,
    onLike,
    onEdit,
}: {
    skill: Skill | null;
    loading: boolean;
    mutating: boolean;
    categories: SkillCategory[];
    onClose: () => void;
    onAdd: (skill: Skill) => void;
    onLike: (skill: Skill) => void;
    onEdit: (skill: Skill) => void;
}) {
    const { t } = useTranslation("canvas");
    return (
        <Drawer
            className="library-drawer"
            open={Boolean(skill)}
            size={760}
            destroyOnHidden
            title={skill?.skill_name || t("skills:skill-details")}
            onClose={onClose}
            extra={
                skill?.is_owner ? (
                    <Button icon={<Pencil className="size-4" />} onClick={() => onEdit(skill)}>
                        {t("skills:edit")}
                    </Button>
                ) : undefined
            }
        >
            {skill ? (
                <div className="space-y-6">
                    <header>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/50">
                            <span>{skillCategoryLabel(skill.tag, categories)}</span>
                            <span aria-hidden="true">/</span>
                            <span>{skill.is_private ? t("skills:only-me") : t("skills:public-skill")}</span>
                            <span aria-hidden="true">/</span>
                            <span>
                                {t("skills:updated")} {formatSkillDate(skill.update_time)}
                            </span>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-foreground/72">{skill.description}</p>
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <Button type={skill.is_added ? "default" : "primary"} loading={mutating} disabled={skill.is_owner} icon={skill.is_added ? <Check className="size-4" /> : <Plus className="size-4" />} onClick={() => onAdd(skill)}>
                                {skill.is_owner ? t("skills:my-skills") : skill.is_added ? t("skills:joined") : t("skills:adopt-skill")}
                            </Button>
                            <Button loading={mutating} icon={<Heart className={`size-4 ${skill.is_like ? "fill-current text-rose-500" : ""}`} />} onClick={() => onLike(skill)}>
                                {skill.is_like ? t("skills:favorited") : t("skills:favorite")}
                            </Button>
                            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-foreground/45">
                                <Users className="size-3.5" />
                                {formatSkillCount(skill.added_count)} {t("skills:users-joined-2")}
                            </span>
                        </div>
                    </header>

                    {skill.showcase_media.length ? <SkillMediaGallery skill={skill} /> : null}

                    <section aria-labelledby="skill-instruction-title">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <h2 id="skill-instruction-title" className="text-sm font-semibold">
                                {t("skills:skill-instructions-2")}
                            </h2>
                            {skill.markdown_url ? (
                                <Tooltip title={t("skills:open-markdown-source")}>
                                    <a
                                        className="inline-flex size-8 items-center justify-center rounded-md text-foreground/55 hover:bg-surface-hover hover:text-foreground"
                                        href={skill.markdown_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        aria-label={t("skills:open-markdown-source")}
                                    >
                                        <ExternalLink className="size-4" />
                                    </a>
                                </Tooltip>
                            ) : null}
                        </div>
                        {loading ? (
                            <Skeleton active paragraph={{ rows: 14 }} />
                        ) : (
                            <pre className="thin-scrollbar max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-foreground/[.025] p-4 font-mono text-xs leading-6 text-foreground/78">
                                {skill.instruction || t("skills:no-instructions-yet")}
                            </pre>
                        )}
                    </section>

                    <section className="border-t border-border/70 pt-4 text-xs leading-5 text-foreground/48">
                        <div>
                            {t("skills:author")}
                            {skill.effective_user.name || t("skills:unknown-user")}
                        </div>
                        {skill.extra_info ? <div className="mt-2 whitespace-pre-wrap">{skill.extra_info}</div> : null}
                    </section>
                </div>
            ) : null}
        </Drawer>
    );
}

function SkillMediaGallery({ skill }: { skill: Skill }) {
    const { t } = useTranslation("canvas");
    return (
        <section aria-labelledby="skill-showcase-title">
            <h2 id="skill-showcase-title" className="mb-2 text-sm font-semibold">
                {t("skills:showcase")}
            </h2>
            <div className="thin-scrollbar flex snap-x gap-3 overflow-x-auto pb-2">
                {skill.showcase_media.map((media, index) => (
                    <div key={`${media.showcase_url}-${index}`} className="aspect-video w-[min(78vw,420px)] shrink-0 snap-start overflow-hidden rounded-md border border-border/70 bg-black/90">
                        {media.type === "video" ? (
                            <video className="h-full w-full object-contain" controls playsInline preload="metadata" src={media.showcase_url} />
                        ) : (
                            <img className="h-full w-full object-contain" src={media.showcase_url} alt={`${skill.skill_name} 展示案例 ${index + 1}`} width={840} height={472} loading="lazy" />
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
}
