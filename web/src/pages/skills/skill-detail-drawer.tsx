import { Button, Drawer, Skeleton, Tooltip } from "antd";
import { Check, ExternalLink, Heart, Pencil, Plus, Users } from "lucide-react";

import { formatSkillCount, formatSkillDate, skillCategoryLabel } from "@/pages/skills/skill-catalog";
import type { Skill, SkillCategory } from "@/services/api/skills";

export function SkillDetailDrawer({ skill, loading, mutating, categories, onClose, onAdd, onLike, onEdit }: { skill: Skill | null; loading: boolean; mutating: boolean; categories: SkillCategory[]; onClose: () => void; onAdd: (skill: Skill) => void; onLike: (skill: Skill) => void; onEdit: (skill: Skill) => void }) {
    return (
        <Drawer className="library-drawer" open={Boolean(skill)} size={760} destroyOnHidden title={skill?.skill_name || "技能详情"} onClose={onClose} extra={skill?.is_owner ? <Button icon={<Pencil className="size-4" />} onClick={() => onEdit(skill)}>编辑</Button> : undefined}>
            {skill ? (
                <div className="space-y-6">
                    <header>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/50">
                            <span>{skillCategoryLabel(skill.tag, categories)}</span><span aria-hidden="true">/</span><span>{skill.is_private ? "仅自己可见" : "公开技能"}</span><span aria-hidden="true">/</span><span>更新于 {formatSkillDate(skill.update_time)}</span>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-foreground/72">{skill.description}</p>
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <Button type={skill.is_added ? "default" : "primary"} loading={mutating} disabled={skill.is_owner} icon={skill.is_added ? <Check className="size-4" /> : <Plus className="size-4" />} onClick={() => onAdd(skill)}>{skill.is_owner ? "我的技能" : skill.is_added ? "已加入" : "加入技能"}</Button>
                            <Button loading={mutating} icon={<Heart className={`size-4 ${skill.is_like ? "fill-current text-rose-500" : ""}`} />} onClick={() => onLike(skill)}>{skill.is_like ? "已收藏" : "收藏"}</Button>
                            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-foreground/45"><Users className="size-3.5" />{formatSkillCount(skill.added_count)} 人加入</span>
                        </div>
                    </header>

                    {skill.showcase_media.length ? <SkillMediaGallery skill={skill} /> : null}

                    <section aria-labelledby="skill-instruction-title">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <h2 id="skill-instruction-title" className="text-sm font-semibold">技能指令</h2>
                            {skill.markdown_url ? <Tooltip title="打开 Markdown 原文"><a className="inline-flex size-8 items-center justify-center rounded-md text-foreground/55 hover:bg-foreground/[.06] hover:text-foreground" href={skill.markdown_url} target="_blank" rel="noreferrer" aria-label="打开 Markdown 原文"><ExternalLink className="size-4" /></a></Tooltip> : null}
                        </div>
                        {loading ? <Skeleton active paragraph={{ rows: 14 }} /> : <pre className="thin-scrollbar max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-foreground/[.025] p-4 font-mono text-xs leading-6 text-foreground/78">{skill.instruction || "暂无技能指令"}</pre>}
                    </section>

                    <section className="border-t border-border/70 pt-4 text-xs leading-5 text-foreground/48">
                        <div>作者：{skill.effective_user.name || "未知用户"}</div>
                        {skill.extra_info ? <div className="mt-2 whitespace-pre-wrap">{skill.extra_info}</div> : null}
                    </section>
                </div>
            ) : null}
        </Drawer>
    );
}

function SkillMediaGallery({ skill }: { skill: Skill }) {
    return (
        <section aria-labelledby="skill-showcase-title">
            <h2 id="skill-showcase-title" className="mb-2 text-sm font-semibold">展示案例</h2>
            <div className="thin-scrollbar flex snap-x gap-3 overflow-x-auto pb-2">
                {skill.showcase_media.map((media, index) => (
                    <div key={`${media.showcase_url}-${index}`} className="aspect-video w-[min(78vw,420px)] shrink-0 snap-start overflow-hidden rounded-md border border-border/70 bg-black/90">
                        {media.type === "video" ? <video className="h-full w-full object-contain" controls playsInline preload="metadata" src={media.showcase_url} /> : <img className="h-full w-full object-contain" src={media.showcase_url} alt={`${skill.skill_name} 展示案例 ${index + 1}`} width={840} height={472} loading="lazy" />}
                    </div>
                ))}
            </div>
        </section>
    );
}
